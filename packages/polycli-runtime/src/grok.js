import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";

import { classifyProviderFailure, formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const GROK_BIN = process.env.GROK_CLI_BIN || "grok";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
// `grok models` reports `Default model: grok-build`; callers pass `-m <model>` to switch.
const DEFAULT_GROK_MODEL = "grok-build";
const GROK_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|not logged in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
// grok-build's StopReason serde enum is {EndTurn, MaxTokens, MaxTurnRequests, Refusal, ToolUse,
// Cancelled} (verified against the installed binary). A MaxTokens stop means the answer was merely
// truncated at the output-token cap — a complete, visible answer from the user's perspective — so it
// must stay ok=true. Genuine non-success reasons (refusal, cancelled, tool_use, max_turn_requests)
// are deliberately excluded so they still fail the run while partial text is preserved.
const SUCCESS_STOP_REASONS = new Set(["endturn", "end_turn", "stop", "stop_sequence", "complete", "completed", "done", "finished", "maxtokens", "max_tokens", "length"]);
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];

export function buildGrokInvocation({
  prompt,
  model = null,
  outputFormat = "json",
  permissionMode = null,
  alwaysApprove = false,
  effort = null,
  resumeSessionId = null,
  continueLast = false,
  extraArgs = [],
  bin = GROK_BIN,
} = {}) {
  // grok one-shot: `-p <prompt>` prints the response and exits. Unlike kimi-code, `-p` composes
  // with --permission-mode/--always-approve/--effort (verified). json => single object;
  // streaming-json => line events.
  const args = ["-p", String(prompt ?? ""), "--output-format", outputFormat];
  if (model) args.push("-m", model);
  if (effort) args.push("--effort", effort);
  if (permissionMode) args.push("--permission-mode", permissionMode);
  if (alwaysApprove) args.push("--always-approve");
  if (continueLast) {
    args.push("-c");
  } else if (resumeSessionId) {
    args.push("-r", resumeSessionId);
  }
  if (extraArgs.length > 0) args.push(...extraArgs);
  return { bin, args };
}

export function extractGrokText(event) {
  if (!event || typeof event !== "object") return "";
  // streaming-json: {type:"text",data:"..."} carries the answer; thought events are reasoning.
  if (event.type === "text" && typeof event.data === "string") return event.data;
  return "";
}

function normalizeStopReason(stopReason) {
  return String(stopReason ?? "").trim().toLowerCase();
}

function isNonSuccessStopReason(stopReason) {
  if (stopReason == null || stopReason === "") return false;
  return !SUCCESS_STOP_REASONS.has(normalizeStopReason(stopReason));
}

function extractTerminalError(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.error === "string" && value.error.trim()) return value.error.trim();
  if (value.error && typeof value.error === "object") {
    // A nested error OBJECT is itself a terminal-error signal even without a type/is_error marker.
    // Recurse for deeper nesting, then pull its message/data, and fall back to a generic marker when
    // the object is non-empty but unlabeled. (An empty {} is not treated as an error.)
    const nested = extractTerminalError(value.error);
    if (nested) return nested;
    if (typeof value.error.message === "string" && value.error.message.trim()) return value.error.message.trim();
    if (typeof value.error.data === "string" && value.error.data.trim()) return value.error.data.trim();
    return Object.keys(value.error).length > 0 ? "grok emitted a terminal error" : null;
  }
  if (value.is_error === true || value.isError === true || value.type === "error") {
    if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
    if (typeof value.data === "string" && value.data.trim()) return value.data.trim();
    return "grok emitted a terminal error";
  }
  return null;
}

export function parseGrokStreamText(text) {
  const events = [];
  let response = "";
  let sessionId = null;
  let stopReason = null;
  let providerError = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    events.push(event);
    providerError = providerError || extractTerminalError(event);
    if (event.type === "text" && typeof event.data === "string") {
      response += event.data;
    } else if (event.type === "end") {
      if (typeof event.sessionId === "string") sessionId = event.sessionId;
      stopReason = event.stopReason ?? stopReason;
    }
  }

  return { events, response, sessionId, stopReason, providerError };
}

