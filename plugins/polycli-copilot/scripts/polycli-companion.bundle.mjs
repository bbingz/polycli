#!/usr/bin/env node

// plugins/polycli/scripts/polycli-companion.mjs
import fs8 from "node:fs";
import process5 from "node:process";
import { randomUUID as randomUUID2 } from "node:crypto";
import { spawn as spawn2 } from "node:child_process";
import { fileURLToPath } from "node:url";

// packages/polycli-utils/src/args.js
function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];
  let passthrough = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (passthrough) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      passthrough = true;
      continue;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=", 2);
      const rawKey = eqIdx >= 0 ? token.slice(2, eqIdx) : token.slice(2);
      const inlineValue = eqIdx >= 0 ? token.slice(eqIdx + 1) : void 0;
      const key2 = aliasMap[rawKey] ?? rawKey;
      if (booleanOptions.has(key2)) {
        options[key2] = inlineValue === void 0 ? true : inlineValue !== "false";
        continue;
      }
      if (valueOptions.has(key2)) {
        const nextValue = inlineValue ?? argv[index + 1];
        if (nextValue === void 0) {
          throw new Error(`Missing value for --${rawKey}`);
        }
        options[key2] = nextValue;
        if (inlineValue === void 0) {
          index += 1;
        }
        continue;
      }
      positionals.push(token);
      continue;
    }
    const shortKey = token.slice(1);
    const key = aliasMap[shortKey] ?? shortKey;
    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }
    if (valueOptions.has(key)) {
      const nextValue = argv[index + 1];
      if (nextValue === void 0) {
        throw new Error(`Missing value for -${shortKey}`);
      }
      options[key] = nextValue;
      index += 1;
      continue;
    }
    positionals.push(token);
  }
  return { options, positionals };
}

// packages/polycli-runtime/src/constants.js
var PROVIDER_IDS = ["gemini", "kimi", "qwen", "minimax", "claude", "copilot", "opencode", "pi"];
var PROVIDER_OPERATION_NAMES = ["prompt"];

// packages/polycli-utils/src/parse-stream-json.js
function parseStreamJsonLine(raw, { allowPrefix = true } = {}) {
  const text = String(raw ?? "");
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, kind: "blank", raw: text };
  }
  let jsonCandidate = trimmed;
  let prefix = "";
  if (allowPrefix) {
    const jsonStart = text.indexOf("{");
    if (jsonStart < 0) {
      return { ok: false, kind: "blank", raw: text };
    }
    prefix = text.slice(0, jsonStart);
    jsonCandidate = text.slice(jsonStart).trim();
  } else if (!trimmed.startsWith("{")) {
    return { ok: false, kind: "blank", raw: text };
  }
  try {
    return {
      ok: true,
      raw: text,
      prefix,
      json: jsonCandidate,
      event: JSON.parse(jsonCandidate)
    };
  } catch (error) {
    return {
      ok: false,
      kind: "parse_error",
      raw: text,
      prefix,
      json: jsonCandidate,
      error: error.message
    };
  }
}

// packages/polycli-utils/src/process.js
import { spawnSync } from "node:child_process";
import process2 from "node:process";
function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout,
    stdio: options.stdio ?? "pipe",
    detached: options.detached ?? false
  });
  const preserveNullStatus = options.preserveNullStatus ?? false;
  return {
    command,
    args,
    status: result.status ?? (preserveNullStatus ? null : 0),
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}
function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return {
    available: true,
    detail: result.stdout.trim() || result.stderr.trim() || "ok"
  };
}
function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}
async function terminateProcessTree(pid, { signal = "SIGTERM", forceSignal = "SIGKILL", forceAfterMs = 5e3, ignoreMissing = true } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid pid: ${pid}`);
  }
  const killOnce = (targetSignal) => {
    if (process2.platform === "win32") {
      const args = ["/PID", String(pid), "/T"];
      if (targetSignal === "SIGKILL") {
        args.push("/F");
      }
      const result = runCommand("taskkill", args);
      if (result.error) {
        if (ignoreMissing && result.error.code === "ESRCH") return false;
        throw result.error;
      }
      if (result.status !== 0 && ignoreMissing && /not found|no running instance/i.test(result.stderr)) {
        return false;
      }
      if (result.status !== 0) {
        throw new Error(formatCommandFailure(result));
      }
      return true;
    }
    try {
      process2.kill(-pid, targetSignal);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") {
        if (ignoreMissing) return false;
        throw error;
      }
      if (error.code === "EINVAL") {
        throw error;
      }
      process2.kill(pid, targetSignal);
      return true;
    }
  };
  const terminated = killOnce(signal);
  if (!terminated || forceAfterMs <= 0) {
    return terminated;
  }
  await new Promise((resolve) => setTimeout(resolve, forceAfterMs));
  try {
    killOnce(forceSignal);
  } catch (error) {
    if (!(ignoreMissing && error.code === "ESRCH")) {
      throw error;
    }
  }
  return true;
}

// packages/polycli-utils/src/session-id.js
var UUID_SESSION_ID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
function matchSessionId(text, { patterns = [UUID_SESSION_ID_REGEX] } = {}) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  for (const pattern of patterns) {
    const flags = pattern.flags.replace(/g/g, "");
    const regex = new RegExp(pattern.source, flags);
    const match = text.match(regex);
    if (match) {
      return match[0];
    }
  }
  return null;
}
function resolveSessionId({
  stdout = "",
  stderr = "",
  fileValue = null,
  patterns,
  priority = ["stdout", "stderr", "file"]
} = {}) {
  const sources = {
    stdout,
    stderr,
    file: typeof fileValue === "string" ? fileValue : ""
  };
  for (const source of priority) {
    const sessionId = matchSessionId(sources[source], { patterns });
    if (sessionId) {
      return { sessionId, source };
    }
  }
  return { sessionId: null, source: null };
}

// packages/polycli-runtime/src/spawn.js
import { spawn } from "node:child_process";

// packages/polycli-utils/src/stream.js
import { StringDecoder } from "node:string_decoder";
function createLineDecoder({ encoding = "utf8", stripCarriageReturn = true } = {}) {
  const decoder = new StringDecoder(encoding);
  let buffer = "";
  const normalize = (line) => {
    if (stripCarriageReturn && line.endsWith("\r")) {
      return line.slice(0, -1);
    }
    return line;
  };
  const drain = () => {
    const lines = [];
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      lines.push(normalize(line));
    }
    return lines;
  };
  return {
    push(chunk) {
      if (chunk == null) return [];
      buffer += decoder.write(chunk);
      return drain();
    },
    end() {
      buffer += decoder.end();
      const lines = drain();
      if (buffer.length > 0) {
        lines.push(normalize(buffer));
        buffer = "";
      }
      return lines;
    }
  };
}

// packages/polycli-runtime/src/spawn.js
function spawnStreamingCommand({
  bin,
  args = [],
  cwd,
  env,
  input,
  timeout,
  killGraceMs = 2e3,
  stdio = ["pipe", "pipe", "pipe"],
  detached = false,
  unref = false,
  spawnImpl = spawn,
  onStdoutLine = () => {
  },
  onStderrChunk = () => {
  }
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(bin, args, { cwd, env, stdio, detached });
    } catch (error) {
      resolve({
        ok: false,
        status: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        error: error.message
      });
      return;
    }
    if (unref && typeof child.unref === "function") {
      child.unref();
    }
    const decoder = createLineDecoder();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer = null;
    let forceTimer = null;
    const signalChild = (signal) => {
      try {
        if (detached && Number.isInteger(child.pid) && child.pid > 0 && process.platform !== "win32") {
          process.kill(-child.pid, signal);
          return;
        }
        child.kill(signal);
      } catch {
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve(result);
    };
    if (timeout != null) {
      timer = setTimeout(() => {
        timedOut = true;
        signalChild("SIGTERM");
        if (killGraceMs > 0) {
          forceTimer = setTimeout(() => {
            signalChild("SIGKILL");
          }, killGraceMs);
        }
      }, timeout);
    }
    child.on("error", (error) => {
      finish({
        ok: false,
        status: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        error: error.message
      });
    });
    if (child.stdin?.on) {
      child.stdin.on("error", (error) => {
        if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
          return;
        }
        stderr += `${error.message}
`;
      });
    }
    if (child.stdout?.on) {
      child.stdout.on("data", (chunk) => {
        for (const line of decoder.push(chunk)) {
          stdout += `${line}
`;
          try {
            onStdoutLine(line);
          } catch {
          }
        }
      });
    }
    if (child.stderr?.on) {
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr += text;
        try {
          onStderrChunk(text);
        } catch {
        }
      });
    }
    child.on("close", (status, signal) => {
      for (const line of decoder.end()) {
        stdout += `${line}
`;
        try {
          onStdoutLine(line);
        } catch {
        }
      }
      finish({
        ok: status === 0 && !timedOut,
        status,
        signal,
        timedOut,
        stdout,
        stderr,
        error: status === 0 && !timedOut ? null : stderr.trim() || `process exited with code ${status}`
      });
    });
    if (child.stdin) {
      if (input != null) child.stdin.write(input);
      child.stdin.end();
    }
  });
}

// packages/polycli-runtime/src/claude.js
var CLAUDE_BIN = process.env.CLAUDE_CLI_BIN || "claude";
var DEFAULT_TIMEOUT_MS = 9e5;
var AUTH_CHECK_TIMEOUT_MS = 3e4;
var PROMPT_STDIN_THRESHOLD = 1e5;
function collectTextFromContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
function isClaudeErrorResultEvent(event) {
  return Boolean(
    event && event.type === "result" && (event.is_error === true || event.subtype === "error")
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
function buildClaudeInvocation({
  prompt,
  model = null,
  outputFormat = "json",
  permissionMode = "acceptEdits",
  maxTurns = 10,
  resumeSessionId = null,
  extraArgs = [],
  bin = CLAUDE_BIN
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
    input: useStdin ? promptText : void 0,
    useStdin
  };
}
function extractClaudeText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (event.type === "result" && !isClaudeErrorResultEvent(event) && typeof event.result === "string") {
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
function parseClaudeStreamText(text) {
  const events = [];
  let response = "";
  let sessionId = null;
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
    if (event.type === "result") {
      resultEvent = event;
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
    resultEvent
  };
}
function parseClaudeJsonResult(stdout, stderr, status) {
  const text = String(stdout ?? "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    return {
      ok: false,
      error: String(stderr ?? "").trim() || `claude exited with code ${status}`,
      status
    };
  }
  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    const resolvedSession = resolveSessionId({
      stdout,
      stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const response = typeof parsed.result === "string" ? parsed.result : "";
    const sessionId = parsed.session_id ?? parsed.sessionId ?? resolvedSession.sessionId ?? null;
    const errorText = isClaudeErrorResultEvent(parsed) ? getClaudeErrorText(parsed) : null;
    const processError = status === 0 ? null : String(stderr ?? "").trim() || `claude exited with code ${status}`;
    return {
      ok: status === 0 && !isClaudeErrorResultEvent(parsed),
      response,
      sessionId,
      durationMs: parsed.duration_ms ?? null,
      totalCostUsd: parsed.total_cost_usd ?? null,
      status,
      error: isClaudeErrorResultEvent(parsed) ? errorText : processError
    };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${error.message}`, status };
  }
}
function getClaudeAvailability(cwd) {
  return binaryAvailable(CLAUDE_BIN, ["--version"], { cwd });
}
function getClaudeAuthStatus(cwd) {
  const result = runClaudePrompt({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS
  });
  if (!result.ok) {
    return { loggedIn: false, detail: result.error };
  }
  return {
    loggedIn: true,
    detail: "authenticated",
    model: null
  };
}
function runClaudePrompt({
  prompt,
  model = null,
  permissionMode = "acceptEdits",
  maxTurns = 10,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  bin = CLAUDE_BIN
} = {}) {
  const invocation = buildClaudeInvocation({
    prompt,
    model,
    outputFormat: "json",
    permissionMode,
    maxTurns,
    resumeSessionId,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    timeout,
    input: invocation.input
  });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT" ? `claude timed out after ${Math.round(timeout / 1e3)}s` : result.error.message
    };
  }
  return parseClaudeJsonResult(result.stdout, result.stderr, result.status);
}
function runClaudePromptStreaming({
  prompt,
  model = null,
  permissionMode = "acceptEdits",
  maxTurns = 10,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  onEvent = () => {
  },
  bin = CLAUDE_BIN,
  spawnImpl
} = {}) {
  const invocation = buildClaudeInvocation({
    prompt,
    model,
    outputFormat: "stream-json",
    permissionMode,
    maxTurns,
    resumeSessionId,
    extraArgs,
    bin
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
        try {
          onEvent(parsed.event);
        } catch {
        }
      }
    }
  }).then((result) => {
    const parsed = parseClaudeStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const hasVisibleText = Boolean(parsed.response.trim());
    const resultError = isClaudeErrorResultEvent(parsed.resultEvent) ? getClaudeErrorText(parsed.resultEvent) : null;
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok ? resultError || (hasVisibleText ? null : "claude produced no visible text") : result.error
    };
  });
}

