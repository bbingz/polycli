import { binaryAvailable, getSafeArgvBudgetBytes, runCommand } from "@bbingz/polycli-utils/process";
import { matchResumeSessionIdLine } from "@bbingz/polycli-utils/session-id";

import { classifyProviderFailure, formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const COPILOT_BIN = process.env.COPILOT_CLI_BIN || "copilot";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const SAFE_PROMPT_ARGV_BUDGET_BYTES = getSafeArgvBudgetBytes();
const SAFE_PROMPT_ARGV_BUDGET_HINT = "Prompt exceeds the safe argv budget. When using review, pass --max-diff-bytes explicitly.";
const COPILOT_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];

function collectCopilotContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function getCopilotResultError(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  if (event.type === "error") {
    if (typeof event.error?.message === "string" && event.error.message.trim()) {
      return event.error.message;
    }
    if (typeof event.error === "string" && event.error.trim()) {
      return event.error;
    }
    return "copilot returned an error";
  }
  if (event.type !== "result" && event.type !== "final") {
    return null;
  }
  if (event.is_error) {
    return typeof event.result === "string" ? event.result : "copilot returned an error";
  }
  if (typeof event.error?.message === "string" && event.error.message.trim()) {
    return event.error.message;
  }
  if (typeof event.error === "string" && event.error.trim()) {
    return event.error;
  }
  if (event.exitCode && event.exitCode !== 0) {
    return formatProviderExitError("copilot", event.exitCode);
  }
  if (event.status && event.status !== 0) {
    return formatProviderExitError("copilot", event.status);
  }
  return null;
}

export function buildCopilotInvocation({
  prompt,
  model = null,
  outputFormat = "json",
  stream = "off",
  resumeSessionId = null,
  continueLast = false,
  allowAllTools = true,
  allowAllPaths = true,
  allowAllUrls = true,
  noAskUser = true,
  extraArgs = [],
  bin = COPILOT_BIN,
} = {}) {
  const args = [
    "-p",
    String(prompt ?? ""),
    "--output-format",
    outputFormat,
    "--stream",
    stream,
  ];

  if (allowAllTools) args.push("--allow-all-tools");
  if (allowAllPaths) args.push("--allow-all-paths");
  if (allowAllUrls) args.push("--allow-all-urls");
  if (noAskUser) args.push("--no-ask-user");
  if (model) {
    args.push("--model", model);
  }
  if (resumeSessionId) {
    // Resume by exact id uses `--session-id <id>`. copilot's `-r, --resume[=value]` takes an
    // OPTIONAL `=`-attached value (or opens the session picker), so a space-separated
    // `--resume <id>` would not resume by id — `--session-id <id>` is the documented by-id flag.
    args.push("--session-id", resumeSessionId);
  } else if (continueLast) {
    args.push("--continue");
  }
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return { bin, args };
}

export function extractCopilotText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  if (event.type === "assistant.message_delta" && typeof event.data?.deltaContent === "string") {
    return event.data.deltaContent;
  }
  if (event.type === "assistant.message" && typeof event.data?.content === "string") {
    return event.data.content;
  }
  if (
    (event.type === "result" || event.type === "final") &&
    typeof event.result === "string"
  ) {
    return event.result;
  }

  const role = event.role ?? event.message?.role ?? null;
  if (role && role !== "assistant") {
    return "";
  }

  if (typeof event.delta === "string") return event.delta;
  if (typeof event.text === "string") return event.text;

  return collectCopilotContentText(event.content ?? event.message?.content);
}

export function parseCopilotStreamText(text) {
  const events = [];
  let response = "";
  let sessionId = null;
  let model = null;
  let resultEvent = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    events.push(event);
    const eventSessionId = typeof event.sessionId === "string"
      ? event.sessionId
      : (typeof event.session_id === "string"
        ? event.session_id
        : (typeof event.session?.id === "string" ? event.session.id : event.data?.sessionId));
    const isTerminalEvent = event.type === "result" || event.type === "final" || event.type === "error";
    if (typeof eventSessionId === "string" && (!sessionId || isTerminalEvent)) {
      sessionId = eventSessionId;
    }
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.session?.model === "string") model = event.session.model;
    if (!model && typeof event.data?.model === "string") model = event.data.model;
    if (event.type === "assistant.message" && typeof event.data?.content === "string") {
      if (!response.trim() || event.data.content.startsWith(response)) {
        response = event.data.content;
      } else {
        response = `${response}\n${event.data.content}`;
      }
      continue;
    }
    if (isTerminalEvent) {
      resultEvent = event;
      if (!response.trim()) {
        response += extractCopilotText(event);
      }
      continue;
    }

    response += extractCopilotText(event);
  }

  return { events, response, sessionId, model, resultEvent };
}

