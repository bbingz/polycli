import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { spawnStreamingCommand } from "./spawn.js";

const OPENCODE_BIN = process.env.OPENCODE_CLI_BIN || "opencode";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const OPENCODE_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
const OPENCODE_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;

function collectOpenCodeContentText(content) {
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

export function buildOpenCodeInvocation({
  prompt,
  model = null,
  cwd,
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  extraArgs = [],
  bin = OPENCODE_BIN,
} = {}) {
  const args = [
    "run",
    String(prompt ?? ""),
    "--format",
    "json",
    "--dir",
    cwd || process.cwd(),
    "--dangerously-skip-permissions",
  ];

  if (model) args.push("--model", model);
  if (agent) args.push("--agent", agent);
  if (variant) args.push("--variant", variant);
  if (resumeSessionId) args.push("--session", resumeSessionId);
  else if (continueLast) args.push("--continue");
  if (extraArgs.length > 0) args.push(...extraArgs);

  return { bin, args };
}

export function extractOpenCodeText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  if (event.type === "result" && typeof event.text === "string") {
    return event.text;
  }
  if (event.type === "text" && typeof event.part?.text === "string") {
    return event.part.text;
  }
  if (typeof event.delta === "string") return event.delta;
  if (typeof event.text === "string") return event.text;
  if (typeof event.part?.text === "string") return event.part.text;

  const role = event.role ?? event.message?.role ?? null;
  if (role && role !== "assistant") {
    return "";
  }

  return collectOpenCodeContentText(event.content ?? event.message?.content);
}

export function parseOpenCodeStreamText(text) {
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
    if (!sessionId && typeof event.sessionId === "string") sessionId = event.sessionId;
    if (!sessionId && typeof event.sessionID === "string") sessionId = event.sessionID;
    if (!sessionId && typeof event.session?.id === "string") sessionId = event.session.id;
    if (!sessionId && typeof event.part?.sessionID === "string") sessionId = event.part.sessionID;
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.session?.model === "string") model = event.session.model;
    if (!model && typeof event.part?.model === "string") model = event.part.model;
    if (event.type === "result") {
      resultEvent = event;
      if (!response.trim()) {
        response += extractOpenCodeText(event);
      }
      continue;
    }

    response += extractOpenCodeText(event);
  }

  return { events, response, sessionId, model, resultEvent };
}

export function parseOpenCodeJsonResult(stdout, stderr, status) {
  const parsed = parseOpenCodeStreamText(stdout);
  const resolvedSession = resolveSessionId({
    stdout,
    stderr,
    priority: ["stdout", "stderr", "file"],
  });
  const resultError = parsed.resultEvent?.error
    ? String(parsed.resultEvent.error)
    : null;
  const hasVisibleText = Boolean(parsed.response.trim());

  return {
    ok: status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    model: parsed.model,
    status,
    error: status === 0
      ? (resultError || (hasVisibleText ? null : "opencode produced no visible text"))
      : (String(stderr ?? "").trim() || `opencode exited with code ${status}`),
  };
}

export function getOpenCodeAvailability(cwd) {
  return binaryAvailable(OPENCODE_BIN, ["--version"], { cwd });
}

function buildOpenCodeAuthStatus(result) {
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? null,
    };
  }

  const detail = String(result.error ?? "").trim() || "opencode auth probe failed";
  if (OPENCODE_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (OPENCODE_TRANSIENT_PROBE_ERROR_RE.test(detail)) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: result.model ?? null };
  }
  return { loggedIn: false, detail };
}

export function getOpenCodeAuthStatus(cwd, { promptRunner = runOpenCodePrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
  });
  return buildOpenCodeAuthStatus(result);
}

export function runOpenCodePrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  bin = OPENCODE_BIN,
} = {}) {
  const invocation = buildOpenCodeInvocation({
    prompt,
    model,
    cwd,
    resumeSessionId,
    continueLast,
    agent,
    variant,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT"
        ? `opencode timed out after ${Math.round(timeout / 1000)}s`
        : result.error.message,
    };
  }

  return parseOpenCodeJsonResult(result.stdout, result.stderr, result.status);
}

export function runOpenCodePromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  onEvent = () => {},
  bin = OPENCODE_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildOpenCodeInvocation({
    prompt,
    model,
    cwd,
    resumeSessionId,
    continueLast,
    agent,
    variant,
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
    const parsed = parseOpenCodeStreamText(result.stdout);
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
        ? (resultError || (hasVisibleText ? null : "opencode produced no visible text"))
        : result.error,
    };
  });
}
