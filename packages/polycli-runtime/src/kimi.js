import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { spawnStreamingCommand } from "./spawn.js";

const KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PROMPT_STDIN_THRESHOLD_BYTES = 100_000;

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
  if (!event || event.role !== "assistant" || !Array.isArray(event.content)) {
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

export function getKimiAuthStatus(cwd) {
  const result = runKimiPrompt({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
    extraArgs: ["--max-steps-per-turn", "1"],
  });

  if (!result.ok) {
    return { loggedIn: false, detail: result.error };
  }

  return {
    loggedIn: true,
    detail: "authenticated",
    model: result.model ?? null,
  };
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
      error: result.stderr.trim() || result.stdout.trim() || `kimi exited with code ${result.status}`,
      status: result.status,
    };
  }

  const parsed = parseKimiStreamText(result.stdout);
  const session = resolveSessionId({ stderr: result.stderr, priority: ["stderr"] });

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
    const session = resolveSessionId({ stderr: result.stderr, priority: ["stderr"] });
    return {
      ...result,
      ...parsed,
      sessionId: session.sessionId,
      ok: result.ok && Boolean(parsed.response.trim()),
      error: result.ok && parsed.response.trim() ? null : result.error,
    };
  });
}