// packages/polycli-runtime/src/copilot.js
var COPILOT_BIN = process.env.COPILOT_CLI_BIN || "copilot";
var DEFAULT_TIMEOUT_MS2 = 9e5;
var AUTH_CHECK_TIMEOUT_MS2 = 3e4;
function collectCopilotContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
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
function buildCopilotInvocation({
  prompt,
  model = null,
  outputFormat = "json",
  stream = "off",
  resumeSessionId = null,
  continueLast = false,
  extraArgs = [],
  bin = COPILOT_BIN
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
    "--no-ask-user"
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
function extractCopilotText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (event.type === "assistant.message_delta" && typeof event.data?.deltaContent === "string") {
    return event.data.deltaContent;
  }
  if (event.type === "assistant.message" && typeof event.data?.content === "string") {
    return event.data.content;
  }
  if ((event.type === "result" || event.type === "final") && typeof event.result === "string") {
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
function parseCopilotStreamText(text) {
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
function getCopilotAvailability(cwd) {
  return binaryAvailable(COPILOT_BIN, ["--version"], { cwd });
}
function getCopilotAuthStatus(cwd) {
  const result = runCopilotPrompt({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS2
  });
  if (!result.ok) {
    return { loggedIn: false, detail: result.error };
  }
  return {
    loggedIn: true,
    detail: "authenticated",
    model: result.model ?? null
  };
}
function runCopilotPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS2,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  bin = COPILOT_BIN
} = {}) {
  const invocation = buildCopilotInvocation({
    prompt,
    model,
    outputFormat: "json",
    stream: "off",
    resumeSessionId,
    continueLast,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT" ? `copilot timed out after ${Math.round(timeout / 1e3)}s` : result.error.message
    };
  }
  const parsed = parseCopilotStreamText(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"]
  });
  const resultError = getCopilotResultError(parsed.resultEvent);
  const hasVisibleText = Boolean(parsed.response.trim());
  return {
    ok: result.status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    model: parsed.model,
    error: result.status === 0 ? resultError || (hasVisibleText ? null : "copilot produced no visible text") : result.stderr.trim() || `copilot exited with code ${result.status}`,
    status: result.status
  };
}
function runCopilotPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS2,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  onEvent = () => {
  },
  bin = COPILOT_BIN,
  spawnImpl
} = {}) {
  const invocation = buildCopilotInvocation({
    prompt,
    model,
    outputFormat: "json",
    stream: "on",
    resumeSessionId,
    continueLast,
    extraArgs,
    bin
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
      } catch {
      }
    }
  }).then((result) => {
    const parsed = parseCopilotStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const resultError = getCopilotResultError(parsed.resultEvent);
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok ? resultError || (hasVisibleText ? null : "copilot produced no visible text") : result.error
    };
  });
}

