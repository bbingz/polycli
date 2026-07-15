import { binaryAvailable, getSafeArgvBudgetBytes, runCommand } from "@bbingz/polycli-utils/process";

import { spawnStreamingCommand } from "./spawn.js";

const MMX_BIN = process.env.MMX_CLI_BIN || process.env.MINIMAX_CLI_BIN || "mmx";
const DEFAULT_TIMEOUT_MS = 120_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const SAFE_PROMPT_ARGV_BUDGET_BYTES = getSafeArgvBudgetBytes();
const SAFE_PROMPT_ARGV_BUDGET_HINT = "Prompt exceeds the safe argv budget. When using review, pass --max-diff-bytes explicitly.";
const MINIMAX_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];

export function stripAnsiSgr(text) {
  return String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "");
}

export function buildMiniMaxInvocation({
  prompt,
  model = null,
  extraArgs = [],
  bin = MMX_BIN,
} = {}) {
  const args = [
    "text",
    "chat",
    "--message",
    String(prompt ?? ""),
    "--output",
    "json",
    "--non-interactive",
  ];
  if (model) args.push("--model", model);
  if (extraArgs.length > 0) args.push(...extraArgs);
  return {
    bin,
    args,
  };
}

export function extractMiniMaxLogPath(text) {
  const match = stripAnsiSgr(text).match(/Log file:\s+(\S+\.log)/);
  return match ? match[1] : null;
}

export function parseMiniMaxResponseBlocks(logText) {
  const blocks = [];
  const lines = String(logText ?? "").split(/\r?\n/);
  let current = null;
  let bodyLines = [];
  let braceDepth = 0;
  let inString = false;

  const scanLine = (line) => {
    let opens = 0;
    let closes = 0;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (inString) {
        if (char === "\\") {
          index += 1;
        } else if (char === '"') {
          inString = false;
        }
      } else if (char === '"') {
        inString = true;
      } else if (char === "{") {
        opens += 1;
      } else if (char === "}") {
        closes += 1;
      }
    }
    braceDepth += opens - closes;
  };

  const finish = () => {
    if (!current) return;
    const raw = bodyLines.join("\n");
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {}
    blocks.push({ ...current, raw, json });
    current = null;
    bodyLines = [];
    braceDepth = 0;
    inString = false;
  };

  for (const line of lines) {
    const header = line.match(/^\[(\d+)\]\s+RESPONSE$/);
    if (header) {
      finish();
      current = { index: Number.parseInt(header[1], 10) };
      continue;
    }
    if (!current) continue;
    if (bodyLines.length === 0 && !line.trimStart().startsWith("{")) continue;
    bodyLines.push(line);
    scanLine(line);
    if (braceDepth <= 0 && bodyLines.length > 0 && !inString) {
      finish();
    }
  }

  finish();
  return blocks;
}

export function extractMiniMaxResponseFromLogText(logText) {
  const blocks = parseMiniMaxResponseBlocks(logText);
  const picked = [...blocks]
    .reverse()
    .find((block) => block.json && (block.json.finish_reason || block.json.content));

  if (!picked?.json) {
    return { response: "", finishReason: null, toolCalls: [] };
  }

  const model = picked.json.model ?? picked.json.meta?.model ?? null;
  return {
    response: typeof picked.json.content === "string" ? picked.json.content : "",
    finishReason: picked.json.finish_reason ?? null,
    toolCalls: Array.isArray(picked.json.tool_calls) ? picked.json.tool_calls : [],
    ...(model ? { model } : {}),
  };
}

export function extractMiniMaxEventText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "progress" && typeof event.text === "string") {
    return event.text;
  }
  if (event.type === "result" && typeof event.response === "string") {
    return event.response;
  }
  return "";
}

export function getMiniMaxAvailability(cwd) {
  return binaryAvailable(MMX_BIN, ["--version"], { cwd });
}

