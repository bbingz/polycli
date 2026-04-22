import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { spawnStreamingCommand } from "./spawn.js";

const PI_BIN = process.env.PI_CLI_BIN || "pi";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
const PI_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;

function collectPiContentText(content) {
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

export function buildPiInvocation({
  prompt,
  model = null,
  mode = "json",
  resumeSessionId = null,
  continueLast = false,
  noSession = false,
  extraArgs = [],
  bin = PI_BIN,
} = {}) {
  const args = ["--print", "--mode", mode];

  if (model) args.push("--model", model);
  if (resumeSessionId) args.push("--session", resumeSessionId);
  else if (continueLast) args.push("--continue");
  if (noSession) args.push("--no-session");
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push(String(prompt ?? ""));

  return { bin, args };
}

export function extractPiText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  if (event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
    return event.assistantMessageEvent.delta;
  }
  if (event.type === "agent_end" && typeof event.result?.text === "string") {
    return event.result.text;
  }
  if (typeof event.text === "string") {
    return event.text;
  }

  const role = event.role ?? event.message?.role ?? null;
  if (role && role !== "assistant") {
    return "";
  }

  return collectPiContentText(event.content ?? event.message?.content);
}

export function parsePiStreamText(text) {
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
    if (!sessionId && event.type === "session" && typeof event.id === "string") sessionId = event.id;
    if (!sessionId && typeof event.sessionId === "string") sessionId = event.sessionId;
    if (!sessionId && typeof event.session?.id === "string") sessionId = event.session.id;
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.session?.model === "string") model = event.session.model;
    if (event.type === "agent_end") {
      resultEvent = event;
      if (!response.trim()) {
        response += extractPiText(event);
      }
      continue;
    }

    response += extractPiText(event);
  }

  return { events, response, sessionId, model, resultEvent };
}

export function getPiAvailability(cwd) {
  return binaryAvailable(PI_BIN, ["--version"], { cwd });
}

function buildPiAuthStatus(result) {
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? null,
    };
  }

  const detail = String(result.error ?? "").trim() || "pi auth probe failed";
  if (PI_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (PI_TRANSIENT_PROBE_ERROR_RE.test(detail)) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: result.model ?? null };
  }
  return { loggedIn: false, detail };
}

export function getPiAuthStatus(cwd, { promptRunner = runPiPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
  });
  return buildPiAuthStatus(result);
}

export function runPiPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  noSession = false,
  bin = PI_BIN,
} = {}) {
  const invocation = buildPiInvocation({
    prompt,
    model,
    mode: "json",
    resumeSessionId,
    continueLast,
    noSession,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT"
        ? `pi timed out after ${Math.round(timeout / 1000)}s`
        : result.error.message,
    };
  }

  const parsed = parsePiStreamText(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"],
  });
  const resultError = parsed.resultEvent?.error
    ? String(parsed.resultEvent.error)
    : null;
  const hasVisibleText = Boolean(parsed.response.trim());

  return {
    ok: result.status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    model: parsed.model,
    error: result.status === 0
      ? (resultError || (hasVisibleText ? null : "pi produced no visible text"))
      : (result.stderr.trim() || `pi exited with code ${result.status}`),
    status: result.status,
  };
}

export function runPiPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  noSession = false,
  onEvent = () => {},
  bin = PI_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildPiInvocation({
    prompt,
    model,
    mode: "json",
    resumeSessionId,
    continueLast,
    noSession,
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
    const parsed = parsePiStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const resultError = parsed.resultEvent?.error
      ? String(parsed.resultEvent.error)
      : null;
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok
        ? (resultError || (hasVisibleText ? null : "pi produced no visible text"))
        : result.error,
    };
  });
}