// packages/polycli-runtime/src/gemini.js
var GEMINI_BIN = process.env.GEMINI_CLI_BIN || "gemini";
var DEFAULT_TIMEOUT_MS3 = 3e5;
var AUTH_CHECK_TIMEOUT_MS3 = 3e4;
var PROMPT_STDIN_THRESHOLD2 = 1e5;
var GEMINI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var GEMINI_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;
function buildGeminiInvocation({
  prompt,
  model = null,
  approvalMode = "plan",
  outputFormat = "json",
  resumeSessionId = null,
  extraArgs = [],
  bin = GEMINI_BIN
} = {}) {
  const useStdin = String(prompt ?? "").length > PROMPT_STDIN_THRESHOLD2;
  const args = ["-p", useStdin ? "" : String(prompt ?? ""), "-o", outputFormat];
  if (model) args.push("-m", model);
  args.push("--approval-mode", approvalMode);
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (extraArgs.length > 0) args.push(...extraArgs);
  return {
    bin,
    args,
    input: useStdin ? String(prompt ?? "") : void 0,
    useStdin
  };
}
function extractGeminiText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "result" && typeof event.text === "string") return event.text;
  const role = event.role ?? event.message?.role ?? null;
  if (event.type === "message" && role !== "assistant") return "";
  if (event.type === "message" && typeof event.delta === "string") return event.delta;
  if (event.type === "message" && typeof event.content === "string") return event.content;
  if (event.type === "message" && typeof event.text === "string") return event.text;
  if (event.type === "message" && typeof event.message?.content === "string") return event.message.content;
  return "";
}
function parseGeminiStreamText(text) {
  const events = [];
  let response = "";
  let sessionId = null;
  let stats = null;
  let resultEvent = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const parsed = parseStreamJsonLine(rawLine, { allowPrefix: true });
    if (!parsed.ok) continue;
    const event = parsed.event;
    events.push(event);
    if (!sessionId && event.session_id) sessionId = event.session_id;
    if (event.type === "result") {
      resultEvent = event;
      if (event.stats) stats = event.stats;
      if (!response.trim()) {
        response += extractGeminiText(event);
      }
      continue;
    }
    response += extractGeminiText(event);
  }
  return { events, response, sessionId, stats, resultEvent };
}
function parseGeminiJsonResult(stdout, stderr, status) {
  const text = String(stdout ?? "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    return {
      ok: false,
      error: String(stderr ?? "").trim() || `gemini exited with code ${status}`,
      status
    };
  }
  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    const resolvedSession = resolveSessionId({
      stdout,
      stderr,
      priority: ["stdout", "stderr", "file"]
    });
    if (parsed.error) {
      return {
        ok: false,
        error: parsed.error.message || "gemini returned an error",
        code: parsed.error.code ?? null,
        status
      };
    }
    return {
      ok: true,
      response: parsed.response ?? "",
      sessionId: parsed.session_id ?? resolvedSession.sessionId ?? null,
      stats: parsed.stats ?? null,
      status
    };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${error.message}`, status };
  }
}
function getGeminiAvailability(cwd) {
  return binaryAvailable(GEMINI_BIN, ["-v"], { cwd });
}
function buildGeminiAuthStatus(test) {
  if (test.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: Object.keys(test.stats?.models ?? {})[0] || null
    };
  }
  const detail = String(test.error ?? "").trim() || "gemini auth probe failed";
  if (GEMINI_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (GEMINI_TRANSIENT_PROBE_ERROR_RE.test(detail)) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
  }
  return { loggedIn: false, detail };
}
function getGeminiAuthStatus(cwd, { promptRunner = runGeminiPrompt } = {}) {
  const test = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS3
  });
  return buildGeminiAuthStatus(test);
}
function runGeminiPrompt({
  prompt,
  model = null,
  approvalMode = "plan",
  cwd,
  timeout = DEFAULT_TIMEOUT_MS3,
  extraArgs = [],
  resumeSessionId = null,
  bin = GEMINI_BIN
} = {}) {
  const invocation = buildGeminiInvocation({
    prompt,
    model,
    approvalMode,
    outputFormat: "json",
    resumeSessionId,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    timeout,
    input: invocation.input
  });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT" ? `gemini timed out after ${Math.round(timeout / 1e3)}s` : result.error.message
    };
  }
  return parseGeminiJsonResult(result.stdout, result.stderr, result.status);
}
function runGeminiPromptStreaming({
  prompt,
  model = null,
  approvalMode = "plan",
  cwd,
  timeout = DEFAULT_TIMEOUT_MS3,
  extraArgs = [],
  resumeSessionId = null,
  onEvent = () => {
  },
  bin = GEMINI_BIN,
  spawnImpl
} = {}) {
  const invocation = buildGeminiInvocation({
    prompt,
    model,
    approvalMode,
    outputFormat: "stream-json",
    resumeSessionId,
    extraArgs,
    bin
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
        try {
          onEvent(parsed.event);
        } catch {
        }
      }
    }
  }).then((result) => {
    const parsed = parseGeminiStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const resultError = typeof parsed.resultEvent?.error?.message === "string" ? parsed.resultEvent.error.message : typeof parsed.resultEvent?.error === "string" ? parsed.resultEvent.error : null;
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok ? resultError || (hasVisibleText ? null : "gemini produced no visible text") : result.error
    };
  });
}

// packages/polycli-runtime/src/kimi.js
var KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";
var DEFAULT_TIMEOUT_MS4 = 9e5;
var AUTH_CHECK_TIMEOUT_MS4 = 3e4;
var PROMPT_STDIN_THRESHOLD_BYTES = 1e5;
var KIMI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var KIMI_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;
function buildKimiInvocation({
  prompt,
  model = null,
  resumeSessionId = null,
  extraArgs = [],
  bin = KIMI_BIN
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
    input: useStdin ? promptText : void 0,
    useStdin
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
function extractKimiText(event) {
  if (!event || event.role !== "assistant") {
    return "";
  }
  if (typeof event.content === "string") {
    return event.content;
  }
  if (!Array.isArray(event.content)) {
    return "";
  }
  return event.content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
function parseKimiStreamText(text) {
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
function getKimiAvailability(cwd) {
  return binaryAvailable(KIMI_BIN, ["-V"], { cwd });
}
function buildKimiAuthStatus(result) {
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? null
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
function getKimiAuthStatus(cwd, { promptRunner = runKimiPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS4,
    extraArgs: ["--max-steps-per-turn", "1"]
  });
  return buildKimiAuthStatus(result);
}
function runKimiPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS4,
  extraArgs = [],
  resumeSessionId = null,
  bin = KIMI_BIN
} = {}) {
  const invocation = buildKimiInvocation({
    prompt,
    model,
    resumeSessionId,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    timeout,
    input: invocation.input
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr.trim() || `kimi exited with code ${result.status}`,
      status: result.status
    };
  }
  const parsed = parseKimiStreamText(result.stdout);
  const session = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"]
  });
  return {
    ok: Boolean(parsed.response.trim()),
    response: parsed.response,
    events: parsed.events,
    toolEvents: parsed.toolEvents,
    sessionId: session.sessionId,
    model,
    error: parsed.response.trim() ? null : "kimi produced no visible text"
  };
}
function runKimiPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS4,
  extraArgs = [],
  resumeSessionId = null,
  onEvent = () => {
  },
  bin = KIMI_BIN,
  spawnImpl
} = {}) {
  const invocation = buildKimiInvocation({
    prompt,
    model,
    resumeSessionId,
    extraArgs,
    bin
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
        try {
          onEvent(event);
        } catch {
        }
      }
    }
  }).then((result) => {
    const parsed = parseKimiStreamText(result.stdout);
    const session = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: session.sessionId,
      ok: result.ok && hasVisibleText,
      error: result.ok ? hasVisibleText ? null : "kimi produced no visible text" : result.error
    };
  });
}

// packages/polycli-runtime/src/qwen.js
var QWEN_BIN = process.env.QWEN_CLI_BIN || "qwen";
var DEFAULT_TIMEOUT_MS5 = 3e5;
var AUTH_CHECK_TIMEOUT_MS5 = 3e4;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
var NO_PROXY_DEFAULTS = ["localhost", "127.0.0.1"];
var QWEN_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var QWEN_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;
var ENV_ALLOW_EXACT = /* @__PURE__ */ new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_NUMERIC",
  "LC_TIME",
  "TMPDIR",
  "TZ",
  "PWD",
  "LOGNAME",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
  "CLAUDE_PLUGIN_DATA",
  "OPENAI_BASE_URL"
]);
var ENV_ALLOW_PREFIXES = ["QWEN_", "BAILIAN_", "DASHSCOPE_", "ALIBABA_", "ALI_", "NPM_CONFIG_"];
function filterEnvForChild(parentEnv = process.env) {
  const filtered = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value == null) continue;
    if (ENV_ALLOW_EXACT.has(key) || ENV_ALLOW_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      filtered[key] = value;
    }
  }
  return filtered;
}
function buildQwenEnv(settings = null, parentEnv = process.env) {
  const env = filterEnvForChild(parentEnv);
  const proxy = settings?.proxy;
  const existingProxy = PROXY_KEYS.map((key) => env[key]).find(Boolean) || null;
  const effectiveProxy = existingProxy || proxy;
  if (effectiveProxy) {
    for (const key of PROXY_KEYS) {
      env[key] = effectiveProxy;
    }
  }
  const noProxy = (env.NO_PROXY ?? env.no_proxy ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const mergedNoProxy = Array.from(/* @__PURE__ */ new Set([...noProxy, ...NO_PROXY_DEFAULTS])).join(",");
  env.NO_PROXY = mergedNoProxy;
  env.no_proxy = mergedNoProxy;
  return env;
}
function buildQwenInvocation({
  prompt,
  sessionId,
  resumeLast = false,
  resumeId,
  approvalMode,
  unsafeFlag = false,
  background = false,
  maxSteps = 20,
  appendSystem,
  appendDirs,
  bin = QWEN_BIN
} = {}) {
  let effectiveApprovalMode = approvalMode;
  if (!effectiveApprovalMode) {
    effectiveApprovalMode = unsafeFlag ? "yolo" : "auto-edit";
  }
  if (background && !unsafeFlag && effectiveApprovalMode === "yolo") {
    throw new Error("Background qwen runs with yolo approval require unsafeFlag=true");
  }
  if (sessionId && !UUID_RE.test(sessionId)) {
    throw new Error("--session-id must be a UUID");
  }
  if (resumeId && !UUID_RE.test(resumeId)) {
    throw new Error("-r resume-id must be a UUID");
  }
  const args = [];
  if (sessionId) args.push("--session-id", sessionId);
  else if (resumeLast) args.push("-c");
  else if (resumeId) args.push("-r", resumeId);
  args.push("--output-format", "stream-json");
  args.push("--approval-mode", effectiveApprovalMode);
  args.push("--max-session-turns", String(maxSteps));
  if (appendSystem) args.push("--append-system-prompt", appendSystem);
  if (appendDirs?.length) args.push("--include-directories", appendDirs.join(","));
  args.push(String(prompt ?? ""));
  return {
    bin,
    args,
    approvalMode: effectiveApprovalMode
  };
}
function parseAssistantContent(blocks) {
  const out = { texts: [], toolUses: [], toolResults: [], imageCount: 0 };
  if (!Array.isArray(blocks)) return out;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      out.texts.push(block.text);
    } else if (block.type === "tool_use") {
      out.toolUses.push({
        id: block.id ?? null,
        name: block.name ?? null,
        input: block.input ?? block.tool_input ?? null
      });
    } else if (block.type === "tool_result") {
      out.toolResults.push({
        tool_use_id: block.tool_use_id ?? null,
        content: block.content ?? null,
        is_error: Boolean(block.is_error)
      });
    } else if (block.type === "image") {
      out.imageCount += 1;
    }
  }
  return out;
}
function extractQwenText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (isSuccessfulQwenResultEvent(event) && typeof event.result === "string") {
    return event.result;
  }
  if (event.type !== "assistant" || !Array.isArray(event.message?.content)) {
    return "";
  }
  return event.message.content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
function isSuccessfulQwenResultEvent(event) {
  if (!event || event.type !== "result" || event.is_error === true) {
    return false;
  }
  if (event.subtype == null) {
    return true;
  }
  return event.subtype === "success";
}
function extractQwenResultError(event) {
  if (!event || event.type !== "result") {
    return null;
  }
  if (event.is_error !== true && event.subtype !== "error") {
    return null;
  }
  return typeof event.result === "string" && event.result.trim() ? event.result : null;
}
function parseQwenStreamText(text) {
  const out = {
    sessionId: null,
    model: null,
    mcpServers: [],
    assistantTexts: [],
    toolUses: [],
    toolResults: [],
    imageCount: 0,
    resultEvent: null,
    response: ""
  };
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") {
      out.sessionId = event.session_id ?? out.sessionId;
      out.model = event.model ?? out.model;
      if (Array.isArray(event.mcp_servers)) out.mcpServers = event.mcp_servers;
    } else if (event.type === "assistant") {
      const parsed = parseAssistantContent(event.message?.content ?? []);
      out.assistantTexts.push(...parsed.texts);
      out.toolUses.push(...parsed.toolUses);
      out.toolResults.push(...parsed.toolResults);
      out.imageCount += parsed.imageCount;
    } else if (event.type === "result") {
      out.resultEvent = event;
    }
  }
  out.response = out.assistantTexts.join("");
  if (!out.response.trim() && isSuccessfulQwenResultEvent(out.resultEvent) && typeof out.resultEvent?.result === "string") {
    out.response = out.resultEvent.result;
  }
  return out;
}
function getQwenAvailability(cwd) {
  return binaryAvailable(QWEN_BIN, ["--version"], { cwd });
}
function buildQwenAuthStatus(pingResult) {
  if (pingResult.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: pingResult.model ?? null
    };
  }
  const detail = String(pingResult.error ?? "").trim() || "qwen auth probe failed";
  if (QWEN_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (QWEN_TRANSIENT_PROBE_ERROR_RE.test(detail)) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: pingResult.model ?? null };
  }
  return { loggedIn: false, detail };
}
function getQwenAuthStatus(cwd, { promptRunner = runQwenPrompt, envBuilder = buildQwenEnv } = {}) {
  const env = envBuilder();
  const pingResult = promptRunner({
    prompt: "ping",
    cwd,
    env,
    timeout: AUTH_CHECK_TIMEOUT_MS5,
    maxSteps: 1
  });
  return buildQwenAuthStatus(pingResult);
}
function runQwenPrompt({
  prompt,
  cwd,
  env = buildQwenEnv(),
  timeout = DEFAULT_TIMEOUT_MS5,
  sessionId,
  resumeLast = false,
  resumeId,
  approvalMode,
  unsafeFlag = false,
  background = false,
  maxSteps = 20,
  appendSystem,
  appendDirs,
  bin = QWEN_BIN
} = {}) {
  const invocation = buildQwenInvocation({
    prompt,
    sessionId,
    resumeLast,
    resumeId,
    approvalMode,
    unsafeFlag,
    background,
    maxSteps,
    appendSystem,
    appendDirs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    env,
    timeout
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  const parsed = parseQwenStreamText(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"]
  });
  const resultEventError = extractQwenResultError(parsed.resultEvent);
  return {
    ok: result.status === 0 && !resultEventError && Boolean(parsed.response.trim()),
    status: result.status,
    stderr: result.stderr,
    ...parsed,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    error: result.status === 0 && !resultEventError && parsed.response.trim() ? null : result.stderr.trim() || resultEventError || `qwen exited with code ${result.status}`
  };
}
function runQwenPromptStreaming({
  prompt,
  cwd,
  env = buildQwenEnv(),
  timeout = DEFAULT_TIMEOUT_MS5,
  sessionId,
  resumeLast = false,
  resumeId,
  approvalMode,
  unsafeFlag = false,
  background = false,
  maxSteps = 20,
  appendSystem,
  appendDirs,
  onEvent = () => {
  },
  bin = QWEN_BIN,
  spawnImpl
} = {}) {
  const invocation = buildQwenInvocation({
    prompt,
    sessionId,
    resumeLast,
    resumeId,
    approvalMode,
    unsafeFlag,
    background,
    maxSteps,
    appendSystem,
    appendDirs,
    bin
  });
  return spawnStreamingCommand({
    bin: invocation.bin,
    args: invocation.args,
    cwd,
    env,
    timeout,
    detached: background,
    unref: background,
    stdio: ["ignore", "pipe", "pipe"],
    spawnImpl,
    onStdoutLine(line) {
      if (!line.trim().startsWith("{")) return;
      try {
        onEvent(JSON.parse(line));
      } catch {
      }
    }
  }).then((result) => {
    const parsed = parseQwenStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const hasVisibleText = Boolean(parsed.response.trim());
    const resultEventError = extractQwenResultError(parsed.resultEvent);
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultEventError && hasVisibleText,
      error: result.ok && !resultEventError ? hasVisibleText ? null : resultEventError || "qwen produced no visible text" : resultEventError || result.error
    };
  });
}

// packages/polycli-runtime/src/minimax.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var MINI_AGENT_BIN = process.env.MINI_AGENT_BIN || "mini-agent";
var MINI_AGENT_LOG_DIR = process.env.MINI_AGENT_LOG_DIR || path.join(os.homedir(), ".mini-agent", "log");
var MINI_AGENT_CONFIG_PATH = process.env.MINI_AGENT_CONFIG_PATH || path.join(os.homedir(), ".mini-agent", "config", "config.yaml");
var DEFAULT_TIMEOUT_MS6 = 12e4;
var AUTH_CHECK_TIMEOUT_MS6 = 3e4;
function readMiniMaxConfig() {
  try {
    const text = fs.readFileSync(MINI_AGENT_CONFIG_PATH, "utf8");
    const read = (key) => {
      const match = text.match(new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^#\\n]+))`, "m"));
      return match ? match[1] ?? match[2] ?? match[3]?.trim() ?? null : null;
    };
    return {
      api_key: read("api_key"),
      api_base: read("api_base"),
      model: read("model")
    };
  } catch {
    return { api_key: null, api_base: null, model: null };
  }
}
function stripAnsiSgr(text) {
  return String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "");
}
function buildMiniMaxInvocation({
  prompt,
  cwd,
  extraArgs = [],
  bin = MINI_AGENT_BIN
} = {}) {
  return {
    bin,
    args: ["-t", String(prompt ?? ""), "-w", cwd || process.cwd(), ...extraArgs]
  };
}
function extractMiniMaxLogPath(text) {
  const match = stripAnsiSgr(text).match(/Log file:\s+(\S+\.log)/);
  return match ? match[1] : null;
}
function parseMiniMaxResponseBlocks(logText) {
  const blocks = [];
  const lines = String(logText ?? "").split(/\r?\n/);
  let current = null;
  let bodyLines = [];
  let braceDepth = 0;
  let inString = false;
  const scanLine = (line) => {
    let opens = 0;
    let closes = 0;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (inString) {
        if (char === "\\") {
          index += 1;
        } else if (char === '"') {
          inString = false;
        }
      } else if (char === '"') {
        inString = true;
      } else if (char === "{") {
        opens += 1;
      } else if (char === "}") {
        closes += 1;
      }
    }
    braceDepth += opens - closes;
  };
  const finish = () => {
    if (!current) return;
    const raw = bodyLines.join("\n");
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
    }
    blocks.push({ ...current, raw, json });
    current = null;
    bodyLines = [];
    braceDepth = 0;
    inString = false;
  };
  for (const line of lines) {
    const header = line.match(/^\[(\d+)\]\s+RESPONSE$/);
    if (header) {
      finish();
      current = { index: Number.parseInt(header[1], 10) };
      continue;
    }
    if (!current) continue;
    if (bodyLines.length === 0 && !line.trimStart().startsWith("{")) continue;
    bodyLines.push(line);
    scanLine(line);
    if (braceDepth <= 0 && bodyLines.length > 0 && !inString) {
      finish();
    }
  }
  finish();
  return blocks;
}
function extractMiniMaxResponseFromLogText(logText) {
  const blocks = parseMiniMaxResponseBlocks(logText);
  const picked = [...blocks].reverse().find((block) => block.json && (block.json.finish_reason || block.json.content));
  if (!picked?.json) {
    return { response: "", finishReason: null, toolCalls: [] };
  }
  return {
    response: typeof picked.json.content === "string" ? picked.json.content : "",
    finishReason: picked.json.finish_reason ?? null,
    toolCalls: Array.isArray(picked.json.tool_calls) ? picked.json.tool_calls : []
  };
}
function extractMiniMaxEventText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "progress" && typeof event.text === "string") {
    return event.text;
  }
  if (event.type === "result" && typeof event.response === "string") {
    return event.response;
  }
  return "";
}
function snapshotLogDir(logDir) {
  try {
    return new Set(fs.readdirSync(logDir).filter((name) => name.endsWith(".log")));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function diffLogSnapshot(beforeSet, logDir) {
  try {
    const current = fs.readdirSync(logDir).filter((name) => name.endsWith(".log"));
    const novel = current.filter((name) => !beforeSet.has(name));
    if (novel.length === 0) return null;
    novel.sort();
    return path.join(logDir, novel[novel.length - 1]);
  } catch {
    return null;
  }
}
function getMiniMaxAvailability(cwd) {
  return binaryAvailable(MINI_AGENT_BIN, ["--version"], { cwd });
}
async function getMiniMaxAuthStatus(cwd) {
  const config = readMiniMaxConfig();
  if (!config.api_key || config.api_key === "YOUR_API_KEY_HERE") {
    return { loggedIn: false, detail: "api_key is placeholder or missing" };
  }
  const result = await runMiniMaxPrompt({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS6
  });
  return {
    loggedIn: result.ok,
    detail: result.ok ? "authenticated" : result.error,
    model: config.model,
    apiBase: config.api_base
  };
}
function runMiniMaxPrompt({
  prompt,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS6,
  extraArgs = [],
  env = process.env,
  onProgressLine,
  bin = MINI_AGENT_BIN,
  spawnImpl
} = {}) {
  return new Promise((resolve) => {
    const beforeLogs = snapshotLogDir(MINI_AGENT_LOG_DIR);
    const invocation = buildMiniMaxInvocation({ prompt, cwd, extraArgs, bin });
    let logPath = null;
    const handleStdoutLine = (line) => {
      const clean = stripAnsiSgr(line);
      if (!logPath) logPath = extractMiniMaxLogPath(clean);
      if (typeof onProgressLine === "function") {
        try {
          onProgressLine(clean);
        } catch {
        }
      }
    };
    spawnStreamingCommand({
      bin: invocation.bin,
      args: invocation.args,
      cwd: cwd || process.cwd(),
      env,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      spawnImpl,
      onStdoutLine: handleStdoutLine
    }).then((result) => {
      const effectiveLogPath = logPath || diffLogSnapshot(beforeLogs, MINI_AGENT_LOG_DIR);
      const parsed = effectiveLogPath && fs.existsSync(effectiveLogPath) ? extractMiniMaxResponseFromLogText(fs.readFileSync(effectiveLogPath, "utf8")) : { response: "", finishReason: null, toolCalls: [] };
      resolve({
        ...result,
        logPath: effectiveLogPath,
        ...parsed,
        ok: result.ok && Boolean(parsed.response.trim()),
        error: result.ok && parsed.response.trim() ? null : result.error
      });
    });
  });
}
async function runMiniMaxPromptStreaming({
  prompt,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS6,
  extraArgs = [],
  env = process.env,
  onEvent = () => {
  },
  bin = MINI_AGENT_BIN,
  spawnImpl
} = {}) {
  return runMiniMaxPrompt({
    prompt,
    cwd,
    timeout,
    extraArgs,
    env,
    bin,
    spawnImpl,
    onProgressLine(line) {
      try {
        onEvent({ type: "progress", text: line });
      } catch {
      }
    }
  }).then((result) => {
    try {
      onEvent({
        type: "result",
        response: result.response,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls
      });
    } catch {
    }
    return result;
  });
}

// packages/polycli-runtime/src/opencode.js
var OPENCODE_BIN = process.env.OPENCODE_CLI_BIN || "opencode";
var DEFAULT_TIMEOUT_MS7 = 9e5;
var AUTH_CHECK_TIMEOUT_MS7 = 3e4;
var OPENCODE_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var OPENCODE_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;
function collectOpenCodeContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
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
    return `opencode exited with code ${event.exitCode}`;
  }
  if (Number.isFinite(event.status) && event.status !== 0) {
    return `opencode exited with code ${event.status}`;
  }
  return null;
}
function buildOpenCodeInvocation({
  prompt,
  model = null,
  cwd,
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  skipPermissions = true,
  extraArgs = [],
  bin = OPENCODE_BIN
} = {}) {
  const args = [
    "run",
    String(prompt ?? ""),
    "--format",
    "json",
    "--dir",
    cwd || process.cwd()
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
function extractOpenCodeText(event) {
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
function parseOpenCodeStreamText(text) {
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
function parseOpenCodeJsonResult(stdout, stderr, status) {
  const parsed = parseOpenCodeStreamText(stdout);
  const resolvedSession = resolveSessionId({
    stdout,
    stderr,
    priority: ["stdout", "stderr", "file"]
  });
  const resultError = getOpenCodeResultError(parsed.resultEvent);
  const hasVisibleText = Boolean(parsed.response.trim());
  return {
    ok: status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    model: parsed.model,
    status,
    error: status === 0 ? resultError || (hasVisibleText ? null : "opencode produced no visible text") : String(stderr ?? "").trim() || `opencode exited with code ${status}`
  };
}
function getOpenCodeAvailability(cwd) {
  return binaryAvailable(OPENCODE_BIN, ["--version"], { cwd });
}
function buildOpenCodeAuthStatus(result) {
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? null
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
function getOpenCodeAuthStatus(cwd, { promptRunner = runOpenCodePrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS7
  });
  return buildOpenCodeAuthStatus(result);
}
function runOpenCodePrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS7,
  env = process.env,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  skipPermissions = true,
  bin = OPENCODE_BIN
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
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout, env });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT" ? `opencode timed out after ${Math.round(timeout / 1e3)}s` : result.error.message
    };
  }
  return parseOpenCodeJsonResult(result.stdout, result.stderr, result.status);
}
function runOpenCodePromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS7,
  env = process.env,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  agent = null,
  variant = null,
  skipPermissions = true,
  onEvent = () => {
  },
  bin = OPENCODE_BIN,
  spawnImpl
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
    bin
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
      } catch {
      }
    }
  }).then((result) => {
    const parsed = parseOpenCodeStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const resultError = getOpenCodeResultError(parsed.resultEvent);
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok ? resultError || (hasVisibleText ? null : "opencode produced no visible text") : result.error
    };
  });
}

