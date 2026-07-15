import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";

import { classifyProviderFailure, formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const AGY_BIN = process.env.AGY_CLI_BIN || "agy";
const DEFAULT_AGY_MODEL = null;
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const AGY_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];

const AGY_BENIGN_STDERR_RE = /^Shell cwd was reset/i;

export function buildAgyInvocation({
  prompt,
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  printTimeoutSeconds = null,
  extraArgs = [],
  bin = AGY_BIN,
} = {}) {
  const args = [];
  if (yolo) args.push("--dangerously-skip-permissions");
  if (sandbox) args.push("--sandbox");
  if (resumeConversationId) {
    args.push("--conversation", resumeConversationId);
  } else if (continueLast) {
    args.push("--continue");
  }
  for (const dir of addDirs) {
    args.push("--add-dir", dir);
  }
  if (printTimeoutSeconds && Number.isFinite(printTimeoutSeconds)) {
    args.push("--print-timeout", `${Math.max(1, Math.round(printTimeoutSeconds))}s`);
  }
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push("-p", String(prompt ?? ""));
  return { bin, args };
}

export function extractAgyText(event) {
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

export function parseAgyTextResult(stdout) {
  const response = String(stdout ?? "").trim();
  const events = textEventsFromStdout(stdout);
  return { response, events };
}

export function stripAgyBenignStderr(stderr) {
  return String(stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !AGY_BENIGN_STDERR_RE.test(line.trim()))
    .join("\n");
}

export function getAgyAvailability(cwd, { bin = AGY_BIN } = {}) {
  return binaryAvailable(bin, ["--help"], { cwd });
}

function buildAgyAuthStatus(result) {
  // Inspect both error AND response text: a logged-out agy may print a
  // sign-in notice to stdout and still exit 0, so checking only `error`
  // (or only `ok`) would misreport it as authenticated.
  const probeText = `${String(result.error ?? "")}\n${String(result.response ?? "")}`.trim();

  if (AGY_EXPLICIT_AUTH_ERROR_RE.test(probeText)) {
    return { loggedIn: false, detail: probeText };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(probeText))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${probeText}`, model: DEFAULT_AGY_MODEL };
  }
  // A clean exit with no auth signal means authenticated even when the probe
  // produced no visible text; do not couple auth to the visible-text gate.
  if (result.ok || result.status === 0) {
    return { loggedIn: true, detail: "authenticated", model: DEFAULT_AGY_MODEL };
  }
  return { loggedIn: false, detail: probeText || "agy auth probe failed" };
}

export function getAgyAuthStatus(cwd, { promptRunner = runAgyPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
    yolo: true,
  });
  return buildAgyAuthStatus(result);
}

export function runAgyPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  env = process.env,
  extraArgs = [],
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  defaultModel = null,
  bin = AGY_BIN,
} = {}) {
  const printTimeoutSeconds = Math.max(5, Math.floor((timeout - 5_000) / 1000));
  const invocation = buildAgyInvocation({
    prompt,
    yolo,
    continueLast,
    resumeConversationId,
    sandbox,
    addDirs,
    printTimeoutSeconds,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout, env });
  if (result.error) {
    const error = result.error.code === "ETIMEDOUT"
      ? `agy timed out after ${Math.round(timeout / 1000)}s`
      : result.error.message;
    return {
      ok: false,
      error,
      errorCode: classifyProviderFailure(error, { provider: "agy" }),
    };
  }

  const parsed = parseAgyTextResult(result.stdout);
  const filteredStderr = stripAgyBenignStderr(result.stderr);
  const hasVisibleText = Boolean(parsed.response.trim());
  const error = result.status === 0
    ? (hasVisibleText ? null : "agy produced no visible text")
    : (filteredStderr.trim() || formatProviderExitError("agy", result.status));

  return {
    ok: result.status === 0 && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    // agy stdout is pure assistant text and carries no session id; never scan
    // it for a UUID, which would fabricate one (spec: sessionId always null).
    sessionId: null,
    model: model ?? defaultModel ?? DEFAULT_AGY_MODEL,
    error,
    errorCode: classifyProviderFailure(error, { provider: "agy" }),
    status: result.status,
  };
}

export function runAgyPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  env = process.env,
  extraArgs = [],
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  defaultModel = null,
  onEvent = () => {},
  bin = AGY_BIN,
  spawnImpl,
} = {}) {
  const printTimeoutSeconds = Math.max(5, Math.floor((timeout - 5_000) / 1000));
  const invocation = buildAgyInvocation({
    prompt,
    yolo,
    continueLast,
    resumeConversationId,
    sandbox,
    addDirs,
    printTimeoutSeconds,
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
    const parsed = parseAgyTextResult(result.stdout);
    const filteredStderr = stripAgyBenignStderr(result.stderr);
    const hasVisibleText = Boolean(parsed.response.trim());
    const error = !result.ok && result.errorCode
      ? result.error
      : (result.ok
          ? (hasVisibleText ? null : "agy produced no visible text")
          : (filteredStderr.trim() || result.error));
    return {
      ...result,
      ...parsed,
      // See sync path: agy carries no session id; always null, never scraped.
      sessionId: null,
      model: model ?? defaultModel ?? DEFAULT_AGY_MODEL,
      ok: result.ok && hasVisibleText,
      error,
      errorCode: result.errorCode ?? classifyProviderFailure(error, { provider: "agy" }),
    };
  });
}
