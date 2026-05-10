import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { classifyProviderFailure, formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PROMPT_STDIN_THRESHOLD_BYTES = 100_000;
const KIMI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
const KIMI_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];
const KIMI_CONFIG_PATH = process.env.KIMI_CONFIG_PATH || path.join(os.homedir(), ".kimi", "config.toml");

function isKimiResumeFooter(text) {
  return /^To resume:\s*kimi\s+-r\s+/im.test(String(text ?? "").trim());
}

function kimiJsonPath() {
  return path.join(os.homedir(), ".kimi", "kimi.json");
}

function kimiSessionsDir() {
  return path.join(os.homedir(), ".kimi", "sessions");
}

function resolveRealCwd(cwd) {
  return fs.realpathSync(cwd || process.cwd());
}

function md5CwdPath(realCwd) {
  return createHash("md5").update(realCwd).digest("hex");
}

function formatKimiResumeError(reason, { sessionId, cwd, errCode } = {}) {
  const cwdBase = cwd ? path.basename(cwd) : "?";
  if (reason === "invalid-uuid") return "invalid sessionId format; expected UUID.";
  if (reason === "no-prior-session") return `no prior kimi session for this directory (${cwdBase}). Use /polycli:ask --provider kimi to start one.`;
  if (reason === "kimi-json-malformed") return "~/.kimi/kimi.json is malformed; cannot resolve last session.";
  if (reason === "session-not-found") return `session ${sessionId} not found for this directory (${cwdBase}).`;
  if (reason === "session-empty") return `session ${sessionId} has no stored messages; cannot resume.`;
  if (reason === "fs-error") return `filesystem access failed${errCode ? ` — ${errCode}` : ""}. Check permissions on ~/.kimi/.`;
  return `kimi resume validation failed: ${reason}`;
}

function readKimiLastSession(realCwd) {
  let raw;
  try {
    raw = fs.readFileSync(kimiJsonPath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, reason: "no-prior-session" };
    return { ok: false, reason: "fs-error", errCode: error.code };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "kimi-json-malformed" };
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.work_dirs)) {
    return { ok: false, reason: "kimi-json-malformed" };
  }

  const entry = parsed.work_dirs.find((item) => item && item.path === realCwd && item.kaos === "local");
  if (!entry || typeof entry.last_session_id !== "string" || entry.last_session_id.length === 0) {
    return { ok: false, reason: "no-prior-session" };
  }
  return { ok: true, sessionId: entry.last_session_id };
}

function validateKimiResumeTarget({ realCwd, cwdHash, sessionId }) {
  if (typeof sessionId !== "string" || !KIMI_UUID_RE.test(sessionId)) {
    return { ok: false, reason: "invalid-uuid" };
  }

  const sessionDir = path.join(kimiSessionsDir(), cwdHash, sessionId);
  const contextPath = path.join(sessionDir, "context.jsonl");
  try {
    const dirStat = fs.statSync(sessionDir);
    if (!dirStat.isDirectory()) {
      return { ok: false, reason: "session-not-found" };
    }
    const contextStat = fs.statSync(contextPath);
    if (!contextStat.isFile() || contextStat.size === 0) {
      return { ok: false, reason: "session-empty" };
    }
    return { ok: true };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        ok: false,
        reason: fs.existsSync(sessionDir) ? "session-empty" : "session-not-found",
      };
    }
    return { ok: false, reason: "fs-error", errCode: error.code, realCwd };
  }
}

export function resolveKimiResumeSession({
  cwd,
  resumeSessionId = null,
  resumeLast = false,
  fresh = false,
} = {}) {
  let realCwd;
  try {
    realCwd = resolveRealCwd(cwd);
  } catch (error) {
    return {
      ok: false,
      status: 1,
      error: formatKimiResumeError("fs-error", { errCode: error.code }),
      reason: "fs-error",
      cwdHash: null,
      realCwd: null,
    };
  }
  const cwdHash = md5CwdPath(realCwd);
  if (fresh || (!resumeSessionId && !resumeLast)) {
    return { ok: true, sessionId: null, cwdHash, realCwd };
  }
  if (resumeSessionId && resumeLast) {
    return {
      ok: false,
      status: 2,
      error: "Choose only one of --resume-last, --resume, or --fresh.",
      reason: "mutually-exclusive-resume-flags",
      cwdHash,
      realCwd,
    };
  }

  let sessionId = resumeSessionId;
  if (resumeLast) {
    const last = readKimiLastSession(realCwd);
    if (!last.ok) {
      return {
        ok: false,
        status: last.reason === "invalid-uuid" ? 2 : 1,
        error: formatKimiResumeError(last.reason, { cwd: realCwd, errCode: last.errCode }),
        reason: last.reason,
        cwdHash,
        realCwd,
      };
    }
    sessionId = last.sessionId;
  }

  const validation = validateKimiResumeTarget({ realCwd, cwdHash, sessionId });
  if (!validation.ok) {
    return {
      ok: false,
      status: validation.reason === "invalid-uuid" ? 2 : 1,
      error: formatKimiResumeError(validation.reason, {
        sessionId,
        cwd: realCwd,
        errCode: validation.errCode,
      }),
      reason: validation.reason,
      cwdHash,
      realCwd,
    };
  }

  return { ok: true, sessionId, cwdHash, realCwd };
}

function readKimiDefaultModel() {
  try {
    const text = fs.readFileSync(KIMI_CONFIG_PATH, "utf8");
    const match = text.match(/^default_model\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m);
    return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
  } catch {
    return null;
  }
}