// packages/polycli-runtime/src/pi.js
var PI_BIN = process.env.PI_CLI_BIN || "pi";
var DEFAULT_TIMEOUT_MS8 = 9e5;
var AUTH_CHECK_TIMEOUT_MS8 = 3e4;
var PI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var PI_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;
function collectPiContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
function buildPiInvocation({
  prompt,
  model = null,
  mode = "json",
  resumeSessionId = null,
  continueLast = false,
  noSession = false,
  extraArgs = [],
  bin = PI_BIN
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
function extractPiText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
    return event.assistantMessageEvent.delta;
  }
  if (event.type === "agent_end" && typeof event.result?.text === "string") {
    return event.result.text;
  }
  const role = event.role ?? event.message?.role ?? null;
  if (role && role !== "assistant") {
    return "";
  }
  return collectPiContentText(event.content ?? event.message?.content);
}
function parsePiStreamText(text) {
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
function getPiAvailability(cwd) {
  return binaryAvailable(PI_BIN, ["--version"], { cwd });
}
function buildPiAuthStatus(result) {
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? null
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
function getPiAuthStatus(cwd, { promptRunner = runPiPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS8
  });
  return buildPiAuthStatus(result);
}
function runPiPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS8,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  noSession = false,
  bin = PI_BIN
} = {}) {
  const invocation = buildPiInvocation({
    prompt,
    model,
    mode: "json",
    resumeSessionId,
    continueLast,
    noSession,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT" ? `pi timed out after ${Math.round(timeout / 1e3)}s` : result.error.message
    };
  }
  const parsed = parsePiStreamText(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"]
  });
  const resultError = parsed.resultEvent?.error ? String(parsed.resultEvent.error) : null;
  const hasVisibleText = Boolean(parsed.response.trim());
  return {
    ok: result.status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    model: parsed.model,
    error: result.status === 0 ? resultError || (hasVisibleText ? null : "pi produced no visible text") : result.stderr.trim() || `pi exited with code ${result.status}`,
    status: result.status
  };
}
function runPiPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS8,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  noSession = false,
  onEvent = () => {
  },
  bin = PI_BIN,
  spawnImpl
} = {}) {
  const invocation = buildPiInvocation({
    prompt,
    model,
    mode: "json",
    resumeSessionId,
    continueLast,
    noSession,
    extraArgs,
    bin
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
      } catch {
      }
    }
  }).then((result) => {
    const parsed = parsePiStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const resultError = parsed.resultEvent?.error ? String(parsed.resultEvent.error) : null;
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok ? resultError || (hasVisibleText ? null : "pi produced no visible text") : result.error
    };
  });
}

// packages/polycli-timing/src/constants.js
var TIMING_SCHEMA_VERSION = 1;
var TIMING_METRIC_NAMES = ["cold", "ttft", "gen", "tool", "retry", "tail", "total"];
var TIMING_METRIC_STATUSES = ["measured", "zero", "missing", "unsupported"];
var TIMING_RUNTIME_PERSISTENCE = ["ephemeral", "session", "daemon"];
var TIMING_MEASUREMENT_SCOPES = ["request", "turn", "job"];

// packages/polycli-timing/src/percentile.js
function calculatePercentiles(values, percentiles = [50, 95, 99]) {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((left, right) => left - right);
  const output2 = {};
  for (const percentile of percentiles) {
    const key = `p${percentile}`;
    if (sorted.length === 0) {
      output2[key] = null;
      continue;
    }
    const rank = Math.max(0, Math.ceil(percentile / 100 * sorted.length) - 1);
    output2[key] = sorted[Math.min(rank, sorted.length - 1)];
  }
  return output2;
}

// packages/polycli-timing/src/validate.js
function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
function validateMetric(name, metric, errors) {
  if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
    errors.push(`metrics.${name} must be an object`);
    return;
  }
  if (!TIMING_METRIC_STATUSES.includes(metric.status)) {
    errors.push(`metrics.${name}.status must be one of ${TIMING_METRIC_STATUSES.join(", ")}`);
    return;
  }
  if (metric.status === "measured") {
    if (!Number.isFinite(metric.ms) || metric.ms <= 0) {
      errors.push(`metrics.${name}.ms must be > 0 when status=measured`);
    }
    return;
  }
  if (metric.status === "zero") {
    if (metric.ms !== 0) {
      errors.push(`metrics.${name}.ms must be 0 when status=zero`);
    }
    return;
  }
  if (metric.ms !== null) {
    errors.push(`metrics.${name}.ms must be null when status=${metric.status}`);
  }
}
function validateTimingRecord(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, errors: ["record must be an object"] };
  }
  if (record.version !== TIMING_SCHEMA_VERSION) {
    errors.push(`version must be ${TIMING_SCHEMA_VERSION}`);
  }
  if (typeof record.provider !== "string" || record.provider.trim().length === 0) {
    errors.push("provider must be a non-empty string");
  }
  if (!TIMING_RUNTIME_PERSISTENCE.includes(record.runtimePersistence)) {
    errors.push(`runtimePersistence must be one of ${TIMING_RUNTIME_PERSISTENCE.join(", ")}`);
  }
  if (!TIMING_MEASUREMENT_SCOPES.includes(record.measurementScope)) {
    errors.push(`measurementScope must be one of ${TIMING_MEASUREMENT_SCOPES.join(", ")}`);
  }
  if (!isIsoDate(record.completedAt)) {
    errors.push("completedAt must be an ISO-8601 date string");
  }
  if (!record.metrics || typeof record.metrics !== "object" || Array.isArray(record.metrics)) {
    errors.push("metrics must be an object");
  } else {
    for (const metricName of TIMING_METRIC_NAMES) {
      if (!(metricName in record.metrics)) {
        errors.push(`metrics.${metricName} is required`);
        continue;
      }
      validateMetric(metricName, record.metrics[metricName], errors);
    }
    const total = record.metrics.total;
    if (total && !["measured", "zero"].includes(total.status)) {
      errors.push("metrics.total.status must be measured or zero");
    }
  }
  return { ok: errors.length === 0, errors };
}

// packages/polycli-timing/src/aggregate.js
function createMetricSummary() {
  return {
    contributingCount: 0,
    measuredCount: 0,
    zeroCount: 0,
    missingCount: 0,
    unsupportedCount: 0,
    min: null,
    max: null,
    avg: null,
    p50: null,
    p95: null,
    p99: null,
    capability: "unsupported",
    measuredValues: []
  };
}
function createProviderSummary() {
  return {
    recordCount: 0,
    runtimePersistenceCounts: Object.fromEntries(TIMING_RUNTIME_PERSISTENCE.map((name) => [name, 0])),
    measurementScopeCounts: Object.fromEntries(TIMING_MEASUREMENT_SCOPES.map((name) => [name, 0])),
    metrics: Object.fromEntries(TIMING_METRIC_NAMES.map((name) => [name, createMetricSummary()]))
  };
}
function finalizeMetric(summary) {
  const supportedCount = summary.measuredCount + summary.zeroCount + summary.missingCount;
  if (summary.unsupportedCount > 0 && supportedCount > 0) {
    summary.capability = "mixed";
  } else if (supportedCount > 0) {
    summary.capability = "supported";
  }
  if (summary.measuredValues.length === 0) {
    delete summary.measuredValues;
    return summary;
  }
  const stats = calculatePercentiles(summary.measuredValues, [50, 95, 99]);
  const total = summary.measuredValues.reduce((sum, value) => sum + value, 0);
  summary.min = Math.min(...summary.measuredValues);
  summary.max = Math.max(...summary.measuredValues);
  summary.avg = total / summary.measuredValues.length;
  summary.p50 = stats.p50;
  summary.p95 = stats.p95;
  summary.p99 = stats.p99;
  delete summary.measuredValues;
  return summary;
}
function aggregateTimingRecords(records) {
  const summary = {
    recordCount: 0,
    invalidRecords: [],
    byProvider: {}
  };
  for (const record of records) {
    const validation = validateTimingRecord(record);
    if (!validation.ok) {
      summary.invalidRecords.push({ record, errors: validation.errors });
      continue;
    }
    summary.recordCount += 1;
    const provider = record.provider;
    const providerSummary = summary.byProvider[provider] ?? createProviderSummary();
    providerSummary.recordCount += 1;
    providerSummary.runtimePersistenceCounts[record.runtimePersistence] += 1;
    providerSummary.measurementScopeCounts[record.measurementScope] += 1;
    summary.byProvider[provider] = providerSummary;
    for (const metricName of TIMING_METRIC_NAMES) {
      const metric = record.metrics[metricName];
      const metricSummary = providerSummary.metrics[metricName];
      if (metric.status === "measured") {
        metricSummary.measuredCount += 1;
        metricSummary.contributingCount += 1;
        metricSummary.measuredValues.push(metric.ms);
      } else if (metric.status === "zero") {
        metricSummary.zeroCount += 1;
        metricSummary.contributingCount += 1;
      } else if (metric.status === "missing") {
        metricSummary.missingCount += 1;
      } else if (metric.status === "unsupported") {
        metricSummary.unsupportedCount += 1;
      }
    }
  }
  for (const providerSummary of Object.values(summary.byProvider)) {
    for (const metricName of TIMING_METRIC_NAMES) {
      providerSummary.metrics[metricName] = finalizeMetric(providerSummary.metrics[metricName]);
    }
  }
  return summary;
}

// packages/polycli-timing/src/index.js
var TIMING_SCHEMA_URL = new URL("../timing.schema.json", import.meta.url);