function getCopilotResumeStatus(resumeSessionId, sessionId) {
  if (!resumeSessionId) return null;
  if (typeof sessionId !== "string" || sessionId.length === 0) return "unverified";
  return sessionId === resumeSessionId ? "resumed" : "not_resumed";
}

export function getCopilotAvailability(cwd) {
  return binaryAvailable(COPILOT_BIN, ["--version"], { cwd });
}

export function getCopilotAuthStatus(cwd, { promptRunner = runCopilotPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
  });

  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? null,
    };
  }

  // A timeout / 429 / transient probe failure must NOT regress to loggedIn:false.
  const detail = String(result.error ?? "").trim() || "copilot auth probe failed";
  if (COPILOT_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: result.model ?? null };
  }
  return { loggedIn: false, detail };
}

export function runCopilotPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  allowAllTools = true,
  allowAllPaths = true,
  allowAllUrls = true,
  noAskUser = true,
  bin = COPILOT_BIN,
  env = process.env,
  spawnImpl,
  argvBudgetBytes = SAFE_PROMPT_ARGV_BUDGET_BYTES,
} = {}) {
  const invocation = buildCopilotInvocation({
    prompt,
    model,
    outputFormat: "json",
    stream: "off",
    resumeSessionId,
    continueLast,
    allowAllTools,
    allowAllPaths,
    allowAllUrls,
    noAskUser,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    timeout,
    env,
    spawnImpl,
    argvBudgetBytes,
    argvBudgetHint: SAFE_PROMPT_ARGV_BUDGET_HINT,
  });
  if (result.error) {
    return {
      ok: false,
      resumeStatus: getCopilotResumeStatus(resumeSessionId, null),
      error: result.error.code === "ETIMEDOUT"
        ? `copilot timed out after ${Math.round(timeout / 1000)}s`
        : result.error.message,
      errorCode: classifyProviderFailure(result.error, { provider: "copilot" }),
      spawnErrorCode: result.spawnErrorCode ?? null,
    };
  }

  const parsed = parseCopilotStreamText(result.stdout);
  const resultError = getCopilotResultError(parsed.resultEvent);
  const hasVisibleText = Boolean(parsed.response.trim());
  const sessionId = parsed.sessionId ?? matchResumeSessionIdLine(result.stderr);

  return {
    ok: result.status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId,
    resumeStatus: getCopilotResumeStatus(resumeSessionId, sessionId),
    model: parsed.model,
    error: result.status === 0
      ? (resultError || (hasVisibleText ? null : "copilot produced no visible text"))
      : (result.stderr.trim() || formatProviderExitError("copilot", result.status)),
    status: result.status,
  };
}

export function runCopilotPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  allowAllTools = true,
  allowAllPaths = true,
  allowAllUrls = true,
  noAskUser = true,
  onEvent = () => {},
  bin = COPILOT_BIN,
  spawnImpl,
  env = process.env,
  argvBudgetBytes = SAFE_PROMPT_ARGV_BUDGET_BYTES,
} = {}) {
  const invocation = buildCopilotInvocation({
    prompt,
    model,
    outputFormat: "json",
    stream: "on",
    resumeSessionId,
    continueLast,
    allowAllTools,
    allowAllPaths,
    allowAllUrls,
    noAskUser,
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
    argvBudgetBytes,
    argvBudgetHint: SAFE_PROMPT_ARGV_BUDGET_HINT,
    onStdoutLine(line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        onEvent(JSON.parse(trimmed));
      } catch {}
    },
  }).then((result) => {
    const parsed = parseCopilotStreamText(result.stdout);
    const resultError = getCopilotResultError(parsed.resultEvent);
    const hasVisibleText = Boolean(parsed.response.trim());
    const sessionId = parsed.sessionId ?? matchResumeSessionIdLine(result.stderr);
    return {
      ...result,
      ...parsed,
      sessionId,
      resumeStatus: getCopilotResumeStatus(resumeSessionId, sessionId),
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok
        ? (resultError || (hasVisibleText ? null : "copilot produced no visible text"))
        : result.error,
    };
  });
}