export function buildKimiInvocation({
  prompt,
  model = null,
  resumeSessionId = null,
  yolo = true,
  extraArgs = [],
  bin = KIMI_BIN,
} = {}) {
  const promptText = String(prompt ?? "");
  const useStdin = Buffer.byteLength(promptText, "utf8") >= PROMPT_STDIN_THRESHOLD_BYTES;
  const args = ["--print", "--output-format", "stream-json"];

  if (useStdin) {
    args.push("--input-format", "text");
  } else {
    args.unshift("-p", promptText);
  }

  if (yolo) args.push("--yolo");
  if (model) args.push("-m", model);
  if (resumeSessionId) args.push("-r", resumeSessionId);
  if (extraArgs.length > 0) args.push(...extraArgs);

  return {
    bin,
    args,
    input: useStdin ? promptText : undefined,
    useStdin,
  };
}

function parseKimiEventLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function extractKimiText(event) {
  if (!event || event.role !== "assistant") {
    return "";
  }
  if (typeof event.content === "string") {
    return event.content;
  }
  if (!Array.isArray(event.content)) {
    return "";
  }

  return event.content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

export function parseKimiStreamText(text) {
  const events = [];
  const toolEvents = [];
  let response = "";
  let model = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const event = parseKimiEventLine(rawLine);
    if (!event) continue;
    events.push(event);
    if (event.role === "tool") toolEvents.push(event);
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.message?.model === "string") model = event.message.model;
    response += extractKimiText(event);
  }

  return { events, toolEvents, response, model };
}

export function getKimiAvailability(cwd) {
  return binaryAvailable(KIMI_BIN, ["-V"], { cwd });
}

function buildKimiAuthStatus(result) {
  const configModel = readKimiDefaultModel();
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? configModel,
    };
  }

  const detail = String(result.error ?? "").trim() || "kimi auth probe failed";
  if (KIMI_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: result.model ?? configModel };
  }
  return { loggedIn: false, detail };
}

export function getKimiAuthStatus(cwd, { promptRunner = runKimiPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
    extraArgs: ["--max-steps-per-turn", "1"],
  });
  return buildKimiAuthStatus(result);
}

export function runKimiPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  resumeLast = false,
  fresh = false,
  yolo = true,
  defaultModel = null,
  bin = KIMI_BIN,
} = {}) {
  const resume = resolveKimiResumeSession({ cwd, resumeSessionId, resumeLast, fresh });
  if (!resume.ok) {
    return { ok: false, error: resume.error, status: resume.status };
  }
  const invocation = buildKimiInvocation({
    prompt,
    model,
    resumeSessionId: resume.sessionId,
    yolo,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    timeout,
    input: invocation.input,
  });

  if (result.error) {
    const error = result.error.message;
    return { ok: false, error, errorCode: classifyProviderFailure(error, { provider: "kimi" }) };
  }
  if (result.status !== 0) {
    const error = result.stderr.trim() || formatProviderExitError("kimi", result.status);
    return {
      ok: false,
      error,
      errorCode: classifyProviderFailure(error, { provider: "kimi" }),
      status: result.status,
    };
  }

  const parsed = parseKimiStreamText(result.stdout);
  const session = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"],
  });

  const error = parsed.response.trim() ? null : "kimi produced no visible text";
  return withKimiResumeWarnings({
    ok: Boolean(parsed.response.trim()),
    response: parsed.response,
    events: parsed.events,
    toolEvents: parsed.toolEvents,
    sessionId: session.sessionId,
    model: parsed.model ?? model ?? defaultModel ?? readKimiDefaultModel(),
    error,
    errorCode: classifyProviderFailure(error, { provider: "kimi" }),
  }, resume.sessionId);
}

export function runKimiPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  resumeLast = false,
  fresh = false,
  yolo = true,
  defaultModel = null,
  onEvent = () => {},
  bin = KIMI_BIN,
  spawnImpl,
} = {}) {
  const resume = resolveKimiResumeSession({ cwd, resumeSessionId, resumeLast, fresh });
  if (!resume.ok) {
    return Promise.resolve({ ok: false, error: resume.error, status: resume.status });
  }
  const invocation = buildKimiInvocation({
    prompt,
    model,
    resumeSessionId: resume.sessionId,
    yolo,
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
      const event = parseKimiEventLine(line);
      if (event) {
        try { onEvent(event); } catch {}
      }
    },
  }).then((result) => {
    const parsed = parseKimiStreamText(result.stdout);
    const session = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const hasVisibleText = Boolean(parsed.response.trim());
    const resumeFooterOnly = hasVisibleText && !result.ok && isKimiResumeFooter(result.error);
    const ok = (result.ok || resumeFooterOnly) && hasVisibleText;
    const error = ok
      ? null
      : (result.ok ? "kimi produced no visible text" : result.error);
    return withKimiResumeWarnings({
      ...result,
      ...parsed,
      sessionId: session.sessionId,
      model: parsed.model ?? model ?? defaultModel ?? readKimiDefaultModel(),
      ok,
      error,
      errorCode: classifyProviderFailure(error, { provider: "kimi" }),
    }, resume.sessionId);
  });
}

function withKimiResumeWarnings(result, requestedSessionId) {
  if (!requestedSessionId || !result.ok || !result.sessionId || result.sessionId === requestedSessionId) {
    return result;
  }
  const warning = `Warning: requested --resume ${requestedSessionId} did not match returned session ${result.sessionId}`;
  return {
    ...result,
    resumeMismatched: true,
    warnings: [...(result.warnings || []), warning],
  };
}
