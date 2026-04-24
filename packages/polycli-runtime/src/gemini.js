import { parseStreamJsonLine } from "@bbingz/polycli-utils/parse-stream-json";
import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { spawnStreamingCommand } from "./spawn.js";

const GEMINI_BIN = process.env.GEMINI_CLI_BIN || "gemini";
const DEFAULT_TIMEOUT_MS = 300_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PROMPT_STDIN_THRESHOLD = 100_000;
const GEMINI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
const GEMINI_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;

export function buildGeminiInvocation({
  prompt,
  model = null,
  approvalMode = "plan",
  outputFormat = "json",
  resumeSessionId = null,
  extraArgs = [],
  bin = GEMINI_BIN,
} = {}) {
  const promptText = String(prompt ?? "");
  const useStdin = Buffer.byteLength(promptText, "utf8") > PROMPT_STDIN_THRESHOLD;
  const args = ["-p", useStdin ? "" : promptText, "-o", outputFormat];

  if (model) args.push("-m", model);
  args.push("--approval-mode", approvalMode);
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (extraArgs.length > 0) args.push(...extraArgs);

  return {
    bin,
    args,
    input: useStdin ? promptText : undefined,
    useStdin,
  };
}

export function extractGeminiText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "result" && typeof event.text === "string") return event.text;
  const role = event.role ?? event.message?.role ?? null;
  if (event.type === "message" && role !== "assistant") return "";
  if (event.type === "message" && typeof event.delta === "string") return event.delta;
  if (event.type === "message" && typeof event.content === "string") return event.content;
  if (event.type === "message" && typeof event.text === "string") return event.text;
  if (event.type === "message" && typeof event.message?.content === "string") return event.message.content;
  return "";
}

export function parseGeminiStreamText(text) {
  const events = [];
  let response = "";
  let sessionId = null;
  let stats = null;
  let model = null;
  let resultEvent = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const parsed = parseStreamJsonLine(rawLine, { allowPrefix: true });
    if (!parsed.ok) continue;
    const event = parsed.event;
    events.push(event);
    if (!sessionId && event.session_id) sessionId = event.session_id;
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.session?.model === "string") model = event.session.model;
    if (event.type === "result") {
      resultEvent = event;
      if (event.stats) {
        stats = event.stats;
        model = model ?? Object.keys(event.stats.models ?? {})[0] ?? null;
      }
      if (!response.trim()) {
        response += extractGeminiText(event);
      }
      continue;
    }
    response += extractGeminiText(event);
  }

  return { events, response, sessionId, stats, model, resultEvent };
}

function parseGeminiJsonResult(stdout, stderr, status, { defaultModel = null } = {}) {
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
    const resolvedSession = resolveSessionId({
      stdout,
      stderr,
      priority: ["stdout", "stderr", "file"],
    });
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
      sessionId: parsed.session_id ?? resolvedSession.sessionId ?? null,
      stats: parsed.stats ?? null,
      model: Object.keys(parsed.stats?.models ?? {})[0] || defaultModel,
      status,
    };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${error.message}`, status };
  }
}

export function getGeminiAvailability(cwd) {
  return binaryAvailable(GEMINI_BIN, ["-v"], { cwd });
}

function buildGeminiAuthStatus(test) {
  if (test.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: Object.keys(test.stats?.models ?? {})[0] || null,
    };
  }

  const detail = String(test.error ?? "").trim() || "gemini auth probe failed";
  if (GEMINI_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (GEMINI_TRANSIENT_PROBE_ERROR_RE.test(detail)) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
  }
  return { loggedIn: false, detail };
}

export function getGeminiAuthStatus(cwd, { promptRunner = runGeminiPrompt } = {}) {
  const test = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
  });
  return buildGeminiAuthStatus(test);
}

export function runGeminiPrompt({
  prompt,
  model = null,
  approvalMode = "plan",
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
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

  return parseGeminiJsonResult(result.stdout, result.stderr, result.status, {
    defaultModel: model ?? defaultModel,
  });
}

export function runGeminiPromptStreaming({
  prompt,
  model = null,
  approvalMode = "plan",
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
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
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const resultError = typeof parsed.resultEvent?.error?.message === "string"
      ? parsed.resultEvent.error.message
      : (typeof parsed.resultEvent?.error === "string" ? parsed.resultEvent.error : null);
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      model: parsed.model ?? model ?? defaultModel,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok
        ? (resultError || (hasVisibleText ? null : "gemini produced no visible text"))
        : result.error,
    };
  });
}
