import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { spawnStreamingCommand } from "./spawn.js";

const COPILOT_BIN = process.env.COPILOT_CLI_BIN || "copilot";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;

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
    return `copilot exited with code ${event.exitCode}`;
  }
  if (event.status && event.status !== 0) {
    return `copilot exited with code ${event.status}`;
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
    "--allow-all-tools",
    "--allow-all-paths",
    "--allow-all-urls",
    "--no-ask-user",
  ];

  if (model) {
    args.push("--model", model);
  }
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
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
    if (!sessionId && typeof event.sessionId === "string") sessionId = event.sessionId;
    if (!sessionId && typeof event.session_id === "string") sessionId = event.session_id;
    if (!sessionId && typeof event.session?.id === "string") sessionId = event.session.id;
    if (!sessionId && typeof event.data?.sessionId === "string") sessionId = event.data.sessionId;
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.session?.model === "string") model = event.session.model;
    if (!model && typeof event.data?.model === "string") model = event.data.model;
    if (event.type === "assistant.message" && typeof event.data?.content === "string") {
      response = event.data.content;
      continue;
    }
    if (event.type === "result" || event.type === "final" || event.type === "error") {
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

export function getCopilotAvailability(cwd) {
  return binaryAvailable(COPILOT_BIN, ["--version"], { cwd });
}

export function getCopilotAuthStatus(cwd) {
  const result = runCopilotPrompt({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
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

export function runCopilotPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  bin = COPILOT_BIN,
} = {}) {
  const invocation = buildCopilotInvocation({
    prompt,
    model,
    outputFormat: "json",
    stream: "off",
    resumeSessionId,
    continueLast,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT"
        ? `copilot timed out after ${Math.round(timeout / 1000)}s`
        : result.error.message,
    };
  }

  const parsed = parseCopilotStreamText(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"],
  });
  const resultError = getCopilotResultError(parsed.resultEvent);
  const hasVisibleText = Boolean(parsed.response.trim());

  return {
    ok: result.status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    model: parsed.model,
    error: result.status === 0
      ? (resultError || (hasVisibleText ? null : "copilot produced no visible text"))
      : (result.stderr.trim() || `copilot exited with code ${result.status}`),
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
  onEvent = () => {},
  bin = COPILOT_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildCopilotInvocation({
    prompt,
    model,
    outputFormat: "json",
    stream: "on",
    resumeSessionId,
    continueLast,
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
    const parsed = parseCopilotStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const resultError = getCopilotResultError(parsed.resultEvent);
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok
        ? (resultError || (hasVisibleText ? null : "copilot produced no visible text"))
        : result.error,
    };
  });
}
