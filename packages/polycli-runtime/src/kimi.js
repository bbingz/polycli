import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";

import { classifyProviderFailure, formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const KIMI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];
// kimi-code stores its default model in ~/.kimi-code/config.toml (the legacy python
// kimi-cli used ~/.kimi/config.toml; that install is migrated, marker `.migrated-to-kimi-code`).
const KIMI_CONFIG_PATH = process.env.KIMI_CONFIG_PATH || path.join(os.homedir(), ".kimi-code", "config.toml");

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
  resumeLast = false,
  extraArgs = [],
  bin = KIMI_BIN,
} = {}) {
  // kimi-code one-shot mode: `-p <prompt> --output-format stream-json`. The adapter deliberately
  // emits no approval-mode flag here; `-p` is the non-interactive headless runner. Resume is delegated to the
  // CLI: `--session <id>` (kimi-code's `-S, --session [id]`, per its own
  // session.resume_hint) or `-c, --continue` to continue the last session. The legacy Python
  // kimi-cli used `-r`; this adapter deliberately uses the currently documented `--session` form.
  const args = ["-p", String(prompt ?? ""), "--output-format", "stream-json"];
  if (model) args.push("-m", model);
  if (resumeLast) {
    args.push("--continue");
  } else if (resumeSessionId) {
    args.push("--session", resumeSessionId);
  }
  if (extraArgs.length > 0) args.push(...extraArgs);
  return { bin, args };
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
  let sessionId = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const event = parseKimiEventLine(rawLine);
    if (!event) continue;
    events.push(event);
    if (event.role === "tool") toolEvents.push(event);
    // The session id arrives STRUCTURALLY in a `{role:"meta", type:"session.resume_hint",
    // session_id:"session_<uuid>"}` event. Read it from there and keep the `session_` prefix
    // intact — never scan the prose for a bare UUID (that would drop the prefix and could
    // fabricate an id from a UUID the user asked about).
    if (!sessionId
      && event.role === "meta"
      && event.type === "session.resume_hint"
      && typeof event.session_id === "string"
      && event.session_id.length > 0) {
      sessionId = event.session_id;
    }
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.message?.model === "string") model = event.message.model;
    response += extractKimiText(event);
  }

  return { events, toolEvents, response, model, sessionId };
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
  // kimi-code dropped the per-invocation `--max-steps-per-turn` flag (it now lives in
  // ~/.kimi-code/config.toml [loop_control]); the probe is a plain non-interactive ping.
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
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
  defaultModel = null,
  bin = KIMI_BIN,
} = {}) {
  const invocation = buildKimiInvocation({ prompt, model, resumeSessionId, resumeLast, extraArgs, bin });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });

  if (result.error) {
    const error = result.error.code === "ETIMEDOUT"
      ? `kimi timed out after ${Math.round(timeout / 1000)}s`
      : result.error.message;
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
  const error = parsed.response.trim() ? null : "kimi produced no visible text";
  return {
    ok: Boolean(parsed.response.trim()),
    response: parsed.response,
    events: parsed.events,
    toolEvents: parsed.toolEvents,
    sessionId: parsed.sessionId,
    model: parsed.model ?? model ?? defaultModel ?? readKimiDefaultModel(),
    error,
    errorCode: classifyProviderFailure(error, { provider: "kimi" }),
    status: result.status,
  };
}

export function runKimiPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  resumeLast = false,
  defaultModel = null,
  onEvent = () => {},
  bin = KIMI_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildKimiInvocation({ prompt, model, resumeSessionId, resumeLast, extraArgs, bin });

  return spawnStreamingCommand({
    bin: invocation.bin,
    args: invocation.args,
    cwd,
    env: { ...process.env },
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
    const hasVisibleText = Boolean(parsed.response.trim());
    const ok = result.ok && hasVisibleText;
    const error = ok
      ? null
      : (result.ok ? "kimi produced no visible text" : result.error);
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId,
      model: parsed.model ?? model ?? defaultModel ?? readKimiDefaultModel(),
      ok,
      error,
      errorCode: classifyProviderFailure(error, { provider: "kimi" }),
    };
  });
}
