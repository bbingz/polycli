import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { spawnStreamingCommand } from "./spawn.js";

const KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PROMPT_STDIN_THRESHOLD_BYTES = 100_000;
const KIMI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
const KIMI_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;

export function buildKimiInvocation({
  prompt,
  model = null,
  resumeSessionId = null,
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

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const event = parseKimiEventLine(rawLine);
    if (!event) continue;
    events.push(event);
    if (event.role === "tool") toolEvents.push(event);
    response += extractKimiText(event);
  }

  return { events, toolEvents, response };
}

export function getKimiAvailability(cwd) {
  return binaryAvailable(KIMI_BIN, ["-V"], { cwd });
}

function buildKimiAuthStatus(result) {
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? null,
    };
  }

  const detail = String(result.error ?? "").trim() || "kimi auth probe failed";
  if (KIMI_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (KIMI_TRANSIENT_PROBE_ERROR_RE.test(detail)) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: result.model ?? null };
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
  bin = KIMI_BIN,
} = {}) {
  const invocation = buildKimiInvocation({
    prompt,
    model,
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
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr.trim() || `kimi exited with code ${result.status}`,
      status: result.status,
    };
  }

  const parsed = parseKimiStreamText(result.stdout);
  const session = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"],
  });

  return {
    ok: Boolean(parsed.response.trim()),
    response: parsed.response,
    events: parsed.events,
    toolEvents: parsed.toolEvents,
    sessionId: session.sessionId,
    model,
    error: parsed.response.trim() ? null : "kimi produced no visible text",
  };
}

export function runKimiPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  onEvent = () => {},
  bin = KIMI_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildKimiInvocation({
    prompt,
    model,
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
    return {
      ...result,
      ...parsed,
      sessionId: session.sessionId,
      ok: result.ok && hasVisibleText,
      error: result.ok
        ? (hasVisibleText ? null : "kimi produced no visible text")
        : result.error,
    };
  });
}