// packages/polycli-runtime/src/timing.js
function measuredOrZero(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid measured timing value: ${ms}`);
  }
  if (ms === 0) {
    return { status: "zero", ms: 0 };
  }
  return { status: "measured", ms };
}
function missingMetric() {
  return { status: "missing", ms: null };
}
function unsupportedMetric() {
  return { status: "unsupported", ms: null };
}
function capabilityMetric(ms, supported) {
  if (!supported) {
    return unsupportedMetric();
  }
  if (!Number.isFinite(ms)) {
    return missingMetric();
  }
  return measuredOrZero(ms);
}
function extractProviderEventText(provider, event) {
  if (provider === "claude") return extractClaudeText(event);
  if (provider === "copilot") return extractCopilotText(event);
  if (provider === "gemini") return extractGeminiText(event);
  if (provider === "kimi") return extractKimiText(event);
  if (provider === "qwen") return extractQwenText(event);
  if (provider === "minimax") return extractMiniMaxEventText(event);
  if (provider === "opencode") return extractOpenCodeText(event);
  if (provider === "pi") return extractPiText(event);
  return "";
}
function buildPromptTimingRecord({
  provider,
  kind = "prompt",
  runtimePersistence = "ephemeral",
  measurementScope = "request",
  completedAt = (/* @__PURE__ */ new Date()).toISOString(),
  totalMs,
  ttftMs = null,
  tailMs = null,
  toolMs = null,
  supportedMetrics = {},
  meta = null
} = {}) {
  const metrics = {
    cold: unsupportedMetric(),
    ttft: capabilityMetric(ttftMs, Boolean(supportedMetrics.ttft)),
    gen: capabilityMetric(
      Number.isFinite(ttftMs) ? Math.max(totalMs - ttftMs, 0) : null,
      Boolean(supportedMetrics.gen)
    ),
    tool: capabilityMetric(toolMs, Boolean(supportedMetrics.tool)),
    retry: unsupportedMetric(),
    tail: capabilityMetric(tailMs, Boolean(supportedMetrics.tail)),
    total: measuredOrZero(totalMs)
  };
  const record = {
    version: TIMING_SCHEMA_VERSION,
    provider,
    runtimePersistence,
    measurementScope,
    completedAt,
    kind,
    metrics
  };
  if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
    record.meta = meta;
  }
  const validation = validateTimingRecord(record);
  if (!validation.ok) {
    throw new Error(`Invalid timing record: ${validation.errors.join("; ")}`);
  }
  return record;
}
function attachPromptTiming(result, {
  provider,
  kind = "prompt",
  runtimePersistence = "ephemeral",
  measurementScope = "request",
  totalMs,
  ttftMs = null,
  tailMs = null,
  toolMs = null,
  supportedMetrics = {},
  meta = null
} = {}) {
  return {
    ...result,
    timing: buildPromptTimingRecord({
      provider,
      kind,
      runtimePersistence,
      measurementScope,
      totalMs,
      ttftMs,
      tailMs,
      toolMs,
      supportedMetrics,
      meta,
      completedAt: (/* @__PURE__ */ new Date()).toISOString()
    })
  };
}

// packages/polycli-runtime/src/registry.js
var TIMING_SUPPORT = {
  claude: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  copilot: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  gemini: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  kimi: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  qwen: { ttft: true, gen: true, tail: true, tool: true, runtimePersistence: "session" },
  minimax: { ttft: false, gen: false, tail: false, tool: false, runtimePersistence: "ephemeral" },
  opencode: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  pi: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" }
};
var RUNTIMES = {
  claude: {
    id: "claude",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getClaudeAvailability,
    getAuthStatus: getClaudeAuthStatus,
    runPrompt: runClaudePrompt,
    runPromptStreaming: runClaudePromptStreaming
  },
  copilot: {
    id: "copilot",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getCopilotAvailability,
    getAuthStatus: getCopilotAuthStatus,
    runPrompt: runCopilotPrompt,
    runPromptStreaming: runCopilotPromptStreaming
  },
  gemini: {
    id: "gemini",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getGeminiAvailability,
    getAuthStatus: getGeminiAuthStatus,
    runPrompt: runGeminiPrompt,
    runPromptStreaming: runGeminiPromptStreaming
  },
  kimi: {
    id: "kimi",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getKimiAvailability,
    getAuthStatus: getKimiAuthStatus,
    runPrompt: runKimiPrompt,
    runPromptStreaming: runKimiPromptStreaming
  },
  qwen: {
    id: "qwen",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getQwenAvailability,
    getAuthStatus: getQwenAuthStatus,
    runPrompt: runQwenPrompt,
    runPromptStreaming: runQwenPromptStreaming
  },
  minimax: {
    id: "minimax",
    capabilities: {
      streaming: true,
      sessionResume: false,
      structuredOutput: false,
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getMiniMaxAvailability,
    getAuthStatus: getMiniMaxAuthStatus,
    runPrompt: runMiniMaxPrompt,
    runPromptStreaming: runMiniMaxPromptStreaming
  },
  opencode: {
    id: "opencode",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getOpenCodeAvailability,
    getAuthStatus: getOpenCodeAuthStatus,
    runPrompt: runOpenCodePrompt,
    runPromptStreaming: runOpenCodePromptStreaming
  },
  pi: {
    id: "pi",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getPiAvailability,
    getAuthStatus: getPiAuthStatus,
    runPrompt: runPiPrompt,
    runPromptStreaming: runPiPromptStreaming
  }
};
function getTimingSupport(provider) {
  return TIMING_SUPPORT[provider] || {
    ttft: false,
    gen: false,
    tail: false,
    tool: false,
    runtimePersistence: "ephemeral"
  };
}
function inferRuntimePersistence(provider, result) {
  const support = getTimingSupport(provider);
  if (support.runtimePersistence === "session" && result?.sessionId) {
    return "session";
  }
  return "ephemeral";
}
function trackQwenToolTiming(event, timestamp, state) {
  if (event?.type !== "assistant" || !Array.isArray(event.message?.content)) {
    return;
  }
  for (const block of event.message.content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "tool_use" && block.id && !state.pendingTools.has(block.id)) {
      state.pendingTools.set(block.id, timestamp);
      continue;
    }
    if (block.type !== "tool_result" || !block.tool_use_id) continue;
    const startedAt = state.pendingTools.get(block.tool_use_id);
    if (startedAt == null) continue;
    state.pendingTools.delete(block.tool_use_id);
    state.toolMs = (state.toolMs ?? 0) + Math.max(timestamp - startedAt, 0);
  }
}
function isTerminalSummaryEvent(provider, event) {
  if (!event || typeof event !== "object") {
    return false;
  }
  if (provider === "qwen" || provider === "claude" || provider === "opencode") {
    return event.type === "result";
  }
  if (provider === "gemini") {
    return event.type === "result";
  }
  if (provider === "copilot") {
    return event.type === "assistant.message" || event.type === "result" || event.type === "final";
  }
  if (provider === "pi") {
    return event.type === "agent_end";
  }
  return false;
}
function shouldCountEventTextForTiming(provider, event, firstTextAt) {
  if (firstTextAt == null) {
    return true;
  }
  return !isTerminalSummaryEvent(provider, event);
}
function getProviderRuntime(providerId) {
  const runtime = RUNTIMES[providerId];
  if (!runtime) {
    throw new Error(`Unknown provider runtime: ${providerId}`);
  }
  return runtime;
}
function listProviderRuntimes() {
  return PROVIDER_IDS.map((providerId) => getProviderRuntime(providerId));
}
async function runProviderPromptStreaming({
  provider,
  kind = "prompt",
  measurementScope = "request",
  meta = null,
  onEvent,
  ...options
}) {
  const startedAt = Date.now();
  const timingSupport = getTimingSupport(provider);
  let firstTextAt = null;
  let lastTextAt = null;
  const toolState = { pendingTools: /* @__PURE__ */ new Map(), toolMs: null };
  const result = await getProviderRuntime(provider).runPromptStreaming({
    ...options,
    onEvent(event) {
      const now = Date.now();
      const eventText = extractProviderEventText(provider, event);
      if ((timingSupport.ttft || timingSupport.tail) && eventText.trim() && shouldCountEventTextForTiming(provider, event, firstTextAt)) {
        if (firstTextAt == null) {
          firstTextAt = now;
        }
        lastTextAt = now;
      }
      if (timingSupport.tool && provider === "qwen") {
        trackQwenToolTiming(event, now, toolState);
      }
      if (typeof onEvent === "function") {
        onEvent(event);
      }
    }
  });
  const finishedAt = Date.now();
  const runtimePersistence = inferRuntimePersistence(provider, result);
  return attachPromptTiming(result, {
    provider,
    kind,
    runtimePersistence,
    measurementScope,
    totalMs: finishedAt - startedAt,
    ttftMs: firstTextAt == null ? null : firstTextAt - startedAt,
    tailMs: lastTextAt == null ? null : Math.max(finishedAt - lastTextAt, 0),
    toolMs: toolState.toolMs,
    supportedMetrics: timingSupport,
    meta
  });
}

// plugins/polycli/scripts/lib/job-control.mjs
import fs4 from "node:fs";
import process4 from "node:process";

// plugins/polycli/scripts/lib/state.mjs
import crypto2 from "node:crypto";
import fs3 from "node:fs";
import os2 from "node:os";
import path3 from "node:path";

// packages/polycli-utils/src/atomic-save.js
import crypto from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
import process3 from "node:process";
var LockfileTimeoutError = class extends Error {
  constructor(lockPath, timeoutMs) {
    super(`Timed out acquiring lockfile ${lockPath} after ${timeoutMs}ms`);
    this.code = "ELOCKTIMEOUT";
    this.lockPath = lockPath;
    this.timeoutMs = timeoutMs;
  }
};
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function ensureParentDir(filePath) {
  fs2.mkdirSync(path2.dirname(filePath), { recursive: true });
}
function normalizeWriteOptions(options) {
  if (typeof options === "string") {
    return {
      flag: "w",
      mode: 438,
      writeOptions: options
    };
  }
  if (options && typeof options === "object") {
    const { flag = "w", mode = 438, ...writeOptions } = options;
    return {
      flag,
      mode,
      writeOptions: Object.keys(writeOptions).length > 0 ? writeOptions : void 0
    };
  }
  return {
    flag: "w",
    mode: 438,
    writeOptions: void 0
  };
}
function writeFileAtomicSync(filePath, contents, options = {}) {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp.${process3.pid}.${Date.now()}.${crypto.randomUUID()}`;
  const { flag, mode, writeOptions } = normalizeWriteOptions(options);
  const fd = fs2.openSync(tmpPath, flag, mode);
  try {
    fs2.writeFileSync(fd, contents, writeOptions);
    fs2.fsyncSync(fd);
  } finally {
    fs2.closeSync(fd);
  }
  fs2.renameSync(tmpPath, filePath);
  const dirFd = fs2.openSync(path2.dirname(filePath), "r");
  try {
    fs2.fsyncSync(dirFd);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) {
      throw error;
    }
  } finally {
    fs2.closeSync(dirFd);
  }
}
function writeFileAtomic(filePath, contents, options = {}) {
  writeFileAtomicSync(filePath, contents, options);
  return filePath;
}
function writeJsonAtomic(filePath, value, { spaces = 2, finalNewline = true } = {}) {
  const text = JSON.stringify(value, null, spaces) + (finalNewline ? "\n" : "");
  return writeFileAtomic(filePath, text, "utf8");
}
function withLockfile(lockPath, fn, { timeoutMs = 1e4, staleMs = 6e5, pollMs = 25 } = {}) {
  ensureParentDir(lockPath);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fd = fs2.openSync(
        lockPath,
        fs2.constants.O_CREAT | fs2.constants.O_EXCL | fs2.constants.O_WRONLY,
        384
      );
      try {
        fs2.writeFileSync(fd, JSON.stringify({ pid: process3.pid, acquiredAt: Date.now() }), "utf8");
        fs2.fsyncSync(fd);
      } finally {
        fs2.closeSync(fd);
      }
      try {
        return fn();
      } finally {
        try {
          fs2.unlinkSync(lockPath);
        } catch {
        }
      }
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      try {
        const lock = JSON.parse(fs2.readFileSync(lockPath, "utf8"));
        const pid = Number.isInteger(lock?.pid) && lock.pid > 0 ? lock.pid : null;
        const acquiredAt = Number.isFinite(lock?.acquiredAt) ? lock.acquiredAt : null;
        const lockAgeMs = acquiredAt == null ? null : Date.now() - acquiredAt;
        let ownerAlive = false;
        if (pid != null) {
          try {
            process3.kill(pid, 0);
            ownerAlive = true;
          } catch (killError) {
            if (killError.code === "ESRCH") {
              fs2.unlinkSync(lockPath);
              continue;
            }
            if (killError.code !== "EPERM") {
              throw killError;
            }
            ownerAlive = true;
          }
        }
        if (ownerAlive && lockAgeMs != null && lockAgeMs > staleMs) {
          fs2.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      sleepSync(pollMs);
    }
  }
  throw new LockfileTimeoutError(lockPath, timeoutMs);
}

// plugins/polycli/scripts/lib/state.mjs
var STATE_VERSION = 1;
var STATE_FILE_NAME = "state.json";
var JOBS_DIR_NAME = "jobs";
var MAX_JOBS = 100;
var PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
var FALLBACK_STATE_ROOT = path3.join(os2.tmpdir(), "polycli-companion");
function computeWorkspaceSlug(workspaceRoot) {
  const base = path3.basename(workspaceRoot).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "workspace";
  const hash = crypto2.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
  return `${base}-${hash}`;
}
function defaultState() {
  return {
    version: STATE_VERSION,
    jobs: []
  };
}
function buildCorruptBackupPath(stateFile) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  return `${stateFile}.corrupt-${timestamp}`;
}
function backupCorruptStateFile(stateFile) {
  try {
    fs3.renameSync(stateFile, buildCorruptBackupPath(stateFile));
  } catch {
  }
}
function stateRootDir() {
  const pluginData = process.env[PLUGIN_DATA_ENV];
  if (pluginData) {
    return path3.join(pluginData, "state");
  }
  return FALLBACK_STATE_ROOT;
}
function resolveWorkspaceRoot(cwd = process.cwd()) {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.status === 0 && result.stdout.trim()) {
    return path3.resolve(result.stdout.trim());
  }
  return path3.resolve(cwd);
}
function resolveStateDir(workspaceRoot) {
  return path3.join(stateRootDir(), computeWorkspaceSlug(workspaceRoot));
}
function resolveStateFile(workspaceRoot) {
  return path3.join(resolveStateDir(workspaceRoot), STATE_FILE_NAME);
}
function resolveJobsDir(workspaceRoot) {
  return path3.join(resolveStateDir(workspaceRoot), JOBS_DIR_NAME);
}
function resolveJobFile(workspaceRoot, jobId) {
  return path3.join(resolveJobsDir(workspaceRoot), `${jobId}.json`);
}
function resolveJobLogFile(workspaceRoot, jobId) {
  return path3.join(resolveJobsDir(workspaceRoot), `${jobId}.log`);
}
function resolveJobConfigFile(workspaceRoot, jobId) {
  return path3.join(resolveJobsDir(workspaceRoot), `${jobId}.config.json`);
}
function ensureStateDir(workspaceRoot) {
  fs3.mkdirSync(resolveJobsDir(workspaceRoot), { recursive: true });
}
function loadState(workspaceRoot) {
  const stateFile = resolveStateFile(workspaceRoot);
  let raw;
  try {
    raw = fs3.readFileSync(stateFile, "utf8");
  } catch {
    return defaultState();
  }
  if (!raw.trim()) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.jobs)) {
      backupCorruptStateFile(stateFile);
      return defaultState();
    }
    return {
      version: parsed.version ?? STATE_VERSION,
      jobs: parsed.jobs
    };
  } catch {
    backupCorruptStateFile(stateFile);
    return defaultState();
  }
}
function saveState(workspaceRoot, state) {
  ensureStateDir(workspaceRoot);
  const jobs = state.jobs.slice().sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || "")).slice(0, MAX_JOBS);
  writeJsonAtomic(resolveStateFile(workspaceRoot), { version: STATE_VERSION, jobs });
  return { version: STATE_VERSION, jobs };
}
function updateState(workspaceRoot, mutate) {
  ensureStateDir(workspaceRoot);
  const lockPath = `${resolveStateFile(workspaceRoot)}.lock`;
  return withLockfile(lockPath, () => {
    const state = loadState(workspaceRoot);
    mutate(state);
    return saveState(workspaceRoot, state);
  });
}
function updateJobAtomically(workspaceRoot, jobId, buildNext) {
  ensureStateDir(workspaceRoot);
  const lockPath = `${resolveStateFile(workspaceRoot)}.lock`;
  return withLockfile(lockPath, () => {
    const state = loadState(workspaceRoot);
    const index = state.jobs.findIndex((job2) => job2.jobId === jobId);
    const current = index >= 0 ? state.jobs[index] : null;
    const next = buildNext(current);
    if (!next) {
      return { written: false, job: current, envelope: null };
    }
    const job = next.job ?? current;
    if (!job) {
      return { written: false, job: null, envelope: next.envelope ?? null };
    }
    if (Object.prototype.hasOwnProperty.call(next, "envelope")) {
      writeJsonAtomic(resolveJobFile(workspaceRoot, jobId), next.envelope);
    }
    if (index >= 0) {
      state.jobs[index] = job;
    } else {
      state.jobs.push(job);
    }
    saveState(workspaceRoot, state);
    return { written: true, job, envelope: next.envelope ?? null };
  });
}
function upsertJob(workspaceRoot, jobPatch) {
  let savedJob = null;
  updateState(workspaceRoot, (state) => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const createdAt = jobPatch.createdAt || now;
    const updatedAt = jobPatch.updatedAt || now;
    const index = state.jobs.findIndex((job) => job.jobId === jobPatch.jobId);
    if (index >= 0) {
      state.jobs[index] = {
        ...state.jobs[index],
        ...jobPatch,
        updatedAt
      };
      savedJob = state.jobs[index];
      return;
    }
    savedJob = {
      ...jobPatch,
      createdAt,
      updatedAt
    };
    state.jobs.push(savedJob);
  });
  return savedJob;
}
function listJobs(workspaceRoot) {
  return loadState(workspaceRoot).jobs.slice();
}
function getJob(workspaceRoot, reference) {
  return listJobs(workspaceRoot).find((job) => job.jobId === reference) || null;
}
function writeJobFile(workspaceRoot, jobId, payload) {
  ensureStateDir(workspaceRoot);
  writeJsonAtomic(resolveJobFile(workspaceRoot, jobId), payload);
  return resolveJobFile(workspaceRoot, jobId);
}
function readJobFile(jobFile) {
  try {
    return JSON.parse(fs3.readFileSync(jobFile, "utf8"));
  } catch {
    return null;
  }
}
function writeJobConfigFile(workspaceRoot, jobId, payload) {
  ensureStateDir(workspaceRoot);
  writeJsonAtomic(resolveJobConfigFile(workspaceRoot, jobId), payload);
  return resolveJobConfigFile(workspaceRoot, jobId);
}
function readJobConfigFile(configFile) {
  try {
    return JSON.parse(fs3.readFileSync(configFile, "utf8"));
  } catch {
    return null;
  }
}
function removeJobConfigFile(workspaceRoot, jobId) {
  try {
    fs3.unlinkSync(resolveJobConfigFile(workspaceRoot, jobId));
  } catch {
  }
}

