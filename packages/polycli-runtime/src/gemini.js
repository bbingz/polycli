import { parseStreamJsonLine } from "@bbingz/polycli-utils/parse-stream-json";
import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";

import { spawnStreamingCommand } from "./spawn.js";

const GEMINI_BIN = process.env.GEMINI_CLI_BIN || "gemini";
const DEFAULT_TIMEOUT_MS = 300_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PROMPT_STDIN_THRESHOLD = 100_000;

export function buildGeminiInvocation({
  prompt,
  model = null,
  approvalMode = "plan",
  outputFormat = "json",
  resumeSessionId = null,
  extraArgs = [],
  bin = GEMINI_BIN,
} = {}) {
  const useStdin = String(prompt ?? "").length > PROMPT_STDIN_THRESHOLD;
  const args = ["-p", useStdin ? "" : String(prompt ?? ""), "-o", outputFormat];

  if (model) args.push("-m", model);
  args.push("--approval-mode", approvalMode);
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (extraArgs.length > 0) args.push(...extraArgs);

  return {
    bin,
    args,
    input: useStdin ? String(prompt ?? "") : undefined,
    useStdin,
  };
}

export function extractGeminiText(event) {
  if (!event || typeof event !== "object") return "";
  const role = event.role ?? event.message?.role ?? null;
  if (role && role !== "assistant") return "";
  if (typeof event.delta === "string") return event.delta;
  if (typeof event.content === "string") return event.content;
  if (typeof event.text === "string") return event.text;
  if (typeof event.message?.content === "string") return event.message.content;
  return "";
}

export function parseGeminiStreamText(text) {
  const events = [];
  let response = "";
  let sessionId = null;
  let stats = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const parsed = parseStreamJsonLine(rawLine, { allowPrefix: true });
    if (!parsed.ok) continue;
    const event = parsed.event;
    events.push(event);
    if (!sessionId && event.session_id) sessionId = event.session_id;
    if (event.type === "result" && event.stats) stats = event.stats;
    response += extractGeminiText(event);
  }

  return { events, response, sessionId, stats };
}

function parseGeminiJsonResult(stdout, stderr, status) {
  const text = String(stdout ?? "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    return {
      ok: false,
      error: String(stderr ?? "").trim() || `gemini exited with code ${status}`,
      status,
    };
  }

  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    if (parsed.error) {
      return {
        ok: false,
        error: parsed.error.message || "gemini returned an error",
        code: parsed.error.code ?? null,
        status,
      };
    }
    return {
      ok: true,
      response: parsed.response ?? "",
      sessionId: parsed.session_id ?? null,
      stats: parsed.stats ?? null,
      status,
    };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${error.message}`, status };
  }
}

export function getGeminiAvailability(cwd) {
  return binaryAvailable(GEMINI_BIN, ["-v"], { cwd });
}

export function getGeminiAuthStatus(cwd) {
  const test = runGeminiPrompt({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
  });

  if (!test.ok) {
    return { loggedIn: false, detail: test.error };
  }

  return {
    loggedIn: true,
    detail: "authenticated",
    model: Object.keys(test.stats?.models ?? {})[0] || null,
  };
}

export function runGeminiPrompt({
  prompt,
  model = null,
  approvalMode = "plan",
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  bin = GEMINI_BIN,
} = {}) {
  const invocation = buildGeminiInvocation({
    prompt,
    model,
    approvalMode,
    outputFormat: "json",
    resumeSessionId,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    timeout,
    input: invocation.input,
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT"
        ? `gemini timed out after ${Math.round(timeout / 1000)}s`
        : result.error.message,
    };
  }

  return parseGeminiJsonResult(result.stdout, result.stderr, result.status);
}

export function runGeminiPromptStreaming({
  prompt,
  model = null,
  approvalMode = "plan",
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  onEvent = () => {},
  bin = GEMINI_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildGeminiInvocation({
    prompt,
    model,
    approvalMode,
    outputFormat: "stream-json",
    resumeSessionId,
    extraArgs,
    bin,
  });

  return spawnStreamingCommand({
    bin: invocation.bin,
    args: invocation.args,
    cwd,
    env: { ...process.env },
    input: invocation.input,
    timeout,
    spawnImpl,
    onStdoutLine(line) {
      const parsed = parseStreamJsonLine(line, { allowPrefix: true });
      if (parsed.ok) {
        try { onEvent(parsed.event); } catch {}
      }
    },
  }).then((result) => {
    const parsed = parseGeminiStreamText(result.stdout);
    return {
      ...result,
      ...parsed,
      error: result.ok ? null : result.error,
    };
  });
}
