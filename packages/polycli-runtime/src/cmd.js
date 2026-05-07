import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const CMD_BIN = process.env.CMD_CLI_BIN || "cmd";
const DEFAULT_CMD_MODEL = "deepseek";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const CMD_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];

export function buildCmdInvocation({
  prompt,
  skipOnboarding = true,
  yolo = true,
  extraArgs = [],
  bin = CMD_BIN,
} = {}) {
  const args = [];
  if (skipOnboarding) args.push("--skip-onboarding");
  if (yolo) args.push("--yolo");
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push("-p", String(prompt ?? ""));
  return { bin, args };
}

export function extractCmdText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (event.type === "text_delta" && typeof event.delta === "string") {
    return event.delta;
  }
  if (event.type === "result" && typeof event.text === "string") {
    return event.text;
  }
  return "";
}

function textEventsFromStdout(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .map((line) => ({ type: "text_delta", delta: line }));
}

export function parseCmdTextResult(stdout) {
  const response = String(stdout ?? "").trim();
  const events = textEventsFromStdout(stdout);
  return { response, events };
}

export function getCmdAvailability(cwd) {
  return binaryAvailable(CMD_BIN, ["--version"], { cwd });
}

function buildCmdAuthStatus(result) {
  const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status === 0 && /\bauthenticated\b/i.test(detail)) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: DEFAULT_CMD_MODEL,
    };
  }
  if (result.error) {
    const message = result.error.code === "ETIMEDOUT"
      ? `cmd auth probe timed out after ${Math.round(AUTH_CHECK_TIMEOUT_MS / 1000)}s`
      : result.error.message;
    if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${message}`, model: DEFAULT_CMD_MODEL };
    }
    return { loggedIn: false, detail: message };
  }

  const fallback = detail || "cmd auth probe failed";
  if (CMD_EXPLICIT_AUTH_ERROR_RE.test(fallback)) {
    return { loggedIn: false, detail: fallback };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(fallback))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${fallback}`, model: DEFAULT_CMD_MODEL };
  }
  return { loggedIn: false, detail: fallback };
}

export function getCmdAuthStatus(cwd, { bin = CMD_BIN } = {}) {
  const result = runCommand(bin, ["status"], { cwd, timeout: AUTH_CHECK_TIMEOUT_MS });
  return buildCmdAuthStatus(result);
}

export function runCmdPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  env = process.env,
  extraArgs = [],
  yolo = true,
  defaultModel = null,
  bin = CMD_BIN,
} = {}) {
  const invocation = buildCmdInvocation({
    prompt,
    yolo,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout, env });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT"
        ? `cmd timed out after ${Math.round(timeout / 1000)}s`
        : result.error.message,
    };
  }

  const parsed = parseCmdTextResult(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"],
  });
  const hasVisibleText = Boolean(parsed.response.trim());

  return {
    ok: result.status === 0 && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: resolvedSession.sessionId,
    model: model ?? defaultModel ?? DEFAULT_CMD_MODEL,
    error: result.status === 0
      ? (hasVisibleText ? null : "cmd produced no visible text")
      : (result.stderr.trim() || formatProviderExitError("cmd", result.status)),
    status: result.status,
  };
}

export function runCmdPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  env = process.env,
  extraArgs = [],
  yolo = true,
  defaultModel = null,
  onEvent = () => {},
  bin = CMD_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildCmdInvocation({
    prompt,
    yolo,
    extraArgs,
    bin,
  });

  return spawnStreamingCommand({
    bin: invocation.bin,
    args: invocation.args,
    cwd,
    env: { ...env },
    timeout,
    spawnImpl,
    onStdoutLine(line) {
      const trimmed = line.trimEnd();
      if (!trimmed.trim()) return;
      onEvent({ type: "text_delta", delta: trimmed });
    },
  }).then((result) => {
    const parsed = parseCmdTextResult(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: resolvedSession.sessionId,
      model: model ?? defaultModel ?? DEFAULT_CMD_MODEL,
      ok: result.ok && hasVisibleText,
      error: result.ok
        ? (hasVisibleText ? null : "cmd produced no visible text")
        : result.error,
    };
  });
}
