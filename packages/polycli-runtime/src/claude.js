import { parseStreamJsonLine } from "@bbingz/polycli-utils/parse-stream-json";
import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const CLAUDE_BIN = process.env.CLAUDE_CLI_BIN || "claude";
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PROMPT_STDIN_THRESHOLD = 100_000;

function collectTextFromContent(content) {
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

function isClaudeErrorResultEvent(event) {
  return Boolean(
    event
    && event.type === "result"
    && (event.is_error === true || event.subtype === "error")
  );
}

function getClaudeErrorText(event) {
  if (!event || typeof event !== "object") {
    return "claude returned an error";
  }
  if (typeof event.error?.message === "string" && event.error.message.trim()) {
    return event.error.message;
  }
  if (typeof event.result === "string" && event.result.trim()) {
    return event.result;
  }
  return "claude returned an error";
}

export function buildClaudeInvocation({
  prompt,
  model = null,
  outputFormat = "json",
  permissionMode = "acceptEdits",
  maxTurns = 10,
  resumeSessionId = null,
  extraArgs = [],
  bin = CLAUDE_BIN,
} = {}) {
  const promptText = String(prompt ?? "");
  const useStdin = Buffer.byteLength(promptText, "utf8") > PROMPT_STDIN_THRESHOLD;
  const args = ["-p"];

  if (!useStdin) {
    args.push(promptText);
  }

  args.push("--output-format", outputFormat);
  if (outputFormat === "stream-json") {
    args.push("--verbose");
  }
  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }
  if (Number.isFinite(maxTurns) && maxTurns > 0) {
    args.push("--max-turns", String(maxTurns));
  }
  if (model) {
    args.push("--model", model);
  }
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return {
    bin,
    args,
    input: useStdin ? promptText : undefined,
    useStdin,
  };
}

export function extractClaudeText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  if (
    event.type === "result" &&
    !isClaudeErrorResultEvent(event) &&
    typeof event.result === "string"
  ) {
    return event.result;
  }

  if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
    return typeof event.delta.text === "string" ? event.delta.text : "";
  }

  const role = event.role ?? event.message?.role ?? null;
  if (role && role !== "assistant") {
    return "";
  }

  if (typeof event.text === "string") {
    return event.text;
  }

  return collectTextFromContent(event.content ?? event.message?.content);
}

export function parseClaudeStreamText(text) {
  const events = [];
  let response = "";
  let sessionId = null;
  let model = null;
  let resultEvent = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const parsed = parseStreamJsonLine(rawLine, { allowPrefix: true });
    if (!parsed.ok) continue;

    const event = parsed.event;
    events.push(event);

    if (!sessionId && typeof event.session_id === "string") {
      sessionId = event.session_id;
    }
    if (!sessionId && typeof event.sessionId === "string") {
      sessionId = event.sessionId;
    }
    if (!model && typeof event.model === "string") {
      model = event.model;
    }
    if (!model && typeof event.session?.model === "string") {
      model = event.session.model;
    }
    if (event.type === "result") {
      resultEvent = event;
      if (typeof event.model === "string") {
        model = event.model;
      }
      if (!response.trim()) {
        response += extractClaudeText(event);
      }
      continue;
    }

    response += extractClaudeText(event);
  }

  return {
    events,
    response,
    sessionId,
    model,
    resultEvent,
  };
}

export function parseClaudeJsonResult(stdout, stderr, status, { defaultModel = null } = {}) {
  const text = String(stdout ?? "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    return {
      ok: false,
      error: String(stderr ?? "").trim() || formatProviderExitError("claude", status),
      status,
    };
  }

  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    const resolvedSession = resolveSessionId({
      stdout,
      stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const response = typeof parsed.result === "string" ? parsed.result : "";
    const sessionId = parsed.session_id ?? parsed.sessionId ?? resolvedSession.sessionId ?? null;
    const errorText = isClaudeErrorResultEvent(parsed) ? getClaudeErrorText(parsed) : null;
    const processError = status === 0
      ? null
      : (String(stderr ?? "").trim() || formatProviderExitError("claude", status));

    return {
      ok: status === 0 && !isClaudeErrorResultEvent(parsed),
      response,
      sessionId,
      model: parsed.model ?? defaultModel,
      durationMs: parsed.duration_ms ?? null,
      totalCostUsd: parsed.total_cost_usd ?? null,
      status,
      error: isClaudeErrorResultEvent(parsed) ? errorText : processError,
    };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${error.message}`, status };
  }
}

export function getClaudeAvailability(cwd) {
  return binaryAvailable(CLAUDE_BIN, ["--version"], { cwd });
}

export function getClaudeAuthStatus(cwd) {
  const result = runClaudePrompt({
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
    model: null,
  };
}

export function runClaudePrompt({
  prompt,
  model = null,
  permissionMode = "acceptEdits",
  maxTurns = 10,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
  bin = CLAUDE_BIN,
} = {}) {
  const invocation = buildClaudeInvocation({
    prompt,
    model,
    outputFormat: "json",
    permissionMode,
    maxTurns,
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
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT"
        ? `claude timed out after ${Math.round(timeout / 1000)}s`
        : result.error.message,
    };
  }

  return parseClaudeJsonResult(result.stdout, result.stderr, result.status, {
    defaultModel: model ?? defaultModel,
  });
}

export function runClaudePromptStreaming({
  prompt,
  model = null,
  permissionMode = "acceptEdits",
  maxTurns = 10,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
  onEvent = () => {},
  bin = CLAUDE_BIN,
  spawnImpl,
} = {}) {
  const invocation = buildClaudeInvocation({
    prompt,
    model,
    outputFormat: "stream-json",
    permissionMode,
    maxTurns,
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
      const parsed = parseStreamJsonLine(line, { allowPrefix: true });
      if (parsed.ok) {
        try { onEvent(parsed.event); } catch {}
      }
    },
  }).then((result) => {
    const parsed = parseClaudeStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const hasVisibleText = Boolean(parsed.response.trim());
    const resultError = isClaudeErrorResultEvent(parsed.resultEvent)
      ? getClaudeErrorText(parsed.resultEvent)
      : null;
    const hasSuccessfulResult = Boolean(
      parsed.resultEvent
      && parsed.resultEvent.type === "result"
      && !isClaudeErrorResultEvent(parsed.resultEvent)
    );
    const completed = result.ok || (result.timedOut && hasSuccessfulResult);

    return {
      ...result,
      ...parsed,
      timedOut: completed ? false : result.timedOut,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      model: parsed.model ?? model ?? defaultModel,
      ok: completed && !resultError && hasVisibleText,
      error: completed
        ? (resultError || (hasVisibleText ? null : "claude produced no visible text"))
        : result.error,
    };
  });
}