export function parseGrokJsonResult(stdout, stderr, status, { defaultModel = null } = {}) {
  const text = String(stdout ?? "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0 || status !== 0) {
    return {
      ok: false,
      error: String(stderr ?? "").trim() || formatProviderExitError("grok", status),
      status,
    };
  }
  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    const response = typeof parsed.text === "string" ? parsed.text : "";
    const hasVisibleText = Boolean(response.trim());
    const providerError = extractTerminalError(parsed);
    const stopReason = parsed.stopReason ?? null;
    const stopReasonError = isNonSuccessStopReason(stopReason)
      ? `grok stopped with ${stopReason}`
      : null;
    const error = providerError || stopReasonError || (hasVisibleText ? null : "grok produced no visible text");
    return {
      ok: hasVisibleText && !providerError && !stopReasonError,
      response,
      // grok emits the session id structurally; never scan prose for a UUID.
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      model: defaultModel ?? DEFAULT_GROK_MODEL,
      stopReason,
      error,
      status,
    };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${error.message}`, status };
  }
}

export function getGrokAvailability(cwd) {
  return binaryAvailable(GROK_BIN, ["--version"], { cwd });
}

function buildGrokAuthStatus(result) {
  // Inferred from `grok models` (no dedicated auth-status subcommand). It prints
  // "You are logged in with grok.com." + "Default model: <m>" when authed — zero LLM/token cost.
  if (result.error) {
    const detail = result.error.code === "ETIMEDOUT"
      ? `grok auth probe timed out after ${Math.round(AUTH_CHECK_TIMEOUT_MS / 1000)}s`
      : result.error.message;
    if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
    }
    return { loggedIn: false, detail };
  }

  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const defaultModel = (text.match(/Default model:\s*(\S+)/) || [])[1] ?? null;
  // Check explicit auth-failure phrasing BEFORE the "logged in" banner: the logged-out message
  // "not logged in" contains the substring "logged in", so the banner test must not win first.
  if (GROK_EXPLICIT_AUTH_ERROR_RE.test(text)) {
    return { loggedIn: false, detail: text.trim() || "grok is not logged in" };
  }
  if (/\blogged in\b/i.test(text)) {
    return { loggedIn: true, detail: "authenticated", model: defaultModel };
  }
  if (result.status !== 0) {
    const detail = text.trim() || `grok models exited with code ${result.status}`;
    if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: defaultModel };
    }
    return { loggedIn: false, detail };
  }
  // Exit 0 with a model listing but no explicit "logged in" banner → treat as authenticated.
  return { loggedIn: true, detail: "authenticated", model: defaultModel };
}

export function getGrokAuthStatus(cwd, { runner = runCommand } = {}) {
  const result = runner(GROK_BIN, ["models"], { cwd, timeout: AUTH_CHECK_TIMEOUT_MS });
  return buildGrokAuthStatus(result);
}

export function runGrokPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  alwaysApprove = true,
  permissionMode = null,
  effort = null,
  resumeSessionId = null,
  continueLast = false,
  extraArgs = [],
  defaultModel = null,
  bin = GROK_BIN,
} = {}) {
  const invocation = buildGrokInvocation({
    prompt,
    model,
    outputFormat: "json",
    permissionMode,
    alwaysApprove,
    effort,
    resumeSessionId,
    continueLast,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    const error = result.error.code === "ETIMEDOUT"
      ? `grok timed out after ${Math.round(timeout / 1000)}s`
      : result.error.message;
    return { ok: false, error, errorCode: classifyProviderFailure(error, { provider: "grok" }) };
  }

  // grok prints transient "ERROR worker quit ... UnexpectedContentType" lines to STDERR even on a
  // successful run, so success is judged ONLY by exit status + a valid stdout JSON envelope with
  // visible text — stderr content is never treated as failure here.
  const parsed = parseGrokJsonResult(result.stdout, result.stderr, result.status, {
    defaultModel: model ?? defaultModel,
  });
  return { ...parsed, errorCode: classifyProviderFailure(parsed.error, { provider: "grok" }) };
}

export function runGrokPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  alwaysApprove = true,
  permissionMode = null,
  effort = null,
  resumeSessionId = null,
  continueLast = false,
  extraArgs = [],
  defaultModel = null,
  onEvent = () => {},
  bin = GROK_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildGrokInvocation({
    prompt,
    model,
    outputFormat: "streaming-json",
    permissionMode,
    alwaysApprove,
    effort,
    resumeSessionId,
    continueLast,
    extraArgs,
    bin,
  });

  return spawnStreamingCommand({
    bin: invocation.bin,
    args: invocation.args,
    cwd,
    env: { ...process.env },
    timeout,
    spawnImpl,
    onStdoutLine(line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        onEvent(JSON.parse(trimmed));
      } catch {}
    },
  }).then((result) => {
    const parsed = parseGrokStreamText(result.stdout);
    const hasVisibleText = Boolean(parsed.response.trim());
    const stopReasonError = isNonSuccessStopReason(parsed.stopReason)
      ? `grok stopped with ${parsed.stopReason}`
      : null;
    const ok = result.ok && hasVisibleText && !parsed.providerError && !stopReasonError;
    const error = ok
      ? null
      : (parsed.providerError || stopReasonError || (result.ok ? "grok produced no visible text" : result.error));
    return {
      ...result,
      ...parsed,
      model: model ?? defaultModel ?? DEFAULT_GROK_MODEL,
      ok,
      error,
      errorCode: classifyProviderFailure(error, { provider: "grok" }),
    };
  });
}