export async function getMiniMaxAuthStatus(cwd, { runner = runCommand } = {}) {
  const result = runner(MMX_BIN, ["auth", "status", "--output", "json", "--non-interactive"], {
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
  });

  // A timeout / 429 / transient failure of the auth-status subcommand is inconclusive,
  // not proof of logout — it must NOT regress to loggedIn:false.
  if (result.error) {
    const detail = result.error.code === "ETIMEDOUT"
      ? `mmx auth probe timed out after ${Math.round(AUTH_CHECK_TIMEOUT_MS / 1000)}s`
      : result.error.message;
    if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
    }
    return { loggedIn: false, detail };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `mmx auth status exited with code ${result.status}`;
    if (!MINIMAX_EXPLICIT_AUTH_ERROR_RE.test(detail)
      && TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
    }
    return { loggedIn: false, detail };
  }

  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  const loggedIn = parsed
    ? parsed.authenticated === true || parsed.loggedIn === true || parsed.status === "authenticated"
    : /\b(authenticated|logged in|ok)\b/i.test(text);

  return {
    loggedIn,
    detail: loggedIn ? "authenticated" : (text || "mmx auth status did not report authenticated"),
    model: parsed?.model ?? null,
  };
}

export function extractMiniMaxResponseFromMmxJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return { response: "", finishReason: null, toolCalls: [] };
  }
  let value = null;
  try {
    value = JSON.parse(raw);
  } catch {
    return { response: stripAnsiSgr(raw), finishReason: null, toolCalls: [] };
  }

  const choice = Array.isArray(value.choices) ? value.choices[0] : null;
  const message = choice?.message ?? choice?.delta ?? null;
  const contentText = Array.isArray(value.content)
    ? value.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
    : "";
  const response = typeof value.content === "string"
    ? value.content
    : typeof value.response === "string"
      ? value.response
      : typeof value.text === "string"
        ? value.text
        : contentText || (typeof message?.content === "string" ? message.content : "");
  // mmx speaks both the OpenAI (`finish_reason`) and Anthropic Messages (`stop_reason`) shapes;
  // the content-block branch above already handles Anthropic `content[]`, so honour `stop_reason` too.
  const finishReason =
    value.finish_reason ?? value.finishReason ?? value.stop_reason ?? choice?.finish_reason ?? null;
  const toolCalls = Array.isArray(value.tool_calls)
    ? value.tool_calls
    : Array.isArray(message?.tool_calls)
      ? message.tool_calls
      : [];

  return {
    response,
    finishReason,
    toolCalls,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
  };
}

export function runMiniMaxPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  defaultModel = null,
  env = process.env,
  bin = MMX_BIN,
  spawnImpl,
  argvBudgetBytes = SAFE_PROMPT_ARGV_BUDGET_BYTES,
} = {}) {
  return new Promise((resolve) => {
    const invocation = buildMiniMaxInvocation({ prompt, model, extraArgs, bin });

    spawnStreamingCommand({
      bin: invocation.bin,
      args: invocation.args,
      cwd: cwd || process.cwd(),
      env,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      spawnImpl,
      argvBudgetBytes,
      argvBudgetHint: SAFE_PROMPT_ARGV_BUDGET_HINT,
      onStdoutLine() {},
    }).then((result) => {
      try {
        const parsed = extractMiniMaxResponseFromMmxJson(result.stdout);
        const resolvedModel = parsed.model ?? model ?? defaultModel ?? null;
        const hasVisibleText = Boolean(parsed.response.trim());
        resolve({
          ...result,
          logPath: null,
          ...parsed,
          model: resolvedModel,
          ok: result.ok && hasVisibleText,
          error: result.ok && hasVisibleText
            ? null
            : (result.error || result.stderr.trim() || "minimax produced no visible text"),
        });
      } catch (error) {
        resolve({
          ok: false,
          status: null,
          signal: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          response: "",
          finishReason: null,
          toolCalls: [],
          logPath: null,
          model: model ?? defaultModel ?? null,
          error: error.message,
        });
      }
    }, (error) => {
      resolve({
        ok: false,
        status: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        response: "",
        finishReason: null,
        toolCalls: [],
        logPath: null,
        model: model ?? defaultModel ?? null,
        error: error.message,
      });
    });
  });
}

export async function runMiniMaxPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  defaultModel = null,
  env = process.env,
  onEvent = () => {},
  bin = MMX_BIN,
  spawnImpl,
  argvBudgetBytes = SAFE_PROMPT_ARGV_BUDGET_BYTES,
} = {}) {
  const events = [];
  return runMiniMaxPrompt({
    prompt,
    model,
    cwd,
    timeout,
    extraArgs,
    defaultModel,
    env,
    bin,
    spawnImpl,
    argvBudgetBytes,
  }).then((result) => {
    try {
      const event = {
        type: "result",
        response: result.response,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls,
        model: result.model ?? null,
      };
      events.push(event);
      onEvent(event);
    } catch {}
    return { ...result, events };
  });
}