// plugins/polycli/scripts/lib/job-control.mjs
var ACTIVE_STATUSES = /* @__PURE__ */ new Set(["queued", "running"]);
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["completed", "failed", "cancelled"]);
var DEFAULT_STATUS_LIMIT = 8;
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process4.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function sortJobsNewestFirst(jobs) {
  return jobs.slice().sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}
function readProgressPreview(logFile, maxLines = 4) {
  if (!logFile) return "";
  try {
    const lines = fs4.readFileSync(logFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
function enrichJob(workspaceRoot, job) {
  const envelope = readJobFile(resolveJobFile(workspaceRoot, job.jobId));
  return {
    ...job,
    progressPreview: readProgressPreview(job.logFile),
    result: envelope?.result ?? null
  };
}
function refreshJob(workspaceRoot, job) {
  if (!job || !ACTIVE_STATUSES.has(job.status)) {
    return job ? enrichJob(workspaceRoot, job) : null;
  }
  if (!job.pid || isProcessAlive(job.pid)) {
    return enrichJob(workspaceRoot, job);
  }
  const envelope = readJobFile(resolveJobFile(workspaceRoot, job.jobId));
  if (envelope?.job) {
    const finalized = {
      ...job,
      ...envelope.job,
      pid: null
    };
    upsertJob(workspaceRoot, finalized);
    return enrichJob(workspaceRoot, finalized);
  }
  const failed = {
    ...job,
    status: "failed",
    pid: null,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    error: "worker exited before writing a result envelope"
  };
  upsertJob(workspaceRoot, failed);
  writeJobFile(workspaceRoot, job.jobId, {
    job: failed,
    result: { ok: false, error: failed.error }
  });
  return enrichJob(workspaceRoot, failed);
}
function buildStatusSnapshot(workspaceRoot, { showAll = false } = {}) {
  const refreshed = sortJobsNewestFirst(listJobs(workspaceRoot)).map((job) => refreshJob(workspaceRoot, job));
  const limited = showAll ? refreshed : refreshed.slice(0, DEFAULT_STATUS_LIMIT);
  return {
    totalJobs: refreshed.length,
    running: limited.filter((job) => ACTIVE_STATUSES.has(job.status)),
    recent: limited.filter((job) => TERMINAL_STATUSES.has(job.status))
  };
}
function resolveJobReference(workspaceRoot, reference, predicate = () => true) {
  const candidates = sortJobsNewestFirst(listJobs(workspaceRoot)).filter(predicate);
  if (!reference) return candidates[0] || null;
  const exact = candidates.find((job) => job.jobId === reference);
  if (exact) return exact;
  const prefixMatches = candidates.filter((job) => job.jobId.startsWith(reference));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  return null;
}
function resolveLatestActiveJob(workspaceRoot) {
  return resolveJobReference(workspaceRoot, null, (job) => ACTIVE_STATUSES.has(job.status));
}
function resolveLatestTerminalJob(workspaceRoot) {
  return resolveJobReference(workspaceRoot, null, (job) => TERMINAL_STATUSES.has(job.status));
}
async function waitForJob(workspaceRoot, jobId, { timeoutMs = 24e4, pollIntervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = getJob(workspaceRoot, jobId);
    if (!current) {
      return { error: "job_not_found", job: null, waitTimedOut: false };
    }
    const refreshed = refreshJob(workspaceRoot, current);
    if (!ACTIVE_STATUSES.has(refreshed.status)) {
      return { job: refreshed, waitTimedOut: false };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  const timed = getJob(workspaceRoot, jobId);
  return { job: timed ? refreshJob(workspaceRoot, timed) : null, waitTimedOut: true };
}
async function cancelJob(workspaceRoot, jobId) {
  const job = getJob(workspaceRoot, jobId);
  if (!job) {
    return { cancelled: false, reason: "not_found", jobId };
  }
  if (!ACTIVE_STATUSES.has(job.status)) {
    return { cancelled: false, reason: "not_cancellable", jobId };
  }
  try {
    if (job.pid) {
      await terminateProcessTree(job.pid, {
        signal: "SIGINT",
        forceSignal: "SIGKILL",
        forceAfterMs: 2e3
      });
    }
  } catch (error) {
    return {
      cancelled: false,
      reason: "cancel_failed",
      jobId,
      error: error.message
    };
  }
  const cancelledJob = {
    ...job,
    status: "cancelled",
    pid: null,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  let reason = null;
  const write = updateJobAtomically(workspaceRoot, jobId, (current) => {
    if (!current) {
      reason = "not_found";
      return null;
    }
    if (!ACTIVE_STATUSES.has(current.status)) {
      reason = "not_cancellable";
      return null;
    }
    const nextJob = {
      ...current,
      status: "cancelled",
      pid: null,
      finishedAt: cancelledJob.finishedAt
    };
    return {
      job: nextJob,
      envelope: {
        job: nextJob,
        result: {
          ok: false,
          error: "cancelled"
        }
      }
    };
  });
  if (!write.written) {
    return { cancelled: false, reason: reason || "not_cancellable", jobId };
  }
  return { cancelled: true, jobId };
}

// plugins/polycli/scripts/lib/providers.mjs
function resolveProvider({ provider, positionals = [] } = {}) {
  const explicit = provider?.trim();
  if (explicit) {
    if (!PROVIDER_IDS.includes(explicit)) {
      throw new Error(`Unknown provider '${explicit}'. Expected one of: ${PROVIDER_IDS.join(", ")}`);
    }
    return { provider: explicit, remainingPositionals: positionals };
  }
  const [first, ...rest] = positionals;
  if (PROVIDER_IDS.includes(first)) {
    return { provider: first, remainingPositionals: rest };
  }
  throw new Error(`Missing provider. Pass --provider <${PROVIDER_IDS.join("|")}> or use one as the first argument.`);
}

// plugins/polycli/scripts/lib/review.mjs
import fs5 from "node:fs";
import os3 from "node:os";
import path4 from "node:path";
import { randomUUID } from "node:crypto";
var DEFAULT_MAX_DIFF_BYTES = 2e5;
var REVIEW_SCOPES = /* @__PURE__ */ new Set(["auto", "staged", "unstaged", "working-tree", "branch"]);
var REVIEW_APPEND_SYSTEM = "Always emit a visible final markdown answer in assistant text. Never finish with reasoning blocks only. If there are no actionable issues, output exactly: No issues found.";
var REVIEW_CONSTRAINT_ERROR = "non-overridable review hard constraints";
var COPILOT_REVIEW_EXCLUDED_TOOLS = [
  "bash",
  "read_bash",
  "write_bash",
  "stop_bash",
  "list_bash",
  "powershell",
  "read_powershell",
  "write_powershell",
  "stop_powershell",
  "list_powershell",
  "view",
  "create",
  "edit",
  "apply_patch",
  "task",
  "read_agent",
  "list_agents",
  "grep",
  "glob",
  "web_fetch",
  "skill",
  "ask_user"
].join(",");
function normalizeReviewScope(scope) {
  const effective = scope || "auto";
  if (!REVIEW_SCOPES.has(effective)) {
    throw new Error(`Invalid --scope value '${effective}'. Expected one of: ${[...REVIEW_SCOPES].join(", ")}`);
  }
  return effective;
}
function git(cwd, args) {
  return runCommand("git", args, { cwd });
}
function writeReviewTempFile(prefix, extension, text) {
  const root = fs5.mkdtempSync(path4.join(os3.tmpdir(), `polycli-review-${prefix}-`));
  const filePath = path4.join(root, `${prefix}-${randomUUID()}${extension}`);
  fs5.writeFileSync(filePath, text, "utf8");
  return filePath;
}
function readYamlScalar(text, key) {
  const match = String(text ?? "").match(new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^#\\n]+))`, "m"));
  return match ? match[1] ?? match[2] ?? match[3]?.trim() ?? null : null;
}
function assertNoReviewConstraintOverride(provider, runtimeOptions = {}) {
  const extraArgs = Array.isArray(runtimeOptions.extraArgs) ? runtimeOptions.extraArgs : [];
  if (extraArgs.length > 0) {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
  if (provider === "gemini" && runtimeOptions.approvalMode && runtimeOptions.approvalMode !== "plan") {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
  if (provider === "opencode" && runtimeOptions.skipPermissions !== void 0 && runtimeOptions.skipPermissions !== false) {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
  if (provider === "qwen" && runtimeOptions.maxSteps !== void 0 && runtimeOptions.maxSteps !== 1) {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
}
function buildGeminiReviewPolicy() {
  return writeReviewTempFile("gemini-policy", ".toml", [
    "[[rule]]",
    'toolName = "*"',
    'decision = "deny"',
    "priority = 999",
    "interactive = false",
    ""
  ].join("\n"));
}
function buildMiniMaxReviewEnv(parentEnv = process.env) {
  const baseConfigPath = parentEnv.MINI_AGENT_CONFIG_PATH || path4.join(os3.homedir(), ".mini-agent", "config", "config.yaml");
  let baseConfigText = "";
  try {
    baseConfigText = fs5.readFileSync(baseConfigPath, "utf8");
  } catch {
  }
  const lines = [];
  for (const key of ["api_key", "api_base", "model", "provider"]) {
    const value = readYamlScalar(baseConfigText, key);
    if (value != null && value !== "") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push(
    "tools:",
    "  enable_file_tools: false",
    "  enable_bash: false",
    "  enable_note: false",
    "  enable_skills: false",
    "  enable_mcp: false",
    ""
  );
  return {
    ...parentEnv,
    MINI_AGENT_CONFIG_PATH: writeReviewTempFile("minimax-config", ".yaml", lines.join("\n"))
  };
}
var REVIEW_HARD_CONSTRAINTS = {
  kimi() {
    return { extraArgs: ["--no-thinking", "--max-steps-per-turn", "1"] };
  },
  qwen() {
    return {
      maxSteps: 1,
      appendSystem: REVIEW_APPEND_SYSTEM
    };
  },
  claude() {
    return { extraArgs: ["--max-turns", "1", "--tools", ""] };
  },
  gemini() {
    return {
      approvalMode: "plan",
      extraArgs: ["--policy", buildGeminiReviewPolicy()]
    };
  },
  copilot() {
    return {
      extraArgs: ["--excluded-tools", COPILOT_REVIEW_EXCLUDED_TOOLS]
    };
  },
  opencode({ env } = {}) {
    return {
      skipPermissions: false,
      extraArgs: ["--agent", "plan"],
      env: {
        ...env || process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          permission: "deny"
        })
      }
    };
  },
  pi() {
    return { extraArgs: ["--no-tools"] };
  },
  minimax({ env } = {}) {
    return { env: buildMiniMaxReviewEnv(env) };
  }
};
function buildReviewRuntimeOptions({
  provider,
  cwd,
  runtimeOptions = {},
  env = process.env
} = {}) {
  const constraintBuilder = REVIEW_HARD_CONSTRAINTS[provider];
  if (!constraintBuilder) {
    return runtimeOptions;
  }
  assertNoReviewConstraintOverride(provider, runtimeOptions);
  const constrained = constraintBuilder({ cwd, env });
  const merged = { ...runtimeOptions, ...constrained };
  if (runtimeOptions.env || constrained.env) {
    merged.env = { ...runtimeOptions.env || {}, ...constrained.env || {} };
  }
  if (runtimeOptions.extraArgs || constrained.extraArgs) {
    merged.extraArgs = [...runtimeOptions.extraArgs || [], ...constrained.extraArgs || []];
  }
  return merged;
}
function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.status === 0 && result.stdout.trim() === "true";
}
function detectDefaultBaseRef(cwd) {
  for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
    const result = git(cwd, ["rev-parse", "--verify", candidate]);
    if (result.status === 0) return candidate;
  }
  return "HEAD~1";
}
function readDiff(cwd, args) {
  const result = git(cwd, args);
  return {
    ok: result.status === 0,
    diff: result.stdout,
    error: result.stderr.trim() || `git ${args.join(" ")} failed`
  };
}
function diffForScope(cwd, scope, baseRef) {
  if (scope === "staged") {
    return readDiff(cwd, ["diff", "--cached", "--no-ext-diff", "--unified=3"]);
  }
  if (scope === "unstaged") {
    return readDiff(cwd, ["diff", "--no-ext-diff", "--unified=3"]);
  }
  if (scope === "working-tree") {
    return readDiff(cwd, ["diff", "HEAD", "--no-ext-diff", "--unified=3"]);
  }
  if (scope === "branch") {
    const base = baseRef || detectDefaultBaseRef(cwd);
    const result = readDiff(cwd, ["diff", `${base}...HEAD`, "--no-ext-diff", "--unified=3"]);
    return { ...result, baseRef: base };
  }
  throw new Error(`Unsupported scope '${scope}'`);
}
function collectReviewContext({ cwd, scope = "auto", baseRef = null, maxDiffBytes = DEFAULT_MAX_DIFF_BYTES } = {}) {
  const effectiveScope = normalizeReviewScope(scope);
  if (!ensureGitRepository(cwd)) {
    return { ok: false, error: "Not inside a git repository." };
  }
  let selected = null;
  if (effectiveScope === "auto") {
    const attempts = [];
    const staged = diffForScope(cwd, "staged", null);
    attempts.push({ scope: "staged", ...staged });
    if (staged.ok && staged.diff.trim()) selected = { ...staged, scope: "staged" };
    if (!selected) {
      const unstaged = diffForScope(cwd, "unstaged", null);
      attempts.push({ scope: "unstaged", ...unstaged });
      if (unstaged.ok && unstaged.diff.trim()) selected = { ...unstaged, scope: "unstaged" };
    }
    if (!selected) {
      const branch = diffForScope(cwd, "branch", baseRef);
      attempts.push({ scope: "branch", ...branch });
      if (branch.ok && branch.diff.trim()) selected = { ...branch, scope: "branch" };
    }
    if (!selected) {
      const warnings = attempts.filter((attempt) => !attempt.ok).map((attempt) => `${attempt.scope} diff failed: ${attempt.error}`);
      const branchAttempt = attempts.find((attempt) => attempt.scope === "branch");
      selected = {
        ok: true,
        diff: "",
        scope: "auto",
        baseRef: branchAttempt?.baseRef || baseRef || detectDefaultBaseRef(cwd),
        warnings: warnings.length > 0 ? warnings : void 0
      };
    }
  } else {
    selected = { ...diffForScope(cwd, effectiveScope, baseRef), scope: effectiveScope };
  }
  if (!selected.ok) {
    return { ok: false, error: selected.error };
  }
  const diffText = selected.diff || "";
  const truncated = Buffer.byteLength(diffText, "utf8") > maxDiffBytes;
  const truncatedDiff = truncated ? Buffer.from(diffText, "utf8").subarray(0, maxDiffBytes).toString("utf8") : diffText;
  return {
    ok: true,
    scope: selected.scope,
    baseRef: selected.baseRef || baseRef,
    diff: truncatedDiff,
    warnings: selected.warnings,
    truncated,
    truncationNotice: truncated ? `Diff truncated to ${maxDiffBytes} bytes before sending to provider.` : null
  };
}
function buildReviewPrompt({
  provider,
  diff,
  focus = "",
  adversarial = false,
  truncated = false,
  truncationNotice = null
} = {}) {
  const modeText = adversarial ? "Run an adversarial code review. Challenge the implementation approach, assumptions, hidden failure modes, and architectural tradeoffs." : "Run a code review. Focus on concrete bugs, regressions, risky behavior changes, and missing tests.";
  const focusText = focus ? `Extra focus from user: ${focus}` : "No extra focus from user.";
  const truncationText = truncated ? `Important: ${truncationNotice || "The diff was truncated before review."}` : "The diff was not truncated.";
  return [
    `You are acting as ${provider} inside polycli.`,
    modeText,
    "Return markdown only.",
    "Review only the provided git diff and context in this prompt.",
    "Do not run tools, commands, or tests.",
    "Do not inspect the repository beyond the provided diff.",
    "Your output must contain a visible final answer in assistant text, not only reasoning blocks.",
    "Start with a short verdict line.",
    "Then list findings ordered by severity, with file/line references when possible.",
    "If you find no actionable issues, say exactly: No issues found.",
    "Do not suggest that you are about to apply fixes.",
    focusText,
    truncationText,
    "",
    "Git diff:",
    diff || "(empty diff)"
  ].join("\n");
}

// plugins/polycli/scripts/lib/timing.mjs
import path5 from "node:path";

// packages/polycli-utils/src/ndjson.js
import fs6 from "node:fs";
function safeParseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
function readNdjson(filePath) {
  let text;
  try {
    text = fs6.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = safeParseLine(trimmed);
    if (parsed != null) {
      records.push(parsed);
    }
  }
  return records;
}
function appendNdjson(filePath, record, { timeoutMs = 1e4, staleMs = 3e4, pollMs = 25, maxBytes = null, keepRatio = 0.5 } = {}) {
  const lockPath = `${filePath}.lock`;
  return withLockfile(lockPath, () => {
    ensureParentDir(filePath);
    let needsLeadingNewline = false;
    try {
      const stat = fs6.statSync(filePath);
      if (stat.size > 0) {
        const fd = fs6.openSync(filePath, "r");
        const lastByte = Buffer.alloc(1);
        try {
          fs6.readSync(fd, lastByte, 0, 1, stat.size - 1);
        } finally {
          fs6.closeSync(fd);
        }
        needsLeadingNewline = lastByte[0] !== 10;
      }
    } catch {
    }
    const line = `${needsLeadingNewline ? "\n" : ""}${JSON.stringify(record)}
`;
    fs6.appendFileSync(filePath, line, "utf8");
    if (maxBytes != null) {
      const stat = fs6.statSync(filePath);
      if (stat.size > maxBytes) {
        const lines = fs6.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
        const valid = lines.filter((entry) => safeParseLine(entry) != null);
        const keepFrom = Math.floor(valid.length * (1 - keepRatio));
        const kept = valid.slice(keepFrom);
        writeFileAtomic(filePath, `${kept.join("\n")}
`, "utf8");
      }
    }
    return true;
  }, { timeoutMs, staleMs, pollMs });
}

// plugins/polycli/scripts/lib/timing.mjs
var TIMING_FILE_NAME = "timings.ndjson";
var MAX_TIMING_BYTES = 2e6;
function resolveTimingHistoryFile(workspaceRoot) {
  return path5.join(resolveStateDir(workspaceRoot), TIMING_FILE_NAME);
}
function appendTimingRecord(workspaceRoot, record) {
  const validation = validateTimingRecord(record);
  if (!validation.ok) {
    throw new Error(`Invalid timing record: ${validation.errors.join("; ")}`);
  }
  ensureStateDir(workspaceRoot);
  appendNdjson(resolveTimingHistoryFile(workspaceRoot), record, {
    maxBytes: MAX_TIMING_BYTES,
    keepRatio: 0.5
  });
  return true;
}
function listTimingRecords(workspaceRoot, { provider = null, limit = null } = {}) {
  const all = readNdjson(resolveTimingHistoryFile(workspaceRoot)).filter((record) => validateTimingRecord(record).ok).filter((record) => !provider || record.provider === provider).sort((left, right) => String(right.completedAt || "").localeCompare(String(left.completedAt || "")));
  if (limit == null) {
    return all;
  }
  return all.slice(0, limit);
}
function summarizeTimingRecords(records) {
  return aggregateTimingRecords(records);
}

// plugins/polycli/scripts/lib/preview.mjs
import fs7 from "node:fs";
var PREVIEW_MAX_LINES = 10;
var PREVIEW_TAIL_CACHE = /* @__PURE__ */ new Map();
function collapseWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
function previewText(text, maxLength = 120) {
  const collapsed = collapseWhitespace(text);
  const points = Array.from(collapsed);
  if (points.length <= maxLength) {
    return collapsed;
  }
  return `${points.slice(0, maxLength - 1).join("")}\u2026`;
}
function summarizeEventText(provider, event) {
  if (!event || typeof event !== "object") return "";
  if (provider === "claude") {
    if (event.type === "result" && event.is_error !== true && event.subtype !== "error" && typeof event.result === "string") {
      return event.result;
    }
    if (typeof event.text === "string") return event.text;
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
      return event.delta.text;
    }
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
  }
  if (provider === "copilot") {
    if ((event.type === "result" || event.type === "final") && typeof event.result === "string") return event.result;
    if (event.type === "assistant.message_delta" && typeof event.data?.deltaContent === "string") return event.data.deltaContent;
    if (event.type === "assistant.message" && typeof event.data?.content === "string") return event.data.content;
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.text === "string") return event.text;
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
  }
  if (provider === "gemini") {
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.content === "string") return event.content;
    if (typeof event.text === "string") return event.text;
    if (typeof event.message?.content === "string") return event.message.content;
    return "";
  }
  if (provider === "kimi") {
    if (event.role !== "assistant") return "";
    if (typeof event.content === "string") return event.content;
    if (!Array.isArray(event.content)) return "";
    return event.content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
  }
  if (provider === "qwen") {
    if (event.type === "result" && event.is_error !== true && event.subtype !== "error" && typeof event.result === "string") {
      return event.result;
    }
    if (event.type !== "assistant" || !Array.isArray(event.message?.content)) return "";
    return event.message.content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
  }
  if (provider === "minimax") {
    if (event.type === "progress" && typeof event.text === "string") return event.text;
    if (event.type === "result" && typeof event.response === "string") return event.response;
  }
  if (provider === "opencode") {
    if (event.type === "result" && typeof event.text === "string") return event.text;
    if (event.type === "text" && typeof event.part?.text === "string") return event.part.text;
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.text === "string") return event.text;
    if (typeof event.part?.text === "string") return event.part.text;
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
  }
  if (provider === "pi") {
    if (event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
      return event.assistantMessageEvent.delta;
    }
    if (event.type === "agent_end" && typeof event.result?.text === "string") return event.result.text;
    if (typeof event.text === "string") return event.text;
  }
  return "";
}
function appendPreview(logFile, provider, event, { fsImpl = fs7, tailCache = PREVIEW_TAIL_CACHE } = {}) {
  const text = summarizeEventText(provider, event);
  if (!text) return;
  const lines = String(text).split(/\r?\n/).map((line) => collapseWhitespace(line)).filter(Boolean).slice(0, PREVIEW_MAX_LINES);
  if (lines.length === 0) return;
  const currentTail = tailCache.get(logFile) || [];
  if (currentTail.slice(-lines.length).join("\n") === lines.join("\n")) {
    return;
  }
  fsImpl.appendFileSync(logFile, `${lines.join("\n")}
`, "utf8");
  tailCache.set(logFile, [...currentTail, ...lines].slice(-PREVIEW_MAX_LINES));
}

// plugins/polycli/scripts/polycli-companion.mjs
var COMPANION_PATH = fileURLToPath(import.meta.url);
var JOB_PREFIXES = {
  ask: "pa",
  rescue: "pr",
  review: "pv",
  "adversarial-review": "pv"
};
var TIMEOUTS_MS = {
  ask: 12e4,
  rescue: 6e5,
  review: 18e4,
  "adversarial-review": 18e4
};
function printUsage() {
  console.log(
    [
      "Usage:",
      "  polycli-companion.mjs setup [--provider <provider>] [--json]",
      "  polycli-companion.mjs ask --provider <provider> [--model <model>] [--background] [--json] <prompt>",
      "  polycli-companion.mjs rescue --provider <provider> [--model <model>] [--background] [--json] <prompt>",
      "  polycli-companion.mjs review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]",
      "  polycli-companion.mjs adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]",
      "  polycli-companion.mjs status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]",
      "  polycli-companion.mjs result [job-id] [--json]",
      "  polycli-companion.mjs cancel [job-id] [--json]",
      "  polycli-companion.mjs timing [--provider <provider>] [--history <count>] [--json]"
    ].join("\n")
  );
}
function output(value, asJson) {
  if (asJson) {
    process5.stdout.write(`${JSON.stringify(value, null, 2)}
`);
    return;
  }
  process5.stdout.write(typeof value === "string" ? `${value}
` : `${JSON.stringify(value, null, 2)}
`);
}
function createJobId(kind) {
  const prefix = JOB_PREFIXES[kind] || "pj";
  return `${prefix}-${randomUUID2().slice(0, 8)}`;
}
function parseExecutionMode(options) {
  if (options.background && options.wait) {
    throw new Error("Choose either --background or --wait, not both.");
  }
  return {
    background: Boolean(options.background)
  };
}
function buildExecutionEnvelope(execution, result) {
  return {
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || null,
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    meta: execution.meta || {},
    ...result
  };
}
async function runForegroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  const result = await runProviderPromptStreaming({
    provider: execution.provider,
    prompt: execution.prompt,
    model: execution.model || null,
    cwd: execution.cwd,
    timeout: execution.timeout,
    kind: execution.kind,
    measurementScope: execution.measurementScope || "request",
    meta: execution.meta || null,
    ...execution.runtimeOptions || {},
    onEvent() {
    }
  });
  if (result.timing) {
    appendTimingRecord(workspaceRoot, result.timing);
  }
  const envelope = buildExecutionEnvelope(execution, result);
  if (asJson) {
    output(envelope, true);
    return;
  }
  if (!result.ok) {
    throw new Error(result.error || `${execution.provider} ${execution.kind} failed`);
  }
  const lines = [];
  if (execution.meta?.truncationNotice) {
    lines.push(execution.meta.truncationNotice);
  }
  lines.push(result.response);
  output(lines.join("\n\n"), false);
}
function buildQueuedJob(execution, workspaceRoot) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const jobId = createJobId(execution.kind);
  return {
    jobId,
    workspaceRoot,
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || null,
    status: "queued",
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    logFile: resolveJobLogFile(workspaceRoot, jobId),
    createdAt: now,
    updatedAt: now,
    ...execution.jobMeta
  };
}
function renderStartedJob(job) {
  return [
    `Started ${job.provider} ${job.kind} job ${job.jobId}.`,
    `Use /polycli:status ${job.jobId} to monitor it.`,
    `Use /polycli:result ${job.jobId} to fetch the stored output.`
  ].join("\n");
}
function renderJobDetail(job) {
  const lines = [
    `Job: ${job.jobId}`,
    `Provider: ${job.provider}`,
    `Kind: ${job.kind}`,
    `Status: ${job.status}`
  ];
  if (job.model) lines.push(`Model: ${job.model}`);
  if (job.promptPreview) lines.push(`Prompt: ${job.promptPreview}`);
  if (job.scope) lines.push(`Scope: ${job.scope}`);
  if (job.baseRef) lines.push(`Base Ref: ${job.baseRef}`);
  if (job.createdAt) lines.push(`Created: ${job.createdAt}`);
  if (job.finishedAt) lines.push(`Finished: ${job.finishedAt}`);
  if (job.sessionId) lines.push(`Session: ${job.sessionId}`);
  if (job.progressPreview) {
    lines.push("");
    lines.push("Progress:");
    lines.push(job.progressPreview);
  }
  return lines.join("\n");
}
function renderStatusSnapshot(snapshot) {
  const rows = [...snapshot.running, ...snapshot.recent];
  if (rows.length === 0) {
    return "No jobs found.";
  }
  const lines = [
    "| jobId | provider | kind | status | prompt |",
    "|---|---|---|---|---|"
  ];
  for (const job of rows) {
    lines.push(`| ${job.jobId} | ${job.provider} | ${job.kind} | ${job.status} | ${job.promptPreview || ""} |`);
    if (job.progressPreview && snapshot.running.some((running) => running.jobId === job.jobId)) {
      lines.push(`|  |  |  | progress | ${previewText(job.progressPreview, 180)} |`);
    }
  }
  return lines.join("\n");
}
function renderResultEnvelope(envelope) {
  const lines = [
    `Job: ${envelope.job.jobId}`,
    `Provider: ${envelope.job.provider}`,
    `Kind: ${envelope.job.kind}`,
    `Status: ${envelope.job.status}`
  ];
  if (envelope.job.finishedAt) lines.push(`Finished: ${envelope.job.finishedAt}`);
  if (envelope.job.sessionId) lines.push(`Session: ${envelope.job.sessionId}`);
  if (envelope.result?.response) {
    lines.push("");
    lines.push("Response:");
    lines.push(envelope.result.response);
  }
  if (!envelope.result?.response && envelope.result?.error) {
    lines.push("");
    lines.push("Error:");
    lines.push(envelope.result.error);
  }
  return lines.join("\n");
}
async function startBackgroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  const job = buildQueuedJob(execution, workspaceRoot);
  upsertJob(workspaceRoot, job);
  writeJobConfigFile(workspaceRoot, job.jobId, {
    workspaceRoot,
    execution: {
      ...execution,
      measurementScope: "job",
      meta: {
        ...execution.meta || {},
        background: true,
        jobId: job.jobId
      }
    },
    jobId: job.jobId
  });
  fs8.writeFileSync(job.logFile, `[${(/* @__PURE__ */ new Date()).toISOString()}] started ${job.provider} ${job.kind}
`, "utf8");
  const logFd = fs8.openSync(job.logFile, "a");
  const child = spawn2(process5.execPath, [COMPANION_PATH, "_job-worker", resolveJobConfigFile(workspaceRoot, job.jobId)], {
    cwd: execution.cwd,
    env: { ...process5.env },
    stdio: ["ignore", logFd, logFd],
    detached: true
  });
  child.unref();
  fs8.closeSync(logFd);
  const runningJob = upsertJob(workspaceRoot, {
    ...job,
    status: "running",
    pid: child.pid ?? null
  });
  if (asJson) {
    output({ ok: true, job: runningJob }, true);
    return;
  }
  output(renderStartedJob(runningJob), false);
}
async function runSetup(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider"]
  });
  let providers;
  if (options.provider) {
    providers = [resolveProvider({ provider: options.provider }).provider];
  } else if (positionals[0]) {
    providers = [resolveProvider({ positionals }).provider];
  } else {
    providers = listProviderRuntimes().map((runtime) => runtime.id);
  }
  const results = [];
  for (const provider of providers) {
    const runtime = getProviderRuntime(provider);
    const availability = await Promise.resolve(runtime.getAvailability(process5.cwd()));
    const auth = await Promise.resolve(runtime.getAuthStatus(process5.cwd()));
    results.push({
      provider,
      available: availability.available ?? false,
      availabilityDetail: availability.detail ?? null,
      loggedIn: auth.loggedIn ?? false,
      authDetail: auth.detail ?? auth.reason ?? null,
      model: auth.model ?? null,
      capabilities: runtime.capabilities
    });
  }
  if (options.json) {
    output(results, true);
    return;
  }
  const lines = [];
  for (const row of results) {
    lines.push(
      [
        `[${row.provider}]`,
        `available=${row.available ? "yes" : "no"}`,
        `loggedIn=${row.loggedIn ? "yes" : "no"}`,
        row.model ? `model=${row.model}` : null,
        row.availabilityDetail ? `version=${row.availabilityDetail}` : null,
        row.authDetail ? `detail=${row.authDetail}` : null
      ].filter(Boolean).join(" ")
    );
  }
  output(lines.join("\n"), false);
}
function parsePromptExecution(rawArgs, kind) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait"],
    valueOptions: ["provider", "model"],
    aliasMap: { m: "model" }
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals
  });
  const userPrompt = remainingPositionals.join(" ").trim();
  if (!userPrompt) {
    throw new Error(`Missing prompt text for ${kind}.`);
  }
  return {
    options,
    execution: {
      provider,
      kind,
      prompt: userPrompt,
      userPrompt,
      model: options.model || null,
      cwd: process5.cwd(),
      timeout: TIMEOUTS_MS[kind],
      meta: {},
      jobMeta: {},
      measurementScope: "request"
    }
  };
}
async function runAsk(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "ask");
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}
async function runRescue(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "rescue");
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}
function buildReviewExecution(rawArgs, { adversarial }) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait"],
    valueOptions: ["provider", "model", "base", "scope"],
    aliasMap: { m: "model" }
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals
  });
  const focus = remainingPositionals.join(" ").trim();
  const reviewContext = collectReviewContext({
    cwd: process5.cwd(),
    scope: options.scope,
    baseRef: options.base || null
  });
  if (!reviewContext.ok) {
    throw new Error(reviewContext.error);
  }
  return {
    options,
    provider,
    reviewContext,
    execution: {
      provider,
      kind: adversarial ? "adversarial-review" : "review",
      prompt: buildReviewPrompt({
        provider,
        diff: reviewContext.diff,
        focus,
        adversarial,
        truncated: reviewContext.truncated,
        truncationNotice: reviewContext.truncationNotice
      }),
      userPrompt: focus || `${adversarial ? "adversarial " : ""}review ${reviewContext.scope}`,
      model: options.model || null,
      cwd: process5.cwd(),
      timeout: TIMEOUTS_MS[adversarial ? "adversarial-review" : "review"],
      meta: {
        scope: reviewContext.scope,
        baseRef: reviewContext.baseRef || null,
        truncated: reviewContext.truncated,
        truncationNotice: reviewContext.truncationNotice,
        adversarial,
        background: false
      },
      jobMeta: {
        scope: reviewContext.scope,
        baseRef: reviewContext.baseRef || null,
        adversarial
      },
      measurementScope: "request",
      runtimeOptions: buildReviewRuntimeOptions({
        provider,
        cwd: process5.cwd()
      })
    }
  };
}
async function runReviewCommand(rawArgs, { adversarial }) {
  const { options, provider, reviewContext, execution } = buildReviewExecution(rawArgs, { adversarial });
  if (!reviewContext.diff.trim()) {
    const warnings = Array.isArray(reviewContext.warnings) && reviewContext.warnings.length > 0 ? reviewContext.warnings : void 0;
    output(
      options.json ? { ok: true, provider, verdict: "no_changes", scope: reviewContext.scope, warnings } : [
        ...warnings ? [`Note: ${warnings.join(" | ")}`] : [],
        "No changes to review."
      ].join("\n\n"),
      options.json
    );
    return;
  }
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}
async function runStatus(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "all", "wait"],
    valueOptions: ["timeout-ms"]
  });
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const reference = positionals[0] || null;
  if (options.wait) {
    const target = reference ? resolveJobReference(workspaceRoot, reference) : resolveLatestActiveJob(workspaceRoot);
    if (!target) {
      throw new Error(reference ? `Job '${reference}' not found.` : "No active job found.");
    }
    const waited = await waitForJob(workspaceRoot, target.jobId, {
      timeoutMs: options["timeout-ms"] ? Number.parseInt(options["timeout-ms"], 10) : void 0
    });
    if (options.json) {
      output(waited, true);
      return;
    }
    if (waited.error) {
      throw new Error(waited.error);
    }
    output(renderJobDetail(waited.job), false);
    return;
  }
  if (reference) {
    const job = resolveJobReference(workspaceRoot, reference);
    if (!job) {
      throw new Error(`Job '${reference}' not found.`);
    }
    const refreshed = refreshJob(workspaceRoot, job);
    if (options.json) {
      output({ job: refreshed }, true);
      return;
    }
    output(renderJobDetail(refreshed), false);
    return;
  }
  const snapshot = buildStatusSnapshot(workspaceRoot, { showAll: Boolean(options.all) });
  if (options.json) {
    output(snapshot, true);
    return;
  }
  output(renderStatusSnapshot(snapshot), false);
}
async function runResult(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"]
  });
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const job = positionals[0] ? resolveJobReference(workspaceRoot, positionals[0]) : resolveLatestTerminalJob(workspaceRoot);
  if (!job) {
    throw new Error(positionals[0] ? `Job '${positionals[0]}' not found.` : "No completed job found.");
  }
  const refreshed = refreshJob(workspaceRoot, job);
  if (refreshed.status === "queued" || refreshed.status === "running") {
    throw new Error(`Job '${refreshed.jobId}' is still ${refreshed.status}. Use status first.`);
  }
  const envelope = readJobFile(resolveJobFile(workspaceRoot, refreshed.jobId)) || { job: refreshed, result: refreshed.result };
  if (options.json) {
    output(envelope, true);
    return;
  }
  output(renderResultEnvelope(envelope), false);
}
async function runCancel(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"]
  });
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const job = positionals[0] ? resolveJobReference(workspaceRoot, positionals[0]) : resolveLatestActiveJob(workspaceRoot);
  if (!job) {
    if (options.json) {
      output({ cancelled: false, reason: "not_found", jobId: positionals[0] || null }, true);
      process5.exitCode = 3;
      return;
    }
    output(positionals[0] ? `Job ${positionals[0]} not found.` : "No active job found to cancel.", false);
    process5.exitCode = 3;
    return;
  }
  const report = await cancelJob(workspaceRoot, job.jobId);
  if (options.json) {
    output(report, true);
  } else if (report.cancelled) {
    output(`Cancelled job ${report.jobId}.`, false);
  } else if (report.reason === "not_cancellable") {
    output(`Job ${report.jobId} is already ${job.status}.`, false);
    process5.exitCode = 4;
  } else {
    output(`Failed to cancel ${report.jobId}: ${report.error || report.reason}`, false);
    process5.exitCode = 5;
  }
}
function formatMetric(metric) {
  if (!metric) return "n/a";
  if (metric.status === "measured" || metric.status === "zero") {
    return `${metric.ms}ms`;
  }
  return metric.status;
}
function renderTimingReport(records, aggregate) {
  if (records.length === 0) {
    return "No timing records found.";
  }
  const lines = [
    "Recent timing records:",
    ...records.map((record) => {
      const suffix = [
        `total=${formatMetric(record.metrics.total)}`,
        `ttft=${formatMetric(record.metrics.ttft)}`,
        `gen=${formatMetric(record.metrics.gen)}`,
        `tool=${formatMetric(record.metrics.tool)}`,
        `tail=${formatMetric(record.metrics.tail)}`
      ].join(" ");
      return `- ${record.completedAt} ${record.provider} ${record.kind || "prompt"} ${record.measurementScope} ${suffix}`;
    }),
    "",
    "Aggregate:"
  ];
  for (const [provider, summary] of Object.entries(aggregate.byProvider)) {
    lines.push(
      `- ${provider}: count=${summary.recordCount} total.p50=${summary.metrics.total.p50} total.p95=${summary.metrics.total.p95}`
    );
  }
  return lines.join("\n");
}
async function runTiming(rawArgs) {
  const { options } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider", "history"]
  });
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const limit = options.history ? Number.parseInt(options.history, 10) : 20;
  const records = listTimingRecords(workspaceRoot, {
    provider: options.provider || null,
    limit: Number.isFinite(limit) ? limit : 20
  });
  const aggregate = summarizeTimingRecords(records);
  if (options.json) {
    output({ records, aggregate }, true);
    return;
  }
  output(renderTimingReport(records, aggregate), false);
}
async function runJobWorker(rawArgs) {
  const configFile = rawArgs[0];
  if (!configFile) {
    throw new Error("Missing config path for _job-worker.");
  }
  const payload = readJobConfigFile(configFile);
  if (!payload) {
    throw new Error(`Unable to read job config ${configFile}`);
  }
  const { workspaceRoot, execution, jobId } = payload;
  const current = getJob(workspaceRoot, jobId);
  if (!current) {
    throw new Error(`Unknown job ${jobId}`);
  }
  try {
    const result = await runProviderPromptStreaming({
      provider: execution.provider,
      prompt: execution.prompt,
      model: execution.model || null,
      cwd: execution.cwd,
      timeout: execution.timeout,
      kind: execution.kind,
      measurementScope: execution.measurementScope || "job",
      meta: execution.meta || null,
      ...execution.runtimeOptions || {},
      onEvent(event) {
        appendPreview(current.logFile, execution.provider, event);
      }
    });
    const write = updateJobAtomically(workspaceRoot, jobId, (latest) => {
      if (!latest || latest.status === "cancelled") {
        return null;
      }
      const finishedJob = {
        ...latest,
        ...execution.jobMeta,
        status: result.ok ? "completed" : "failed",
        pid: null,
        finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
        sessionId: result.sessionId ?? null,
        error: result.error ?? null
      };
      return {
        job: finishedJob,
        envelope: {
          job: finishedJob,
          result
        }
      };
    });
    if (!write.written) {
      removeJobConfigFile(workspaceRoot, jobId);
      return;
    }
    if (result.timing) {
      appendTimingRecord(workspaceRoot, result.timing);
    }
    removeJobConfigFile(workspaceRoot, jobId);
  } catch (error) {
    const write = updateJobAtomically(workspaceRoot, jobId, (latest) => {
      if (!latest || latest.status === "cancelled") {
        return null;
      }
      const failedJob = {
        ...latest,
        ...execution.jobMeta,
        status: "failed",
        pid: null,
        finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
        error: error.message
      };
      return {
        job: failedJob,
        envelope: {
          job: failedJob,
          result: { ok: false, error: error.message }
        }
      };
    });
    if (!write.written) {
      removeJobConfigFile(workspaceRoot, jobId);
      return;
    }
    removeJobConfigFile(workspaceRoot, jobId);
    throw error;
  }
}
async function main() {
  const [command, ...rawArgs] = process5.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (command === "setup") {
    await runSetup(rawArgs);
    return;
  }
  if (command === "ask") {
    await runAsk(rawArgs);
    return;
  }
  if (command === "rescue") {
    await runRescue(rawArgs);
    return;
  }
  if (command === "review") {
    await runReviewCommand(rawArgs, { adversarial: false });
    return;
  }
  if (command === "adversarial-review") {
    await runReviewCommand(rawArgs, { adversarial: true });
    return;
  }
  if (command === "status") {
    await runStatus(rawArgs);
    return;
  }
  if (command === "result") {
    await runResult(rawArgs);
    return;
  }
  if (command === "cancel") {
    await runCancel(rawArgs);
    return;
  }
  if (command === "timing") {
    await runTiming(rawArgs);
    return;
  }
  if (command === "_job-worker") {
    await runJobWorker(rawArgs);
    return;
  }
  throw new Error(`Unknown subcommand '${command}'.`);
}
main().catch((error) => {
  process5.stderr.write(`Error: ${error.message}
`);
  process5.exitCode = process5.exitCode || 1;
});
