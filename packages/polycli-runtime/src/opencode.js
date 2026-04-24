import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const OPENCODE_BIN = process.env.OPENCODE_CLI_BIN || "opencode";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const SESSION_EXPORT_TIMEOUT_MS = 30_000;
const OPENCODE_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];

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

function getOpenCodeResultError(event) {
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
    return "opencode returned an error";
  }
  if (event.type !== "result") {
    return null;
  }
  if (typeof event.error?.message === "string" && event.error.message.trim()) {
    return event.error.message;
  }
  if (typeof event.error === "string" && event.error.trim()) {
    return event.error;
  }
  if (Number.isFinite(event.exitCode) && event.exitCode !== 0) {
    return formatProviderExitError("opencode", event.exitCode);
  }
  if (Number.isFinite(event.status) && event.status !== 0) {
    return formatProviderExitError("opencode", event.status);
  }
  return null;
}

function formatOpenCodeModel(info) {
  if (!info || typeof info !== "object") return null;
  const providerID = typeof info.providerID === "string" ? info.providerID : null;
  const modelID = typeof info.modelID === "string" ? info.modelID : null;
  if (providerID && modelID) return `${providerID}/${modelID}`;
  if (modelID) return modelID;
  return null;
}

function findOpenCodeExportModel(value) {
  if (!value || typeof value !== "object") return null;

  const direct = formatOpenCodeModel(value);
  if (direct) return direct;

  if (typeof value.model === "string" && value.model.trim()) return value.model;
  const nested = formatOpenCodeModel(value.model);
  if (nested) return nested;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOpenCodeExportModel(item);
      if (found) return found;
    }
    return null;
  }

  for (const item of Object.values(value)) {
    const found = findOpenCodeExportModel(item);
    if (found) return found;
  }
  return null;
}

function extractOpenCodeExportModel(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try {
    return findOpenCodeExportModel(JSON.parse(raw.slice(start)));
  } catch {
    return null;
  }
}

function resolveOpenCodeSessionModel(sessionId, { cwd, env, bin = OPENCODE_BIN } = {}) {
  if (!sessionId) return null;
  const result = runCommand(bin, ["export", sessionId], {
    cwd,
    env,
    timeout: SESSION_EXPORT_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) return null;
  return extractOpenCodeExportModel(result.stdout);
}

export function buildOpenCodeInvocation({
  prompt,
  model = null,
  cwd,
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  skipPermissions = true,
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
  ];

  if (skipPermissions) args.push("--dangerously-skip-permissions");
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
  if (event.type === "message.delta" && typeof event.delta === "string") return event.delta;

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
    if (event.type === "result" || event.type === "error") {
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

export function parseOpenCodeJsonResult(stdout, stderr, status, { defaultModel = null } = {}) {
  const parsed = parseOpenCodeStreamText(stdout);
  const resolvedSession = resolveSessionId({
    stdout,
    stderr,
    priority: ["stdout", "stderr", "file"],
  });
  const resultError = getOpenCodeResultError(parsed.resultEvent);
  const hasVisibleText = Boolean(parsed.response.trim());

  return {
    ok: status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    model: parsed.model ?? defaultModel,
    status,
    error: status === 0
      ? (resultError || (hasVisibleText ? null : "opencode produced no visible text"))
      : (String(stderr ?? "").trim() || formatProviderExitError("opencode", status)),
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
  if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
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
  env = process.env,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  skipPermissions = true,
  defaultModel = null,
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
    skipPermissions,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout, env });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT"
        ? `opencode timed out after ${Math.round(timeout / 1000)}s`
        : result.error.message,
    };
  }

  const parsed = parseOpenCodeJsonResult(result.stdout, result.stderr, result.status, {
    defaultModel: model ?? defaultModel,
  });
  if (parsed.ok && !parsed.model && parsed.sessionId) {
    const exportedModel = resolveOpenCodeSessionModel(parsed.sessionId, { cwd, env, bin });
    if (exportedModel) return { ...parsed, model: exportedModel };
  }
  return parsed;
}

export function runOpenCodePromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  env = process.env,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  skipPermissions = true,
  defaultModel = null,
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
    skipPermissions,
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
    const resultError = getOpenCodeResultError(parsed.resultEvent);
    const hasVisibleText = Boolean(parsed.response.trim());
    let resolvedModel = parsed.model ?? model ?? defaultModel;
    const ok = result.ok && !resultError && hasVisibleText;
    if (ok && !resolvedModel) {
      resolvedModel = resolveOpenCodeSessionModel(parsed.sessionId ?? resolvedSession.sessionId, { cwd, env, bin });
    }
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      model: resolvedModel,
      ok,
      error: result.ok
        ? (resultError || (hasVisibleText ? null : "opencode produced no visible text"))
        : result.error,
    };
  });
}
