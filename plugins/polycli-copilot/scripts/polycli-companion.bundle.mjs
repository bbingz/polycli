#!/usr/bin/env node

// plugins/polycli/scripts/polycli-companion.mjs
import fs9 from "node:fs";
import path8 from "node:path";
import process5 from "node:process";
import { randomUUID as randomUUID3 } from "node:crypto";
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
        if (inlineValue === "") {
          throw new Error(`Invalid boolean value for --${rawKey}`);
        }
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
    const shortToken = token.slice(1);
    const shortKey = shortToken[0];
    const inlineShortValue = shortToken.length > 1 ? shortToken.slice(1) : void 0;
    const key = aliasMap[shortKey] ?? shortKey;
    if (booleanOptions.has(key)) {
      if (inlineShortValue !== void 0) {
        positionals.push(token);
        continue;
      }
      options[key] = true;
      continue;
    }
    if (valueOptions.has(key)) {
      const nextValue = inlineShortValue ?? argv[index + 1];
      if (nextValue === void 0) {
        throw new Error(`Missing value for -${shortKey}`);
      }
      options[key] = nextValue;
      if (inlineShortValue === void 0) {
        index += 1;
      }
      continue;
    }
    positionals.push(token);
  }
  return { options, positionals };
}

// packages/polycli-utils/src/atomic-save.js
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process2 from "node:process";
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
  const tmpPath = `${filePath}.tmp.${process2.pid}.${Date.now()}.${crypto.randomUUID()}`;
  const { flag, mode, writeOptions } = normalizeWriteOptions(options);
  let renamed = false;
  try {
    const fd = fs.openSync(tmpPath, flag, mode);
    try {
      fs.writeFileSync(fd, contents, writeOptions);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);
    renamed = true;
    const dirFd = fs.openSync(path.dirname(filePath), "r");
    try {
      fs.fsyncSync(dirFd);
    } catch (error) {
      if (!["EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) {
        throw error;
      }
    } finally {
      fs.closeSync(dirFd);
    }
  } finally {
    if (!renamed) {
      unlinkIfExists(tmpPath);
    }
  }
}
function writeFileAtomic(filePath, contents, options = {}) {
  writeFileAtomicSync(filePath, contents, options);
  return filePath;
}
function writeJsonAtomic(filePath, value, { spaces = 2, finalNewline = true, mode = 438 } = {}) {
  const text = JSON.stringify(value, null, spaces) + (finalNewline ? "\n" : "");
  return writeFileAtomic(filePath, text, { encoding: "utf8", mode });
}
function unlinkIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
  }
}
function tryReclaimStaleLock(lockPath, staleMs) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch {
    return true;
  }
  let lock = null;
  try {
    lock = JSON.parse(raw);
  } catch {
    lock = null;
  }
  const pid = Number.isInteger(lock?.pid) && lock.pid > 0 ? lock.pid : null;
  const acquiredAt = Number.isFinite(lock?.acquiredAt) ? lock.acquiredAt : null;
  if (pid != null) {
    try {
      process2.kill(pid, 0);
      return false;
    } catch (killError) {
      if (killError.code === "ESRCH") {
        unlinkIfExists(lockPath);
        return true;
      }
      if (killError.code !== "EPERM") {
        throw killError;
      }
    }
    return false;
  }
  let ageMs = acquiredAt == null ? null : Date.now() - acquiredAt;
  if (ageMs == null) {
    try {
      ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch {
      return true;
    }
  }
  if (ageMs != null && ageMs > staleMs) {
    unlinkIfExists(lockPath);
    return true;
  }
  return false;
}
function withLockfile(lockPath, fn, { timeoutMs = 1e4, staleMs = 6e5, pollMs = 25 } = {}) {
  ensureParentDir(lockPath);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        384
      );
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process2.pid, acquiredAt: Date.now() }), "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        return fn();
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch {
        }
      }
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      if (tryReclaimStaleLock(lockPath, staleMs)) {
        continue;
      }
      sleepSync(pollMs);
    }
  }
  throw new LockfileTimeoutError(lockPath, timeoutMs);
}

// packages/polycli-runtime/src/constants.js
var PROVIDER_IDS = ["gemini", "kimi", "qwen", "minimax", "claude", "copilot", "opencode", "pi", "cmd", "agy", "grok"];
var PROVIDER_OPERATION_NAMES = ["prompt"];

// packages/polycli-utils/src/parse-stream-json.js
function findJsonStarts(text) {
  const starts = [];
  for (let index = 0; index < text.length; index += 1) {
    const slice = text.slice(index);
    const character = text[index];
    if (character === "{" || character === "[" || character === '"' || character === "-" || /\d/.test(character)) {
      starts.push(index);
      continue;
    }
    if (slice.startsWith("true") || slice.startsWith("false") || slice.startsWith("null")) {
      starts.push(index);
    }
  }
  return starts;
}
function parseStreamJsonLine(raw, { allowPrefix = true } = {}) {
  const text = String(raw ?? "");
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, kind: "blank", raw: text };
  }
  let jsonCandidate = trimmed;
  let prefix = "";
  if (allowPrefix) {
    let lastParseError = null;
    for (const jsonStart of findJsonStarts(text)) {
      const candidatePrefix = text.slice(0, jsonStart);
      const candidate = text.slice(jsonStart).trim();
      try {
        return {
          ok: true,
          raw: text,
          prefix: candidatePrefix,
          json: candidate,
          event: JSON.parse(candidate)
        };
      } catch (error) {
        lastParseError = { prefix: candidatePrefix, json: candidate, error: error.message };
      }
    }
    if (!lastParseError) {
      return { ok: false, kind: "non_json", raw: text };
    }
    return {
      ok: false,
      kind: "parse_error",
      raw: text,
      ...lastParseError
    };
  } else if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith('"') && !trimmed.startsWith("-") && !/^\d/.test(trimmed) && !trimmed.startsWith("true") && !trimmed.startsWith("false") && !trimmed.startsWith("null")) {
    return { ok: false, kind: "non_json", raw: text };
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
import process3 from "node:process";
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
  const status = result.status ?? (preserveNullStatus ? null : 0);
  let error = result.error ?? null;
  if (!error && result.status == null && result.signal && !preserveNullStatus) {
    error = Object.assign(
      new Error(`process terminated by signal ${result.signal}`),
      { code: result.signal }
    );
  }
  return {
    command,
    args,
    status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error
  };
}
function firstNonEmptyLine(text) {
  for (const line of (text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
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
    const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout) || `exit ${result.status}`;
    return { available: false, detail };
  }
  return {
    available: true,
    detail: firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr) || "ok"
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
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(`Invalid pid: ${pid}`);
  }
  const killOnce = (targetSignal) => {
    if (process3.platform === "win32") {
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
    const killPid = () => {
      try {
        process3.kill(pid, targetSignal);
        return true;
      } catch (error) {
        if (error.code === "ESRCH" && ignoreMissing) return false;
        throw error;
      }
    };
    try {
      process3.kill(-pid, targetSignal);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") {
        return killPid();
      }
      if (error.code === "EINVAL") {
        throw error;
      }
      return killPid();
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

// packages/polycli-runtime/src/claude.js
import { randomUUID } from "node:crypto";

// packages/polycli-runtime/src/errors.js
function formatProviderExitError(provider, status) {
  if (status === 124) {
    return `${provider} timed out`;
  }
  if (status === 130) {
    return `${provider} interrupted`;
  }
  if (status === 143) {
    return `${provider} terminated`;
  }
  return `${provider} exited with code ${status}`;
}
function classifyProviderFailure(error, { provider = null } = {}) {
  const text = typeof error === "string" ? error : String(error?.message ?? error ?? "");
  if (!text.trim()) return null;
  if (provider === "qwen" && /\bmaximum session turn\b|\bmax(?:imum)? session turns?\b/i.test(text)) {
    return "qwen_max_session_turns";
  }
  if (/\bspawn\b.*\bENOENT\b|\bENOENT\b|\bnot found\b/i.test(text)) {
    return "binary_missing";
  }
  if (/\b(timed out|timeout)\b/i.test(text)) {
    return "timeout";
  }
  if (/\b(terminated|SIGTERM|exit(?:ed)? with code 143)\b/i.test(text)) {
    return "terminated";
  }
  if (/\b(interrupted|SIGINT|aborted|cancelled|canceled|exit(?:ed)? with code 130)\b/i.test(text)) {
    return "cancelled";
  }
  if (/\b(no visible text|produced no visible text)\b/i.test(text)) {
    return "no_visible_text";
  }
  if (/\b(auth|authenticated|login|credential)\b/i.test(text)) {
    return "auth";
  }
  return null;
}

// packages/polycli-runtime/src/spawn.js
import { spawn } from "node:child_process";

// packages/polycli-utils/src/stream.js
import { StringDecoder } from "node:string_decoder";
function createLineDecoder({ encoding = "utf8", stripCarriageReturn = true, maxBufferBytes = 1048576 } = {}) {
  const decoder = new StringDecoder(encoding);
  let buffer = "";
  const assertBufferLimit = () => {
    if (maxBufferBytes != null && Buffer.byteLength(buffer, encoding) > maxBufferBytes) {
      throw new Error(`Line buffer exceeded maxBufferBytes (${maxBufferBytes})`);
    }
  };
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
      const lines = drain();
      assertBufferLimit();
      return lines;
    },
    end() {
      buffer += decoder.end();
      const lines = drain();
      assertBufferLimit();
      if (buffer.length > 0) {
        lines.push(normalize(buffer));
        buffer = "";
      }
      return lines;
    }
  };
}

// packages/polycli-runtime/src/spawn.js
function formatExitError(status, signal, { timedOut = false, aborted = false } = {}) {
  if (aborted) {
    return "process aborted";
  }
  if (timedOut || status === 124) {
    return "process timed out";
  }
  if (signal === "SIGINT" || status === 130) {
    return "process interrupted";
  }
  if (signal === "SIGTERM" || status === 143) {
    return "process terminated";
  }
  return `process exited with code ${status}`;
}
function spawnStreamingCommand({
  bin,
  args = [],
  cwd,
  env,
  input,
  timeout,
  killGraceMs = 2e3,
  signal = null,
  maxBufferBytes = 1048576,
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
    const decoder = createLineDecoder({ maxBufferBytes });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timer = null;
    let forceTimer = null;
    const signalChild = (signal2) => {
      try {
        if (detached && Number.isInteger(child.pid) && child.pid > 0 && process.platform !== "win32") {
          process.kill(-child.pid, signal2);
          return;
        }
        child.kill(signal2);
      } catch {
      }
    };
    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", abortHandler);
      }
      child.stdout?.off?.("data", handleStdoutData);
      child.stderr?.off?.("data", handleStderrData);
      child.stdin?.off?.("error", handleStdinError);
      child.off?.("error", handleChildError);
      child.off?.("close", handleChildClose);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      cleanup();
      resolve(result);
    };
    const finishDecoderError = (error) => {
      finish({
        ok: false,
        status: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        error: error.message
      });
    };
    const abortHandler = () => {
      if (settled || aborted) return;
      aborted = true;
      signalChild("SIGTERM");
      if (killGraceMs > 0 && !forceTimer) {
        forceTimer = setTimeout(() => {
          signalChild("SIGKILL");
        }, killGraceMs);
      }
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
    const handleChildError = (error) => {
      finish({
        ok: false,
        status: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        error: error.message
      });
    };
    const handleStdinError = (error) => {
      if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
        return;
      }
      stderr += `${error.message}
`;
    };
    const handleStdoutData = (chunk) => {
      if (settled) return;
      let lines;
      try {
        lines = decoder.push(chunk);
      } catch (error) {
        finishDecoderError(error);
        return;
      }
      for (const line of lines) {
        stdout += `${line}
`;
        try {
          onStdoutLine(line);
        } catch {
        }
      }
    };
    const handleStderrData = (chunk) => {
      if (settled) return;
      const text = chunk.toString("utf8");
      stderr += text;
      try {
        onStderrChunk(text);
      } catch {
      }
    };
    const handleChildClose = (status, signalName) => {
      let lines;
      try {
        lines = decoder.end();
      } catch (error) {
        finishDecoderError(error);
        return;
      }
      for (const line of lines) {
        stdout += `${line}
`;
        try {
          onStdoutLine(line);
        } catch {
        }
      }
      finish({
        ok: status === 0 && !timedOut && !aborted,
        status,
        signal: signalName,
        timedOut,
        stdout,
        stderr,
        error: status === 0 && !timedOut && !aborted ? null : stderr.trim() || formatExitError(status, signalName, { timedOut, aborted })
      });
    };
    child.on("error", handleChildError);
    child.stdin?.on?.("error", handleStdinError);
    child.stdout?.on?.("data", handleStdoutData);
    child.stderr?.on?.("data", handleStderrData);
    child.on("close", handleChildClose);
    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }
    if (child.stdin) {
      if (input != null) {
        const wroteAll = child.stdin.write(input);
        if (wroteAll === false && child.stdin.once) {
          child.stdin.once("drain", () => {
            if (!settled) {
              child.stdin.end();
            }
          });
        } else {
          child.stdin.end();
        }
      } else {
        child.stdin.end();
      }
    }
  });
}

// packages/polycli-runtime/src/claude.js
var CLAUDE_BIN = process.env.CLAUDE_CLI_BIN || "claude";
var CLAUDE_TMUX_BIN = process.env.POLYCLI_TMUX_BIN || "tmux";
var DEFAULT_TIMEOUT_MS = 9e5;
var TMUX_START_TIMEOUT_MS = 3e4;
var AUTH_CHECK_TIMEOUT_MS = 3e4;
var PROMPT_STDIN_THRESHOLD = 1e5;
var CLAUDE_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var CLAUDE_TMUX_ENV_EXACT = /* @__PURE__ */ new Set([
  "ALL_PROXY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BETA",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_PROJECT_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "all_proxy",
  "https_proxy",
  "http_proxy",
  "no_proxy"
]);
var CLAUDE_TMUX_DETACHED_WARNING = "Claude tmux TUI mode starts a detached interactive Claude TUI session; attach to read the model response. Timing covers tmux startup and prompt submission only, not LLM completion.";
var TMUX_CLEANUP_SIGNALS = ["SIGINT", "SIGTERM"];
var TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
function shellQuote(value) {
  const text = String(value ?? "");
  if (text === "") return "''";
  if (/^[A-Za-z0-9_./:=,+@%-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
function sanitizeTmuxName(value) {
  const text = String(value ?? "").trim();
  const sanitized = text.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || `polycli-claude-${randomUUID().slice(0, 8)}`;
}
function createTmuxSessionName() {
  return `polycli-claude-${randomUUID().slice(0, 8)}`;
}
function shouldForwardClaudeTmuxEnv(key) {
  return CLAUDE_TMUX_ENV_EXACT.has(key);
}
function buildClaudeTmuxEnvironmentArgs(env) {
  if (!env || typeof env !== "object") {
    return [];
  }
  return Object.entries(env).filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && shouldForwardClaudeTmuxEnv(key) && value != null && !String(value).includes("\0")).sort(([left], [right]) => left.localeCompare(right)).flatMap(([key, value]) => ["-e", `${key}=${String(value)}`]);
}
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
function firstNonEmptyLine2(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}
function parseClaudeLegacyAuthText(text) {
  const detail = firstNonEmptyLine2(text);
  if (!detail) {
    return null;
  }
  if (CLAUDE_EXPLICIT_AUTH_ERROR_RE.test(detail) || /\b(not authenticated|not logged in|logged out)\b/i.test(detail)) {
    return { loggedIn: false, detail, model: null };
  }
  if (/\b(authenticated|logged in|signed in)\b/i.test(detail)) {
    return { loggedIn: true, detail, model: null };
  }
  return null;
}
function buildClaudeInvocation({
  prompt,
  model = null,
  outputFormat = "json",
  permissionMode = "bypassPermissions",
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
function buildClaudeTuiInvocation({
  prompt,
  model = null,
  permissionMode = "bypassPermissions",
  resumeSessionId = null,
  extraArgs = [],
  bin = CLAUDE_BIN,
  tmuxBin = CLAUDE_TMUX_BIN,
  tmuxSessionName = null,
  cwd = null,
  env = process.env
} = {}) {
  const promptText = String(prompt ?? "");
  const sessionName = sanitizeTmuxName(tmuxSessionName || createTmuxSessionName());
  const bufferName = `${sessionName}-prompt`;
  const claudeArgs = [];
  if (permissionMode) {
    claudeArgs.push("--permission-mode", permissionMode);
  }
  if (model) {
    claudeArgs.push("--model", model);
  }
  if (resumeSessionId) {
    claudeArgs.push("--resume", resumeSessionId);
  }
  if (extraArgs.length > 0) {
    claudeArgs.push(...extraArgs);
  }
  const shellCommand = [bin, ...claudeArgs].map(shellQuote).join(" ");
  const startArgs = ["new-session", "-d", "-s", sessionName];
  startArgs.push(...buildClaudeTmuxEnvironmentArgs(env));
  if (cwd) {
    startArgs.push("-c", cwd);
  }
  startArgs.push(shellCommand);
  return {
    bin: tmuxBin,
    sessionName,
    bufferName,
    startArgs,
    loadBufferArgs: ["load-buffer", "-b", bufferName, "-"],
    pasteBufferArgs: ["paste-buffer", "-d", "-b", bufferName, "-t", sessionName],
    sendEnterArgs: ["send-keys", "-t", sessionName, "Enter"],
    input: promptText,
    attachCommand: `tmux attach -t ${shellQuote(sessionName)}`
  };
}
function runTmuxStep(invocation, args, options = {}) {
  return runCommand(invocation.bin, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    timeout: options.timeout
  });
}
function sleepSync2(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function describeTmuxFailure(step, result) {
  if (result.error) {
    if (step === "new-session" && result.error.code === "ENOENT") {
      return "tmux new-session failed: tmux is required for Claude TUI mode but was not found. Install tmux or set POLYCLI_TMUX_BIN.";
    }
    return `tmux ${step} failed: ${result.error.message}`;
  }
  const detail = String(result.stderr || result.stdout || "").trim();
  return `tmux ${step} exited with code ${result.status}${detail ? `: ${detail}` : ""}`;
}
function installTmuxSignalCleanup(invocation, { cwd, env, timeout, signalEmitter = process }) {
  const state = { signal: null };
  const handlers = /* @__PURE__ */ new Map();
  const remove = () => {
    for (const [signal, handler] of handlers) {
      if (typeof signalEmitter.off === "function") {
        signalEmitter.off(signal, handler);
      } else if (typeof signalEmitter.removeListener === "function") {
        signalEmitter.removeListener(signal, handler);
      }
    }
    handlers.clear();
  };
  const killSession = () => {
    runTmuxStep(invocation, ["kill-session", "-t", invocation.sessionName], { cwd, env, timeout });
  };
  const handleSignal = (signal) => {
    if (state.signal) {
      return;
    }
    state.signal = signal;
    killSession();
    remove();
    if (signalEmitter === process) {
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exitCode = signal === "SIGINT" ? 130 : 143;
      }
    }
  };
  for (const signal of TMUX_CLEANUP_SIGNALS) {
    if (typeof signalEmitter.once !== "function") {
      continue;
    }
    const handler = () => handleSignal(signal);
    handlers.set(signal, handler);
    signalEmitter.once(signal, handler);
  }
  return { state, remove, killSession };
}
function waitForClaudeTuiReady(invocation, { cwd, env, timeout }) {
  const waitTimeout = Number.isFinite(timeout) && timeout > 0 ? timeout : TMUX_START_TIMEOUT_MS;
  const deadline = Date.now() + waitTimeout;
  let last = null;
  while (Date.now() <= deadline) {
    const captured = runTmuxStep(
      invocation,
      ["capture-pane", "-pt", invocation.sessionName, "-S", "-120"],
      { cwd, env, timeout: 1e3 }
    );
    last = captured;
    if (captured.status === 0 && /Claude Code/.test(captured.stdout || "")) {
      return { ok: true };
    }
    sleepSync2(100);
  }
  return {
    ok: false,
    error: last ? describeTmuxFailure("capture-pane", last) : "tmux capture-pane did not report Claude readiness"
  };
}
function firstPromptNeedle(input) {
  return String(input || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 80) || "";
}
function pasteReadySignal(text, promptNeedle) {
  return String(text || "").split(/\r?\n/).filter((line) => /Pasted text #|paste again to expand/i.test(line) || promptNeedle && line.includes(promptNeedle)).join(" ").replace(/\s+/g, " ").trim();
}
function waitForClaudeTuiPasteReady(invocation, { cwd, env, timeout }) {
  if (!String(invocation.input || "").trim()) {
    return { ok: true };
  }
  const waitTimeout = Number.isFinite(timeout) && timeout > 0 ? timeout : TMUX_START_TIMEOUT_MS;
  const deadline = Date.now() + waitTimeout;
  const promptNeedle = firstPromptNeedle(invocation.input);
  let lastReadyText = null;
  let stableSince = null;
  let last = null;
  while (Date.now() <= deadline) {
    const captured = runTmuxStep(
      invocation,
      ["capture-pane", "-pt", invocation.sessionName, "-S", "-120"],
      { cwd, env, timeout: 1e3 }
    );
    last = captured;
    const text = captured.stdout || "";
    const readyText = pasteReadySignal(text, promptNeedle);
    if (captured.status === 0 && readyText) {
      if (readyText && readyText === lastReadyText) {
        if (stableSince != null && Date.now() - stableSince >= 750) {
          return { ok: true };
        }
      } else {
        lastReadyText = readyText;
        stableSince = Date.now();
      }
    }
    sleepSync2(100);
  }
  return {
    ok: false,
    error: last ? describeTmuxFailure("capture-pane", last) : "tmux capture-pane did not show pasted prompt"
  };
}
function runClaudeTuiPrompt({
  prompt,
  model = null,
  permissionMode = "bypassPermissions",
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
  bin = CLAUDE_BIN,
  tmuxBin = CLAUDE_TMUX_BIN,
  tmuxSessionName = null,
  env = process.env,
  signalEmitter = process
} = {}) {
  const invocation = buildClaudeTuiInvocation({
    prompt,
    model,
    permissionMode,
    resumeSessionId,
    extraArgs,
    bin,
    tmuxBin,
    tmuxSessionName,
    cwd,
    env
  });
  const startTimeout = Math.min(timeout || TMUX_START_TIMEOUT_MS, TMUX_START_TIMEOUT_MS);
  const start = runTmuxStep(invocation, invocation.startArgs, { cwd, env, timeout: startTimeout });
  if (start.error || start.status !== 0) {
    return { ok: false, error: describeTmuxFailure("new-session", start), stdout: start.stdout, stderr: start.stderr };
  }
  const signalCleanup = installTmuxSignalCleanup(invocation, { cwd, env, timeout: startTimeout, signalEmitter });
  const interrupted = () => signalCleanup.state.signal ? { ok: false, error: `Claude TUI tmux session interrupted by ${signalCleanup.state.signal}` } : null;
  const finish = (result) => {
    signalCleanup.remove();
    return result;
  };
  const killAndFinish = (result) => {
    signalCleanup.killSession();
    return finish(result);
  };
  const initialInterrupt = interrupted();
  if (initialInterrupt) {
    return finish(initialInterrupt);
  }
  const ready = waitForClaudeTuiReady(invocation, { cwd, env, timeout: startTimeout });
  const readyInterrupt = interrupted();
  if (readyInterrupt) {
    return finish(readyInterrupt);
  }
  if (!ready.ok) {
    return killAndFinish({ ok: false, error: ready.error });
  }
  const load = runTmuxStep(invocation, invocation.loadBufferArgs, {
    cwd,
    env,
    input: invocation.input,
    timeout: startTimeout
  });
  const loadInterrupt = interrupted();
  if (loadInterrupt) {
    return finish(loadInterrupt);
  }
  if (load.error || load.status !== 0) {
    return killAndFinish({ ok: false, error: describeTmuxFailure("load-buffer", load), stdout: load.stdout, stderr: load.stderr });
  }
  const cleanupBuffer = () => {
    runTmuxStep(invocation, ["delete-buffer", "-b", invocation.bufferName], { cwd, env, timeout: startTimeout });
  };
  const paste = runTmuxStep(invocation, invocation.pasteBufferArgs, { cwd, env, timeout: startTimeout });
  const pasteInterrupt = interrupted();
  if (pasteInterrupt) {
    return finish(pasteInterrupt);
  }
  if (paste.error || paste.status !== 0) {
    cleanupBuffer();
    return killAndFinish({ ok: false, error: describeTmuxFailure("paste-buffer", paste), stdout: paste.stdout, stderr: paste.stderr });
  }
  const pasteReady = waitForClaudeTuiPasteReady(invocation, { cwd, env, timeout: startTimeout });
  const pasteReadyInterrupt = interrupted();
  if (pasteReadyInterrupt) {
    return finish(pasteReadyInterrupt);
  }
  if (!pasteReady.ok) {
    return killAndFinish({ ok: false, error: pasteReady.error });
  }
  sleepSync2(250);
  const enter = runTmuxStep(invocation, invocation.sendEnterArgs, { cwd, env, timeout: startTimeout });
  const enterInterrupt = interrupted();
  if (enterInterrupt) {
    return finish(enterInterrupt);
  }
  if (enter.error || enter.status !== 0) {
    return killAndFinish({ ok: false, error: describeTmuxFailure("send-keys", enter), stdout: enter.stdout, stderr: enter.stderr });
  }
  const response = [
    `Started Claude TUI tmux session '${invocation.sessionName}'.`,
    `Attach with: ${invocation.attachCommand}`,
    "The prompt was pasted into the interactive session."
  ].join("\n");
  return finish({
    ok: true,
    response,
    model: model ?? defaultModel,
    sessionId: null,
    detached: true,
    responseKind: "tmux_tui_session_started",
    tmuxSession: invocation.sessionName,
    attachCommand: invocation.attachCommand,
    warnings: [CLAUDE_TMUX_DETACHED_WARNING],
    timingMeta: {
      tmuxDetached: true,
      timingScope: "tmux_startup",
      llmCompletionObserved: false
    },
    stdout: "",
    stderr: ""
  });
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
    resultEvent
  };
}
function parseClaudeJsonResult(stdout, stderr, status, { defaultModel = null } = {}) {
  const text = String(stdout ?? "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    return {
      ok: false,
      error: String(stderr ?? "").trim() || formatProviderExitError("claude", status),
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
    const errorText2 = isClaudeErrorResultEvent(parsed) ? getClaudeErrorText(parsed) : null;
    const processError = status === 0 ? null : String(stderr ?? "").trim() || formatProviderExitError("claude", status);
    return {
      ok: status === 0 && !isClaudeErrorResultEvent(parsed),
      response,
      sessionId,
      model: parsed.model ?? defaultModel,
      durationMs: parsed.duration_ms ?? null,
      totalCostUsd: parsed.total_cost_usd ?? null,
      status,
      error: isClaudeErrorResultEvent(parsed) ? errorText2 : processError
    };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${error.message}`, status };
  }
}
function getClaudeAvailability(cwd) {
  return binaryAvailable(CLAUDE_BIN, ["--version"], { cwd });
}
function getClaudeAuthStatus(cwd, {
  authRunner = (options = {}) => runCommand(CLAUDE_BIN, ["auth", "status", "--json"], options)
} = {}) {
  const result = authRunner({
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS
  });
  if (result.error) {
    const detail2 = result.error.message || "claude auth status failed";
    if (result.error.code === "ETIMEDOUT" || TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail2))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail2}`, model: null };
    }
    return { loggedIn: false, detail: detail2 };
  }
  if (result.status === 0) {
    let parsed = null;
    try {
      parsed = JSON.parse(String(result.stdout || "{}"));
    } catch {
      const legacy = parseClaudeLegacyAuthText(`${result.stdout || ""}
${result.stderr || ""}`);
      if (legacy) {
        return legacy;
      }
      const detail2 = firstNonEmptyLine2(`${result.stdout || ""}
${result.stderr || ""}`);
      return {
        loggedIn: true,
        detail: `auth probe inconclusive: claude auth status returned non-json output${detail2 ? `: ${detail2}` : ""}`,
        model: null
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { loggedIn: true, detail: "auth probe inconclusive: claude auth status returned non-object output", model: null };
    }
    const loggedIn = parsed.loggedIn ?? parsed.authenticated;
    if (typeof loggedIn !== "boolean") {
      return { loggedIn: true, detail: "auth probe inconclusive: claude auth status returned no authentication state", model: parsed.model ?? null };
    }
    return {
      loggedIn,
      detail: loggedIn ? "authenticated" : "not authenticated",
      model: parsed?.model ?? null
    };
  }
  const detail = String(result.stderr || result.stdout || "").trim() || `claude auth status exited with code ${result.status}`;
  if (CLAUDE_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
  }
  return { loggedIn: false, detail };
}
function runClaudePrompt({
  prompt,
  model = null,
  permissionMode = "bypassPermissions",
  maxTurns = 10,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
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
  return parseClaudeJsonResult(result.stdout, result.stderr, result.status, {
    defaultModel: model ?? defaultModel
  });
}
function runClaudePromptStreaming({
  prompt,
  model = null,
  permissionMode = "bypassPermissions",
  maxTurns = 10,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
  onEvent = () => {
  },
  bin = CLAUDE_BIN,
  tmuxBin = CLAUDE_TMUX_BIN,
  tmuxSessionName = null,
  executionMode = "print",
  env = process.env,
  signalEmitter = process,
  spawnImpl
} = {}) {
  if (executionMode === "tmux-tui") {
    return Promise.resolve(runClaudeTuiPrompt({
      prompt,
      model,
      permissionMode,
      cwd,
      timeout,
      extraArgs,
      resumeSessionId,
      defaultModel,
      bin,
      tmuxBin,
      tmuxSessionName,
      env,
      signalEmitter
    }));
  }
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
    env,
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
    const hasSuccessfulResult = Boolean(
      parsed.resultEvent && parsed.resultEvent.type === "result" && !isClaudeErrorResultEvent(parsed.resultEvent)
    );
    const completed = result.ok || result.timedOut && hasSuccessfulResult;
    return {
      ...result,
      ...parsed,
      timedOut: completed ? false : result.timedOut,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      model: parsed.model ?? model ?? defaultModel,
      ok: completed && !resultError && hasVisibleText,
      error: completed ? resultError || (hasVisibleText ? null : "claude produced no visible text") : result.error
    };
  });
}

// packages/polycli-runtime/src/copilot.js
var COPILOT_BIN = process.env.COPILOT_CLI_BIN || "copilot";
var DEFAULT_TIMEOUT_MS2 = 9e5;
var AUTH_CHECK_TIMEOUT_MS2 = 3e4;
var COPILOT_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var TRANSIENT_PROBE_ERROR_PATTERNS2 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
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
    return formatProviderExitError("copilot", event.exitCode);
  }
  if (event.status && event.status !== 0) {
    return formatProviderExitError("copilot", event.status);
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
  allowAllTools = true,
  allowAllPaths = true,
  allowAllUrls = true,
  noAskUser = true,
  extraArgs = [],
  bin = COPILOT_BIN
} = {}) {
  const args = [
    "-p",
    String(prompt ?? ""),
    "--output-format",
    outputFormat,
    "--stream",
    stream
  ];
  if (allowAllTools) args.push("--allow-all-tools");
  if (allowAllPaths) args.push("--allow-all-paths");
  if (allowAllUrls) args.push("--allow-all-urls");
  if (noAskUser) args.push("--no-ask-user");
  if (model) {
    args.push("--model", model);
  }
  if (resumeSessionId) {
    args.push("--session-id", resumeSessionId);
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
    const eventSessionId = typeof event.sessionId === "string" ? event.sessionId : typeof event.session_id === "string" ? event.session_id : typeof event.session?.id === "string" ? event.session.id : event.data?.sessionId;
    const isTerminalEvent = event.type === "result" || event.type === "final" || event.type === "error";
    if (typeof eventSessionId === "string" && (!sessionId || isTerminalEvent)) {
      sessionId = eventSessionId;
    }
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.session?.model === "string") model = event.session.model;
    if (!model && typeof event.data?.model === "string") model = event.data.model;
    if (event.type === "assistant.message" && typeof event.data?.content === "string") {
      if (!response.trim() || event.data.content.startsWith(response)) {
        response = event.data.content;
      } else {
        response = `${response}
${event.data.content}`;
      }
      continue;
    }
    if (isTerminalEvent) {
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
function getCopilotResumeStatus(resumeSessionId, sessionId) {
  if (!resumeSessionId) return null;
  if (typeof sessionId !== "string" || sessionId.length === 0) return "unverified";
  return sessionId === resumeSessionId ? "resumed" : "not_resumed";
}
function getCopilotAvailability(cwd) {
  return binaryAvailable(COPILOT_BIN, ["--version"], { cwd });
}
function getCopilotAuthStatus(cwd, { promptRunner = runCopilotPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS2
  });
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? null
    };
  }
  const detail = String(result.error ?? "").trim() || "copilot auth probe failed";
  if (COPILOT_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS2.some((pattern) => pattern.test(detail))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: result.model ?? null };
  }
  return { loggedIn: false, detail };
}
function runCopilotPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS2,
  extraArgs = [],
  resumeSessionId = null,
  continueLast = false,
  allowAllTools = true,
  allowAllPaths = true,
  allowAllUrls = true,
  noAskUser = true,
  bin = COPILOT_BIN
} = {}) {
  const invocation = buildCopilotInvocation({
    prompt,
    model,
    outputFormat: "json",
    stream: "off",
    resumeSessionId,
    continueLast,
    allowAllTools,
    allowAllPaths,
    allowAllUrls,
    noAskUser,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    return {
      ok: false,
      resumeStatus: getCopilotResumeStatus(resumeSessionId, null),
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
  const sessionId = parsed.sessionId ?? resolvedSession.sessionId;
  return {
    ok: result.status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId,
    resumeStatus: getCopilotResumeStatus(resumeSessionId, sessionId),
    model: parsed.model,
    error: result.status === 0 ? resultError || (hasVisibleText ? null : "copilot produced no visible text") : result.stderr.trim() || formatProviderExitError("copilot", result.status),
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
  allowAllTools = true,
  allowAllPaths = true,
  allowAllUrls = true,
  noAskUser = true,
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
    allowAllTools,
    allowAllPaths,
    allowAllUrls,
    noAskUser,
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
    const sessionId = parsed.sessionId ?? resolvedSession.sessionId;
    return {
      ...result,
      ...parsed,
      sessionId,
      resumeStatus: getCopilotResumeStatus(resumeSessionId, sessionId),
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
var VALID_GEMINI_EFFORTS = /* @__PURE__ */ new Set(["low", "medium", "high"]);
var TRANSIENT_PROBE_ERROR_PATTERNS3 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
function buildGeminiEnv(parentEnv = process.env) {
  const trust = parentEnv.GEMINI_CLI_TRUST_WORKSPACE ?? "true";
  return {
    ...parentEnv,
    GEMINI_CLI_TRUST_WORKSPACE: trust
  };
}
function applyGeminiEffort(prompt, effort) {
  const promptText = String(prompt ?? "");
  if (!VALID_GEMINI_EFFORTS.has(effort)) return promptText;
  if (effort === "high") {
    return `Think step by step. Be thorough and consider edge cases.

${promptText}`;
  }
  if (effort === "low") {
    return `Be concise. Give the most direct answer.

${promptText}`;
  }
  return promptText;
}
function buildGeminiInvocation({
  prompt,
  model = null,
  approvalMode = "yolo",
  write = false,
  effort = null,
  outputFormat = "json",
  resumeSessionId = null,
  extraArgs = [],
  bin = GEMINI_BIN
} = {}) {
  const promptText = applyGeminiEffort(prompt, effort);
  const useStdin = Buffer.byteLength(promptText, "utf8") > PROMPT_STDIN_THRESHOLD2;
  const args = ["-p", useStdin ? "" : promptText, "-o", outputFormat];
  const resolvedApprovalMode = write ? "auto_edit" : approvalMode;
  if (model) args.push("-m", model);
  args.push("--approval-mode", resolvedApprovalMode);
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (extraArgs.length > 0) args.push(...extraArgs);
  return {
    bin,
    args,
    input: useStdin ? promptText : void 0,
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
  let model = null;
  let resultEvent = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const parsed = parseStreamJsonLine(rawLine, { allowPrefix: true });
    if (!parsed.ok) continue;
    const event = parsed.event;
    events.push(event);
    if (!sessionId && event.session_id) sessionId = event.session_id;
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.session?.model === "string") model = event.session.model;
    if (event.type === "result") {
      resultEvent = event;
      if (event.stats) {
        stats = event.stats;
        model = model ?? Object.keys(event.stats.models ?? {})[0] ?? null;
      }
      if (!response.trim()) {
        response += extractGeminiText(event);
      }
      continue;
    }
    response += extractGeminiText(event);
  }
  return { events, response, sessionId, stats, model, resultEvent };
}
function parseGeminiJsonResult(stdout, stderr, status, { defaultModel = null } = {}) {
  const text = String(stdout ?? "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    return {
      ok: false,
      error: String(stderr ?? "").trim() || formatProviderExitError("gemini", status),
      status
    };
  }
  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    if (parsed.error) {
      return {
        ok: false,
        error: parsed.error.message || "gemini returned an error",
        code: parsed.error.code ?? null,
        status
      };
    }
    if (status !== 0) {
      return {
        ok: false,
        error: String(stderr ?? "").trim() || formatProviderExitError("gemini", status),
        status
      };
    }
    const resolvedSession = resolveSessionId({
      stdout: "",
      stderr,
      priority: ["stdout", "stderr", "file"]
    });
    return {
      ok: true,
      response: parsed.response ?? "",
      sessionId: parsed.session_id ?? resolvedSession.sessionId ?? null,
      stats: parsed.stats ?? null,
      model: Object.keys(parsed.stats?.models ?? {})[0] || defaultModel,
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
  if (TRANSIENT_PROBE_ERROR_PATTERNS3.some((pattern) => pattern.test(detail))) {
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
  approvalMode = "yolo",
  write = false,
  effort = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS3,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
  bin = GEMINI_BIN
} = {}) {
  const invocation = buildGeminiInvocation({
    prompt,
    model,
    approvalMode,
    write,
    effort,
    outputFormat: "json",
    resumeSessionId,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    timeout,
    input: invocation.input,
    env: buildGeminiEnv()
  });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT" ? `gemini timed out after ${Math.round(timeout / 1e3)}s` : result.error.message
    };
  }
  return parseGeminiJsonResult(result.stdout, result.stderr, result.status, {
    defaultModel: model ?? defaultModel
  });
}
function runGeminiPromptStreaming({
  prompt,
  model = null,
  approvalMode = "yolo",
  write = false,
  effort = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS3,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
  onEvent = () => {
  },
  bin = GEMINI_BIN,
  spawnImpl
} = {}) {
  const invocation = buildGeminiInvocation({
    prompt,
    model,
    approvalMode,
    write,
    effort,
    outputFormat: "stream-json",
    resumeSessionId,
    extraArgs,
    bin
  });
  return spawnStreamingCommand({
    bin: invocation.bin,
    args: invocation.args,
    cwd,
    env: buildGeminiEnv(),
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
      stdout: "",
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const resultError = typeof parsed.resultEvent?.error?.message === "string" ? parsed.resultEvent.error.message : typeof parsed.resultEvent?.error === "string" ? parsed.resultEvent.error : null;
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      // stdout blanked so a UUID in the answer prose is never promoted to a fabricated id.
      sessionId: parsed.sessionId ?? resolvedSession.sessionId ?? null,
      model: parsed.model ?? model ?? defaultModel,
      ok: result.ok && !resultError && hasVisibleText,
      error: result.ok ? resultError || (hasVisibleText ? null : "gemini produced no visible text") : result.error
    };
  });
}

// packages/polycli-runtime/src/kimi.js
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
var KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";
var DEFAULT_TIMEOUT_MS4 = 9e5;
var AUTH_CHECK_TIMEOUT_MS4 = 3e4;
var KIMI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var TRANSIENT_PROBE_ERROR_PATTERNS4 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
var KIMI_CONFIG_PATH = process.env.KIMI_CONFIG_PATH || path2.join(os.homedir(), ".kimi-code", "config.toml");
function readKimiDefaultModel() {
  try {
    const text = fs2.readFileSync(KIMI_CONFIG_PATH, "utf8");
    const match = text.match(/^default_model\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m);
    return match ? match[1] ?? match[2] ?? match[3] ?? null : null;
  } catch {
    return null;
  }
}
function buildKimiInvocation({
  prompt,
  model = null,
  resumeSessionId = null,
  resumeLast = false,
  extraArgs = [],
  bin = KIMI_BIN
} = {}) {
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
  let model = null;
  let sessionId = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const event = parseKimiEventLine(rawLine);
    if (!event) continue;
    events.push(event);
    if (event.role === "tool") toolEvents.push(event);
    if (!sessionId && event.role === "meta" && event.type === "session.resume_hint" && typeof event.session_id === "string" && event.session_id.length > 0) {
      sessionId = event.session_id;
    }
    if (!model && typeof event.model === "string") model = event.model;
    if (!model && typeof event.message?.model === "string") model = event.message.model;
    response += extractKimiText(event);
  }
  return { events, toolEvents, response, model, sessionId };
}
function getKimiAvailability(cwd) {
  return binaryAvailable(KIMI_BIN, ["-V"], { cwd });
}
function buildKimiAuthStatus(result) {
  const configModel = readKimiDefaultModel();
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? configModel
    };
  }
  const detail = String(result.error ?? "").trim() || "kimi auth probe failed";
  if (KIMI_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS4.some((pattern) => pattern.test(detail))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: result.model ?? configModel };
  }
  return { loggedIn: false, detail };
}
function getKimiAuthStatus(cwd, { promptRunner = runKimiPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS4
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
  resumeLast = false,
  defaultModel = null,
  bin = KIMI_BIN
} = {}) {
  const invocation = buildKimiInvocation({ prompt, model, resumeSessionId, resumeLast, extraArgs, bin });
  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    const error2 = result.error.code === "ETIMEDOUT" ? `kimi timed out after ${Math.round(timeout / 1e3)}s` : result.error.message;
    return { ok: false, error: error2, errorCode: classifyProviderFailure(error2, { provider: "kimi" }) };
  }
  if (result.status !== 0) {
    const error2 = result.stderr.trim() || formatProviderExitError("kimi", result.status);
    return {
      ok: false,
      error: error2,
      errorCode: classifyProviderFailure(error2, { provider: "kimi" }),
      status: result.status
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
    status: result.status
  };
}
function runKimiPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS4,
  extraArgs = [],
  resumeSessionId = null,
  resumeLast = false,
  defaultModel = null,
  onEvent = () => {
  },
  bin = KIMI_BIN,
  spawnImpl
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
        try {
          onEvent(event);
        } catch {
        }
      }
    }
  }).then((result) => {
    const parsed = parseKimiStreamText(result.stdout);
    const hasVisibleText = Boolean(parsed.response.trim());
    const ok = result.ok && hasVisibleText;
    const error = ok ? null : result.ok ? "kimi produced no visible text" : result.error;
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId,
      model: parsed.model ?? model ?? defaultModel ?? readKimiDefaultModel(),
      ok,
      error,
      errorCode: classifyProviderFailure(error, { provider: "kimi" })
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
var TRANSIENT_PROBE_ERROR_PATTERNS5 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
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
  model,
  appendSystem,
  appendDirs,
  extraArgs = [],
  bin = QWEN_BIN
} = {}) {
  let effectiveApprovalMode = approvalMode;
  if (!effectiveApprovalMode) {
    effectiveApprovalMode = "yolo";
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
  if (model) args.push("--model", model);
  args.push("--output-format", "stream-json");
  args.push("--approval-mode", effectiveApprovalMode);
  args.push("--max-session-turns", String(maxSteps));
  if (appendSystem) args.push("--append-system-prompt", appendSystem);
  if (appendDirs?.length) args.push("--include-directories", appendDirs.join(","));
  args.push(String(prompt ?? ""));
  if (extraArgs.length > 0) args.push(...extraArgs);
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
  if (TRANSIENT_PROBE_ERROR_PATTERNS5.some((pattern) => pattern.test(detail))) {
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
  model,
  appendSystem,
  appendDirs,
  extraArgs = [],
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
    model,
    appendSystem,
    appendDirs,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    env,
    timeout
  });
  if (result.error) {
    const error2 = result.error.code === "ETIMEDOUT" ? `qwen timed out after ${Math.round(timeout / 1e3)}s` : result.error.message;
    return { ok: false, error: error2, errorCode: classifyProviderFailure(error2, { provider: "qwen" }) };
  }
  const parsed = parseQwenStreamText(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"]
  });
  const resultEventError = extractQwenResultError(parsed.resultEvent);
  const hasVisibleText = Boolean(parsed.response.trim());
  const error = result.status === 0 && !resultEventError && hasVisibleText ? null : result.stderr.trim() || resultEventError || (result.status === 0 ? "qwen produced no visible text" : formatProviderExitError("qwen", result.status));
  const errorCode = resultEventError ? classifyProviderFailure(resultEventError, { provider: "qwen" }) || "provider_error" : classifyProviderFailure(error, { provider: "qwen" });
  return {
    ok: result.status === 0 && !resultEventError && hasVisibleText,
    status: result.status,
    stderr: result.stderr,
    ...parsed,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    error,
    errorCode
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
  model,
  appendSystem,
  appendDirs,
  extraArgs = [],
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
    model,
    appendSystem,
    appendDirs,
    extraArgs,
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
    const error = result.ok && !resultEventError ? hasVisibleText ? null : resultEventError || "qwen produced no visible text" : resultEventError || result.error;
    const errorCode = resultEventError ? classifyProviderFailure(resultEventError, { provider: "qwen" }) || "provider_error" : classifyProviderFailure(error, { provider: "qwen" });
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultEventError && hasVisibleText,
      error,
      errorCode
    };
  });
}

// packages/polycli-runtime/src/minimax.js
var MMX_BIN = process.env.MMX_CLI_BIN || process.env.MINIMAX_CLI_BIN || "mmx";
var DEFAULT_TIMEOUT_MS6 = 12e4;
var AUTH_CHECK_TIMEOUT_MS6 = 3e4;
var MINIMAX_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var TRANSIENT_PROBE_ERROR_PATTERNS6 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
function stripAnsiSgr(text) {
  return String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "");
}
function buildMiniMaxInvocation({
  prompt,
  model = null,
  extraArgs = [],
  bin = MMX_BIN
} = {}) {
  const args = [
    "text",
    "chat",
    "--message",
    String(prompt ?? ""),
    "--output",
    "json",
    "--non-interactive"
  ];
  if (model) args.push("--model", model);
  if (extraArgs.length > 0) args.push(...extraArgs);
  return {
    bin,
    args
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
function getMiniMaxAvailability(cwd) {
  return binaryAvailable(MMX_BIN, ["--version"], { cwd });
}
async function getMiniMaxAuthStatus(cwd, { runner = runCommand } = {}) {
  const result = runner(MMX_BIN, ["auth", "status", "--output", "json", "--non-interactive"], {
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS6
  });
  if (result.error) {
    const detail = result.error.code === "ETIMEDOUT" ? `mmx auth probe timed out after ${Math.round(AUTH_CHECK_TIMEOUT_MS6 / 1e3)}s` : result.error.message;
    if (TRANSIENT_PROBE_ERROR_PATTERNS6.some((pattern) => pattern.test(detail))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
    }
    return { loggedIn: false, detail };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `mmx auth status exited with code ${result.status}`;
    if (!MINIMAX_EXPLICIT_AUTH_ERROR_RE.test(detail) && TRANSIENT_PROBE_ERROR_PATTERNS6.some((pattern) => pattern.test(detail))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
    }
    return { loggedIn: false, detail };
  }
  const text = `${result.stdout ?? ""}
${result.stderr ?? ""}`.trim();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
  }
  const loggedIn = parsed ? parsed.authenticated === true || parsed.loggedIn === true || parsed.status === "authenticated" : /\b(authenticated|logged in|ok)\b/i.test(text);
  return {
    loggedIn,
    detail: loggedIn ? "authenticated" : text || "mmx auth status did not report authenticated",
    model: parsed?.model ?? null
  };
}
function extractMiniMaxResponseFromMmxJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return { response: "", finishReason: null, toolCalls: [] };
  }
  let value = null;
  try {
    value = JSON.parse(raw);
  } catch {
    return { response: stripAnsiSgr(raw), finishReason: null, toolCalls: [] };
  }
  const choice = Array.isArray(value.choices) ? value.choices[0] : null;
  const message = choice?.message ?? choice?.delta ?? null;
  const contentText = Array.isArray(value.content) ? value.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("") : "";
  const response = typeof value.content === "string" ? value.content : typeof value.response === "string" ? value.response : typeof value.text === "string" ? value.text : contentText || (typeof message?.content === "string" ? message.content : "");
  const finishReason = value.finish_reason ?? value.finishReason ?? value.stop_reason ?? choice?.finish_reason ?? null;
  const toolCalls = Array.isArray(value.tool_calls) ? value.tool_calls : Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return {
    response,
    finishReason,
    toolCalls,
    ...typeof value.model === "string" ? { model: value.model } : {}
  };
}
function runMiniMaxPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS6,
  extraArgs = [],
  defaultModel = null,
  env = process.env,
  bin = MMX_BIN,
  spawnImpl
} = {}) {
  return new Promise((resolve) => {
    const invocation = buildMiniMaxInvocation({ prompt, model, extraArgs, bin });
    spawnStreamingCommand({
      bin: invocation.bin,
      args: invocation.args,
      cwd: cwd || process.cwd(),
      env,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      spawnImpl,
      onStdoutLine() {
      }
    }).then((result) => {
      try {
        const parsed = extractMiniMaxResponseFromMmxJson(result.stdout);
        const resolvedModel = parsed.model ?? model ?? defaultModel ?? null;
        const hasVisibleText = Boolean(parsed.response.trim());
        resolve({
          ...result,
          logPath: null,
          ...parsed,
          model: resolvedModel,
          ok: result.ok && hasVisibleText,
          error: result.ok && hasVisibleText ? null : result.error || result.stderr.trim() || "minimax produced no visible text"
        });
      } catch (error) {
        resolve({
          ok: false,
          status: null,
          signal: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          response: "",
          finishReason: null,
          toolCalls: [],
          logPath: null,
          model: model ?? defaultModel ?? null,
          error: error.message
        });
      }
    }, (error) => {
      resolve({
        ok: false,
        status: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        response: "",
        finishReason: null,
        toolCalls: [],
        logPath: null,
        model: model ?? defaultModel ?? null,
        error: error.message
      });
    });
  });
}
async function runMiniMaxPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS6,
  extraArgs = [],
  defaultModel = null,
  env = process.env,
  onEvent = () => {
  },
  bin = MMX_BIN,
  spawnImpl
} = {}) {
  const events = [];
  return runMiniMaxPrompt({
    prompt,
    model,
    cwd,
    timeout,
    extraArgs,
    defaultModel,
    env,
    bin,
    spawnImpl
  }).then((result) => {
    try {
      const event = {
        type: "result",
        response: result.response,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls,
        model: result.model ?? null
      };
      events.push(event);
      onEvent(event);
    } catch {
    }
    return { ...result, events };
  });
}

// packages/polycli-runtime/src/opencode.js
var OPENCODE_BIN = process.env.OPENCODE_CLI_BIN || "opencode";
var DEFAULT_TIMEOUT_MS7 = 9e5;
var AUTH_CHECK_TIMEOUT_MS7 = 3e4;
var SESSION_EXPORT_TIMEOUT_MS = 3e4;
var OPENCODE_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var TRANSIENT_PROBE_ERROR_PATTERNS7 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
function collectOpenCodeContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
function getOpenCodeSessionErrorDataMessage(event) {
  if (!event || typeof event !== "object") return null;
  const error = event.type === "session.error" ? event.properties?.error : event.type === "error" ? event.error : null;
  if (typeof error?.data?.message === "string" && error.data.message.trim()) {
    return error.data.message;
  }
  return null;
}
function getOpenCodeResultError(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const sessionErrorMessage = getOpenCodeSessionErrorDataMessage(event);
  if (event.type === "session.error") {
    return sessionErrorMessage || "opencode returned an error";
  }
  if (event.type === "error") {
    if (sessionErrorMessage) return sessionErrorMessage;
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
    timeout: SESSION_EXPORT_TIMEOUT_MS
  });
  if (result.error || result.status !== 0) return null;
  return extractOpenCodeExportModel(result.stdout);
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
  if (skipPermissions) args.push("--auto");
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
    if (event.type === "result" || event.type === "error" || event.type === "session.error") {
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
function parseOpenCodeJsonResult(stdout, stderr, status, { defaultModel = null } = {}) {
  const parsed = parseOpenCodeStreamText(stdout);
  const resolvedSession = resolveSessionId({
    stdout,
    stderr,
    priority: ["stdout", "stderr", "file"]
  });
  const resultError = getOpenCodeResultError(parsed.resultEvent);
  const sessionErrorMessage = getOpenCodeSessionErrorDataMessage(parsed.resultEvent);
  const hasVisibleText = Boolean(parsed.response.trim());
  const error = sessionErrorMessage || (status === 0 ? resultError || (hasVisibleText ? null : "opencode produced no visible text") : String(stderr ?? "").trim() || formatProviderExitError("opencode", status));
  return {
    ok: status === 0 && !resultError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    model: parsed.model ?? defaultModel,
    status,
    error,
    errorCode: classifyProviderFailure(error, { provider: "opencode" })
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
  if (TRANSIENT_PROBE_ERROR_PATTERNS7.some((pattern) => pattern.test(detail))) {
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
  defaultModel = null,
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
    const error = result.error.code === "ETIMEDOUT" ? `opencode timed out after ${Math.round(timeout / 1e3)}s` : result.error.message;
    return {
      ok: false,
      error,
      errorCode: classifyProviderFailure(error, { provider: "opencode" })
    };
  }
  const parsed = parseOpenCodeJsonResult(result.stdout, result.stderr, result.status, {
    defaultModel: model ?? defaultModel
  });
  if (parsed.ok && !parsed.model && parsed.sessionId) {
    const exportedModel = resolveOpenCodeSessionModel(parsed.sessionId, { cwd, env, bin });
    if (exportedModel) return { ...parsed, model: exportedModel };
  }
  return parsed;
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
  defaultModel = null,
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
    const sessionErrorMessage = getOpenCodeSessionErrorDataMessage(parsed.resultEvent);
    const hasVisibleText = Boolean(parsed.response.trim());
    let resolvedModel = parsed.model ?? model ?? defaultModel;
    const ok = result.ok && !resultError && hasVisibleText;
    if (ok && !resolvedModel) {
      resolvedModel = resolveOpenCodeSessionModel(parsed.sessionId ?? resolvedSession.sessionId, { cwd, env, bin });
    }
    const error = sessionErrorMessage || (result.ok ? resultError || (hasVisibleText ? null : "opencode produced no visible text") : result.error);
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      model: resolvedModel,
      ok,
      error,
      errorCode: classifyProviderFailure(error, { provider: "opencode" })
    };
  });
}

// packages/polycli-runtime/src/pi.js
var PI_BIN = process.env.PI_CLI_BIN || "pi";
var DEFAULT_PI_MODEL = null;
var DEFAULT_TIMEOUT_MS8 = 9e5;
var AUTH_CHECK_TIMEOUT_MS8 = 3e4;
var PI_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var TRANSIENT_PROBE_ERROR_PATTERNS8 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
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
  const effectiveModel = model ?? DEFAULT_PI_MODEL;
  if (effectiveModel) args.push("--model", effectiveModel);
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
function extractPiStreamDelta(event) {
  if (event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
    return event.assistantMessageEvent.delta;
  }
  return "";
}
function extractPiTerminalText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (event.type === "agent_end" && typeof event.result?.text === "string") {
    return event.result.text;
  }
  if (event.type !== "message_end" && event.type !== "turn_end" && event.type !== "agent_end") {
    return "";
  }
  const role = event.role ?? event.message?.role ?? null;
  if (role && role !== "assistant") {
    return "";
  }
  return collectPiContentText(event.content ?? event.message?.content);
}
function parsePiStreamText(text) {
  const events = [];
  let streamedResponse = "";
  let terminalResponse = "";
  let sessionId = null;
  let model = null;
  let resultEvent = null;
  let providerError = null;
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
    if (!model && typeof event.result?.model === "string") model = event.result.model;
    if (!model && typeof event.message?.model === "string") model = event.message.model;
    if (event.type === "agent_end") {
      resultEvent = event;
    }
    if (!providerError && event.message?.role === "assistant") {
      const errMsg = typeof event.message.errorMessage === "string" ? event.message.errorMessage.trim() : "";
      if (errMsg) {
        providerError = errMsg;
      } else if (event.message.stopReason === "error") {
        providerError = "pi reported stopReason=error with no errorMessage";
      }
    }
    const streamDelta = extractPiStreamDelta(event);
    if (streamDelta) {
      streamedResponse += streamDelta;
      continue;
    }
    const terminalText = extractPiTerminalText(event);
    if (terminalText) {
      terminalResponse = terminalText;
    }
  }
  const response = terminalResponse || streamedResponse;
  return {
    events,
    response,
    sessionId,
    model,
    resultEvent,
    providerError
  };
}
function getPiAvailability(cwd) {
  return binaryAvailable(PI_BIN, ["--version"], { cwd });
}
function buildPiAuthStatus(result) {
  if (result.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: result.model ?? DEFAULT_PI_MODEL
    };
  }
  const detail = String(result.error ?? "").trim() || "pi auth probe failed";
  if (PI_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS8.some((pattern) => pattern.test(detail))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: result.model ?? DEFAULT_PI_MODEL };
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
  defaultModel = null,
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
    stdout: "",
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"]
  });
  const resultError = parsed.resultEvent?.error ? String(parsed.resultEvent.error) : null;
  const providerError = parsed.providerError ?? null;
  const hasVisibleText = Boolean(parsed.response.trim());
  return {
    ok: result.status === 0 && !resultError && !providerError && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    // pi's session id comes from its structured `session` event; stdout is blanked so a UUID
    // in the answer prose can never be promoted to a fabricated id (stderr/file still allowed).
    sessionId: parsed.sessionId ?? resolvedSession.sessionId ?? null,
    model: parsed.model ?? model ?? defaultModel ?? DEFAULT_PI_MODEL,
    error: result.status === 0 ? resultError || providerError || (hasVisibleText ? null : "pi produced no visible text") : result.stderr.trim() || formatProviderExitError("pi", result.status),
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
  defaultModel = null,
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
      stdout: "",
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"]
    });
    const resultError = parsed.resultEvent?.error ? String(parsed.resultEvent.error) : null;
    const providerError = parsed.providerError ?? null;
    const hasVisibleText = Boolean(parsed.response.trim());
    return {
      ...result,
      ...parsed,
      // stdout blanked so a UUID in the answer prose is never promoted to a fabricated id.
      sessionId: parsed.sessionId ?? resolvedSession.sessionId ?? null,
      model: parsed.model ?? model ?? defaultModel ?? DEFAULT_PI_MODEL,
      ok: result.ok && !resultError && !providerError && hasVisibleText,
      error: result.ok ? resultError || providerError || (hasVisibleText ? null : "pi produced no visible text") : result.error
    };
  });
}

// packages/polycli-runtime/src/cmd.js
var CMD_BIN = process.env.CMD_CLI_BIN || "cmd";
var DEFAULT_CMD_MODEL = "deepseek";
var DEFAULT_TIMEOUT_MS9 = 9e5;
var AUTH_CHECK_TIMEOUT_MS9 = 3e4;
var CMD_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var TRANSIENT_PROBE_ERROR_PATTERNS9 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
function buildCmdInvocation({
  prompt,
  skipOnboarding = true,
  yolo = true,
  extraArgs = [],
  bin = CMD_BIN
} = {}) {
  const args = [];
  if (skipOnboarding) args.push("--skip-onboarding");
  if (yolo) args.push("--yolo");
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push("-p", String(prompt ?? ""));
  return { bin, args };
}
function extractCmdText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (event.type === "text_delta" && typeof event.delta === "string") {
    return event.delta;
  }
  if (event.type === "result" && typeof event.text === "string") {
    return event.text;
  }
  return "";
}
function textEventsFromStdout(stdout) {
  return String(stdout ?? "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim()).map((line) => ({ type: "text_delta", delta: line }));
}
function parseCmdTextResult(stdout) {
  const response = String(stdout ?? "").trim();
  const events = textEventsFromStdout(stdout);
  return { response, events };
}
function getCmdAvailability(cwd) {
  return binaryAvailable(CMD_BIN, ["--version"], { cwd });
}
function buildCmdAuthStatus(result) {
  const detail = `${result.stdout ?? ""}
${result.stderr ?? ""}`.trim();
  if (result.status === 0 && /\bauthenticated\b/i.test(detail)) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: DEFAULT_CMD_MODEL
    };
  }
  if (result.error) {
    const message = result.error.code === "ETIMEDOUT" ? `cmd auth probe timed out after ${Math.round(AUTH_CHECK_TIMEOUT_MS9 / 1e3)}s` : result.error.message;
    if (TRANSIENT_PROBE_ERROR_PATTERNS9.some((pattern) => pattern.test(message))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${message}`, model: DEFAULT_CMD_MODEL };
    }
    return { loggedIn: false, detail: message };
  }
  const fallback = detail || "cmd auth probe failed";
  if (CMD_EXPLICIT_AUTH_ERROR_RE.test(fallback)) {
    return { loggedIn: false, detail: fallback };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS9.some((pattern) => pattern.test(fallback))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${fallback}`, model: DEFAULT_CMD_MODEL };
  }
  return { loggedIn: false, detail: fallback };
}
function getCmdAuthStatus(cwd, { bin = CMD_BIN } = {}) {
  const result = runCommand(bin, ["status"], { cwd, timeout: AUTH_CHECK_TIMEOUT_MS9 });
  return buildCmdAuthStatus(result);
}
function runCmdPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS9,
  env = process.env,
  extraArgs = [],
  yolo = true,
  defaultModel = null,
  bin = CMD_BIN
} = {}) {
  const invocation = buildCmdInvocation({
    prompt,
    yolo,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout, env });
  if (result.error) {
    const error2 = result.error.code === "ETIMEDOUT" ? `cmd timed out after ${Math.round(timeout / 1e3)}s` : result.error.message;
    return {
      ok: false,
      error: error2,
      errorCode: classifyProviderFailure(error2, { provider: "cmd" })
    };
  }
  const parsed = parseCmdTextResult(result.stdout);
  const hasVisibleText = Boolean(parsed.response.trim());
  const error = result.status === 0 ? hasVisibleText ? null : "cmd produced no visible text" : result.stderr.trim() || formatProviderExitError("cmd", result.status);
  return {
    ok: result.status === 0 && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    // cmd stdout is pure assistant prose with no session-id field; never scan it for a
    // UUID, which would fabricate a sessionId from any UUID in the answer (cf. agy v0.6.18).
    sessionId: null,
    model: model ?? defaultModel ?? DEFAULT_CMD_MODEL,
    error,
    errorCode: classifyProviderFailure(error, { provider: "cmd" }),
    status: result.status
  };
}
function runCmdPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS9,
  env = process.env,
  extraArgs = [],
  yolo = true,
  defaultModel = null,
  onEvent = () => {
  },
  bin = CMD_BIN,
  spawnImpl
} = {}) {
  const invocation = buildCmdInvocation({
    prompt,
    yolo,
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
      const trimmed = line.trimEnd();
      if (!trimmed.trim()) return;
      onEvent({ type: "text_delta", delta: trimmed });
    }
  }).then((result) => {
    const parsed = parseCmdTextResult(result.stdout);
    const hasVisibleText = Boolean(parsed.response.trim());
    const error = result.ok ? hasVisibleText ? null : "cmd produced no visible text" : result.error;
    return {
      ...result,
      ...parsed,
      // cmd stdout is pure assistant prose with no session-id field; never scan it for a
      // UUID, which would fabricate a sessionId from any UUID in the answer (cf. agy v0.6.18).
      sessionId: null,
      model: model ?? defaultModel ?? DEFAULT_CMD_MODEL,
      ok: result.ok && hasVisibleText,
      error,
      errorCode: classifyProviderFailure(error, { provider: "cmd" })
    };
  });
}

// packages/polycli-runtime/src/agy.js
var AGY_BIN = process.env.AGY_CLI_BIN || "agy";
var DEFAULT_AGY_MODEL = null;
var DEFAULT_TIMEOUT_MS10 = 9e5;
var AUTH_CHECK_TIMEOUT_MS10 = 3e4;
var AGY_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var TRANSIENT_PROBE_ERROR_PATTERNS10 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
var AGY_BENIGN_STDERR_RE = /^Shell cwd was reset/i;
function buildAgyInvocation({
  prompt,
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  printTimeoutSeconds = null,
  extraArgs = [],
  bin = AGY_BIN
} = {}) {
  const args = [];
  if (yolo) args.push("--dangerously-skip-permissions");
  if (sandbox) args.push("--sandbox");
  if (resumeConversationId) {
    args.push("--conversation", resumeConversationId);
  } else if (continueLast) {
    args.push("--continue");
  }
  for (const dir of addDirs) {
    args.push("--add-dir", dir);
  }
  if (printTimeoutSeconds && Number.isFinite(printTimeoutSeconds)) {
    args.push("--print-timeout", `${Math.max(1, Math.round(printTimeoutSeconds))}s`);
  }
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push("-p", String(prompt ?? ""));
  return { bin, args };
}
function extractAgyText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (event.type === "text_delta" && typeof event.delta === "string") {
    return event.delta;
  }
  if (event.type === "result" && typeof event.text === "string") {
    return event.text;
  }
  return "";
}
function textEventsFromStdout2(stdout) {
  return String(stdout ?? "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim()).map((line) => ({ type: "text_delta", delta: line }));
}
function parseAgyTextResult(stdout) {
  const response = String(stdout ?? "").trim();
  const events = textEventsFromStdout2(stdout);
  return { response, events };
}
function stripAgyBenignStderr(stderr) {
  return String(stderr ?? "").split(/\r?\n/).filter((line) => line.trim() && !AGY_BENIGN_STDERR_RE.test(line.trim())).join("\n");
}
function getAgyAvailability(cwd, { bin = AGY_BIN } = {}) {
  return binaryAvailable(bin, ["--help"], { cwd });
}
function buildAgyAuthStatus(result) {
  const probeText = `${String(result.error ?? "")}
${String(result.response ?? "")}`.trim();
  if (AGY_EXPLICIT_AUTH_ERROR_RE.test(probeText)) {
    return { loggedIn: false, detail: probeText };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS10.some((pattern) => pattern.test(probeText))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${probeText}`, model: DEFAULT_AGY_MODEL };
  }
  if (result.ok || result.status === 0) {
    return { loggedIn: true, detail: "authenticated", model: DEFAULT_AGY_MODEL };
  }
  return { loggedIn: false, detail: probeText || "agy auth probe failed" };
}
function getAgyAuthStatus(cwd, { promptRunner = runAgyPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS10,
    yolo: true
  });
  return buildAgyAuthStatus(result);
}
function runAgyPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS10,
  env = process.env,
  extraArgs = [],
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  defaultModel = null,
  bin = AGY_BIN
} = {}) {
  const printTimeoutSeconds = Math.max(5, Math.floor((timeout - 5e3) / 1e3));
  const invocation = buildAgyInvocation({
    prompt,
    yolo,
    continueLast,
    resumeConversationId,
    sandbox,
    addDirs,
    printTimeoutSeconds,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout, env });
  if (result.error) {
    const error2 = result.error.code === "ETIMEDOUT" ? `agy timed out after ${Math.round(timeout / 1e3)}s` : result.error.message;
    return {
      ok: false,
      error: error2,
      errorCode: classifyProviderFailure(error2, { provider: "agy" })
    };
  }
  const parsed = parseAgyTextResult(result.stdout);
  const filteredStderr = stripAgyBenignStderr(result.stderr);
  const hasVisibleText = Boolean(parsed.response.trim());
  const error = result.status === 0 ? hasVisibleText ? null : "agy produced no visible text" : filteredStderr.trim() || formatProviderExitError("agy", result.status);
  return {
    ok: result.status === 0 && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    // agy stdout is pure assistant text and carries no session id; never scan
    // it for a UUID, which would fabricate one (spec: sessionId always null).
    sessionId: null,
    model: model ?? defaultModel ?? DEFAULT_AGY_MODEL,
    error,
    errorCode: classifyProviderFailure(error, { provider: "agy" }),
    status: result.status
  };
}
function runAgyPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS10,
  env = process.env,
  extraArgs = [],
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  defaultModel = null,
  onEvent = () => {
  },
  bin = AGY_BIN,
  spawnImpl
} = {}) {
  const printTimeoutSeconds = Math.max(5, Math.floor((timeout - 5e3) / 1e3));
  const invocation = buildAgyInvocation({
    prompt,
    yolo,
    continueLast,
    resumeConversationId,
    sandbox,
    addDirs,
    printTimeoutSeconds,
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
      const trimmed = line.trimEnd();
      if (!trimmed.trim()) return;
      onEvent({ type: "text_delta", delta: trimmed });
    }
  }).then((result) => {
    const parsed = parseAgyTextResult(result.stdout);
    const filteredStderr = stripAgyBenignStderr(result.stderr);
    const hasVisibleText = Boolean(parsed.response.trim());
    const error = result.ok ? hasVisibleText ? null : "agy produced no visible text" : filteredStderr.trim() || result.error;
    return {
      ...result,
      ...parsed,
      // See sync path: agy carries no session id; always null, never scraped.
      sessionId: null,
      model: model ?? defaultModel ?? DEFAULT_AGY_MODEL,
      ok: result.ok && hasVisibleText,
      error,
      errorCode: classifyProviderFailure(error, { provider: "agy" })
    };
  });
}

// packages/polycli-runtime/src/grok.js
var GROK_BIN = process.env.GROK_CLI_BIN || "grok";
var DEFAULT_TIMEOUT_MS11 = 9e5;
var AUTH_CHECK_TIMEOUT_MS11 = 3e4;
var DEFAULT_GROK_MODEL = "grok-4.5";
var GROK_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|not logged in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
var SUCCESS_STOP_REASONS = /* @__PURE__ */ new Set(["endturn", "end_turn", "stop", "stop_sequence", "complete", "completed", "done", "finished", "maxtokens", "max_tokens", "length"]);
var TRANSIENT_PROBE_ERROR_PATTERNS11 = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i
];
function buildGrokInvocation({
  prompt,
  model = null,
  outputFormat = "json",
  permissionMode = null,
  alwaysApprove = false,
  effort = null,
  resumeSessionId = null,
  continueLast = false,
  extraArgs = [],
  bin = GROK_BIN
} = {}) {
  const args = ["-p", String(prompt ?? ""), "--output-format", outputFormat];
  if (model) args.push("-m", model);
  if (effort) args.push("--effort", effort);
  if (permissionMode) args.push("--permission-mode", permissionMode);
  if (alwaysApprove) args.push("--always-approve");
  if (continueLast) {
    args.push("-c");
  } else if (resumeSessionId) {
    args.push("-r", resumeSessionId);
  }
  if (extraArgs.length > 0) args.push(...extraArgs);
  return { bin, args };
}
function extractGrokText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "text" && typeof event.data === "string") return event.data;
  return "";
}
function normalizeStopReason(stopReason) {
  return String(stopReason ?? "").trim().toLowerCase();
}
function isNonSuccessStopReason(stopReason) {
  if (stopReason == null || stopReason === "") return false;
  return !SUCCESS_STOP_REASONS.has(normalizeStopReason(stopReason));
}
function extractTerminalError(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.error === "string" && value.error.trim()) return value.error.trim();
  if (value.error && typeof value.error === "object") {
    const nested = extractTerminalError(value.error);
    if (nested) return nested;
    if (typeof value.error.message === "string" && value.error.message.trim()) return value.error.message.trim();
    if (typeof value.error.data === "string" && value.error.data.trim()) return value.error.data.trim();
    return Object.keys(value.error).length > 0 ? "grok emitted a terminal error" : null;
  }
  if (value.is_error === true || value.isError === true || value.type === "error") {
    if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
    if (typeof value.data === "string" && value.data.trim()) return value.data.trim();
    return "grok emitted a terminal error";
  }
  return null;
}
function parseGrokStreamText(text) {
  const events = [];
  let response = "";
  let sessionId = null;
  let stopReason = null;
  let providerError = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    events.push(event);
    providerError = providerError || extractTerminalError(event);
    if (event.type === "text" && typeof event.data === "string") {
      response += event.data;
    } else if (event.type === "end") {
      if (typeof event.sessionId === "string") sessionId = event.sessionId;
      stopReason = event.stopReason ?? stopReason;
    }
  }
  return { events, response, sessionId, stopReason, providerError };
}
function parseGrokJsonResult(stdout, stderr, status, { defaultModel = null } = {}) {
  const text = String(stdout ?? "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0 || status !== 0) {
    return {
      ok: false,
      error: String(stderr ?? "").trim() || formatProviderExitError("grok", status),
      status
    };
  }
  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    const response = typeof parsed.text === "string" ? parsed.text : "";
    const hasVisibleText = Boolean(response.trim());
    const providerError = extractTerminalError(parsed);
    const stopReason = parsed.stopReason ?? null;
    const stopReasonError = isNonSuccessStopReason(stopReason) ? `grok stopped with ${stopReason}` : null;
    const error = providerError || stopReasonError || (hasVisibleText ? null : "grok produced no visible text");
    return {
      ok: hasVisibleText && !providerError && !stopReasonError,
      response,
      // grok emits the session id structurally; never scan prose for a UUID.
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      model: defaultModel ?? DEFAULT_GROK_MODEL,
      stopReason,
      error,
      status
    };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${error.message}`, status };
  }
}
function getGrokAvailability(cwd) {
  return binaryAvailable(GROK_BIN, ["--version"], { cwd });
}
function buildGrokAuthStatus(result) {
  if (result.error) {
    const detail = result.error.code === "ETIMEDOUT" ? `grok auth probe timed out after ${Math.round(AUTH_CHECK_TIMEOUT_MS11 / 1e3)}s` : result.error.message;
    if (TRANSIENT_PROBE_ERROR_PATTERNS11.some((pattern) => pattern.test(detail))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
    }
    return { loggedIn: false, detail };
  }
  const text = `${result.stdout ?? ""}
${result.stderr ?? ""}`;
  const defaultModel = (text.match(/Default model:\s*(\S+)/) || [])[1] ?? null;
  if (GROK_EXPLICIT_AUTH_ERROR_RE.test(text)) {
    return { loggedIn: false, detail: text.trim() || "grok is not logged in" };
  }
  if (/\blogged in\b/i.test(text)) {
    return { loggedIn: true, detail: "authenticated", model: defaultModel };
  }
  if (result.status !== 0) {
    const detail = text.trim() || `grok models exited with code ${result.status}`;
    if (TRANSIENT_PROBE_ERROR_PATTERNS11.some((pattern) => pattern.test(detail))) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: defaultModel };
    }
    return { loggedIn: false, detail };
  }
  return { loggedIn: true, detail: "authenticated", model: defaultModel };
}
function getGrokAuthStatus(cwd, { runner = runCommand } = {}) {
  const result = runner(GROK_BIN, ["models"], { cwd, timeout: AUTH_CHECK_TIMEOUT_MS11 });
  return buildGrokAuthStatus(result);
}
function runGrokPrompt({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS11,
  alwaysApprove = true,
  permissionMode = null,
  effort = null,
  resumeSessionId = null,
  continueLast = false,
  extraArgs = [],
  defaultModel = null,
  bin = GROK_BIN
} = {}) {
  const invocation = buildGrokInvocation({
    prompt,
    model,
    outputFormat: "json",
    permissionMode,
    alwaysApprove,
    effort,
    resumeSessionId,
    continueLast,
    extraArgs,
    bin
  });
  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout });
  if (result.error) {
    const error = result.error.code === "ETIMEDOUT" ? `grok timed out after ${Math.round(timeout / 1e3)}s` : result.error.message;
    return { ok: false, error, errorCode: classifyProviderFailure(error, { provider: "grok" }) };
  }
  const parsed = parseGrokJsonResult(result.stdout, result.stderr, result.status, {
    defaultModel: model ?? defaultModel
  });
  return { ...parsed, errorCode: classifyProviderFailure(parsed.error, { provider: "grok" }) };
}
function runGrokPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS11,
  alwaysApprove = true,
  permissionMode = null,
  effort = null,
  resumeSessionId = null,
  continueLast = false,
  extraArgs = [],
  defaultModel = null,
  onEvent = () => {
  },
  bin = GROK_BIN,
  spawnImpl
} = {}) {
  const invocation = buildGrokInvocation({
    prompt,
    model,
    outputFormat: "streaming-json",
    permissionMode,
    alwaysApprove,
    effort,
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
    const parsed = parseGrokStreamText(result.stdout);
    const hasVisibleText = Boolean(parsed.response.trim());
    const stopReasonError = isNonSuccessStopReason(parsed.stopReason) ? `grok stopped with ${parsed.stopReason}` : null;
    const ok = result.ok && hasVisibleText && !parsed.providerError && !stopReasonError;
    const error = ok ? null : parsed.providerError || stopReasonError || (result.ok ? "grok produced no visible text" : result.error);
    return {
      ...result,
      ...parsed,
      model: model ?? defaultModel ?? DEFAULT_GROK_MODEL,
      ok,
      error,
      errorCode: classifyProviderFailure(error, { provider: "grok" })
    };
  });
}

// packages/polycli-runtime/src/registry.js
import { performance } from "node:perf_hooks";

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
    if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) {
      throw new Error(`Percentile must be between 0 and 100: ${percentile}`);
    }
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
var TIMING_OUTCOMES = ["success", "failure", "timeout", "terminated", "cancelled"];
var RFC3339_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const match = value.match(RFC3339_DATE_TIME);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === void 0 ? null : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === void 0 ? null : Number(offsetMinuteText);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1] && hour <= 23 && minute <= 59 && second <= 60 && (offsetHour === null || offsetHour <= 23 && offsetMinute <= 59);
}
function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function hasOwn(record, field) {
  return Object.prototype.hasOwnProperty.call(record, field);
}
function validateOptionalString(record, field, errors, { nonEmpty = false } = {}) {
  if (!hasOwn(record, field)) return;
  if (typeof record[field] !== "string" || nonEmpty && record[field].length === 0) {
    errors.push(`${field} must be ${nonEmpty ? "a non-empty string" : "a string"}`);
  }
}
function validateDeclaredOptionalFields(record, errors) {
  validateOptionalString(record, "providerVersion", errors);
  validateOptionalString(record, "kind", errors);
  validateOptionalString(record, "terminationReason", errors, { nonEmpty: true });
  validateOptionalString(record, "errorCode", errors, { nonEmpty: true });
  if (hasOwn(record, "outcome") && !TIMING_OUTCOMES.includes(record.outcome)) {
    errors.push(`outcome must be one of ${TIMING_OUTCOMES.join(", ")}`);
  }
  if (hasOwn(record, "exitCode") && !Number.isInteger(record.exitCode)) {
    errors.push("exitCode must be an integer");
  }
  if (hasOwn(record, "responseMatched") && typeof record.responseMatched !== "boolean") {
    errors.push("responseMatched must be a boolean");
  }
  if (hasOwn(record, "meta") && (!record.meta || typeof record.meta !== "object" || Array.isArray(record.meta))) {
    errors.push("meta must be an object");
  }
}
function validateMetric(name, metric, errors) {
  if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
    errors.push(`metrics.${name} must be an object`);
    return;
  }
  for (const key of Object.keys(metric)) {
    if (key !== "status" && key !== "ms") {
      errors.push(`metrics.${name}.${key} is not allowed`);
    }
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
  validateDeclaredOptionalFields(record, errors);
  if (!record.metrics || typeof record.metrics !== "object" || Array.isArray(record.metrics)) {
    errors.push("metrics must be an object");
  } else {
    for (const metricName of Object.keys(record.metrics)) {
      if (!TIMING_METRIC_NAMES.includes(metricName)) {
        errors.push(`metrics.${metricName} is not allowed`);
      }
    }
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
var COHORT_DIMENSIONS = Object.freeze([
  "provider",
  "kind",
  "measurementScope",
  "outcome",
  "runtimePersistence"
]);
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
function createMetricsSummary() {
  return Object.fromEntries(TIMING_METRIC_NAMES.map((name) => [name, createMetricSummary()]));
}
function createProviderSummary() {
  return {
    recordCount: 0,
    runtimePersistenceCounts: Object.fromEntries(TIMING_RUNTIME_PERSISTENCE.map((name) => [name, 0])),
    measurementScopeCounts: Object.fromEntries(TIMING_MEASUREMENT_SCOPES.map((name) => [name, 0])),
    cohortCount: 0,
    mixedDimensions: [],
    metrics: createMetricsSummary()
  };
}
function getCohortDimensions(record) {
  return {
    provider: record.provider,
    kind: record.kind ?? null,
    measurementScope: record.measurementScope,
    outcome: record.outcome ?? null,
    runtimePersistence: record.runtimePersistence
  };
}
function getCohortKey(dimensions) {
  return JSON.stringify(COHORT_DIMENSIONS.map((name) => dimensions[name]));
}
function createCohort(dimensions) {
  return {
    provider: dimensions.provider,
    kind: dimensions.kind,
    measurementScope: dimensions.measurementScope,
    outcome: dimensions.outcome,
    runtimePersistence: dimensions.runtimePersistence,
    recordCount: 0,
    metrics: createMetricsSummary()
  };
}
function addMetric(metricSummary, metric) {
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
function addRecordMetrics(summary, record) {
  for (const metricName of TIMING_METRIC_NAMES) {
    addMetric(summary.metrics[metricName], record.metrics[metricName]);
  }
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
function finalizeMetrics(summary) {
  for (const metricName of TIMING_METRIC_NAMES) {
    summary.metrics[metricName] = finalizeMetric(summary.metrics[metricName]);
  }
}
function finalizeProviderCohorts(providerSummary, cohorts) {
  providerSummary.cohortCount = cohorts.length;
  providerSummary.mixedDimensions = COHORT_DIMENSIONS.filter(
    (dimension) => dimension !== "provider" && new Set(cohorts.map((cohort) => cohort[dimension])).size > 1
  );
}
function aggregateTimingRecords(records) {
  const summary = {
    recordCount: 0,
    invalidRecords: [],
    byProvider: {},
    cohortDimensions: [...COHORT_DIMENSIONS],
    cohorts: []
  };
  const cohortsByKey = /* @__PURE__ */ new Map();
  const cohortsByProvider = /* @__PURE__ */ new Map();
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
    const cohortDimensions = getCohortDimensions(record);
    const cohortKey = getCohortKey(cohortDimensions);
    let cohort = cohortsByKey.get(cohortKey);
    if (!cohort) {
      cohort = createCohort(cohortDimensions);
      cohortsByKey.set(cohortKey, cohort);
      summary.cohorts.push(cohort);
      const providerCohorts = cohortsByProvider.get(provider) ?? [];
      providerCohorts.push(cohort);
      cohortsByProvider.set(provider, providerCohorts);
    }
    cohort.recordCount += 1;
    addRecordMetrics(providerSummary, record);
    addRecordMetrics(cohort, record);
  }
  for (const [provider, providerSummary] of Object.entries(summary.byProvider)) {
    finalizeMetrics(providerSummary);
    finalizeProviderCohorts(providerSummary, cohortsByProvider.get(provider) ?? []);
  }
  for (const cohort of summary.cohorts) {
    finalizeMetrics(cohort);
  }
  return summary;
}

// packages/polycli-timing/src/index.js
var TIMING_SCHEMA_URL = new URL("../timing.schema.json", import.meta.url);

// packages/polycli-runtime/src/timing.js
var TIMING_OUTCOMES2 = /* @__PURE__ */ new Set(["success", "failure", "timeout", "terminated", "cancelled"]);
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
  if (!Number.isFinite(ms) || ms < 0) {
    return missingMetric();
  }
  return measuredOrZero(ms);
}
function errorText(result) {
  if (typeof result?.error === "string") return result.error;
  if (result?.error?.message) return result.error.message;
  return "";
}
function normalizeExitCode(value) {
  return Number.isInteger(value) ? value : null;
}
function inferTimingOutcome(result) {
  if (result?.ok) return "success";
  const exitCode = normalizeExitCode(result?.status ?? result?.exitCode);
  const text = errorText(result);
  if (result?.timedOut || exitCode === 124 || /\b(timed out|timeout)\b/i.test(text)) return "timeout";
  if (result?.aborted || exitCode === 130 || /\b(interrupted|aborted|cancelled|canceled)\b/i.test(text)) {
    return "cancelled";
  }
  if (result?.signal || exitCode === 143 || /\bterminated\b/i.test(text)) return "terminated";
  return "failure";
}
function inferTerminationReason(result, outcome, exitCode) {
  if (result?.terminationReason) return result.terminationReason;
  if (outcome === "timeout") return "timeout";
  if (outcome === "cancelled") return "cancelled";
  if (result?.signal) return `signal:${result.signal}`;
  if (outcome === "terminated") return "terminated";
  if (exitCode != null && exitCode !== 0) return `exit_code:${exitCode}`;
  return null;
}
function buildTimingDiagnostics(result, explicit = {}) {
  const exitCode = normalizeExitCode(explicit.exitCode ?? result?.status ?? result?.exitCode);
  const outcome = explicit.outcome ?? inferTimingOutcome(result);
  return {
    outcome,
    exitCode,
    terminationReason: explicit.terminationReason ?? inferTerminationReason(result, outcome, exitCode),
    responseMatched: explicit.responseMatched,
    errorCode: explicit.errorCode ?? result?.errorCode
  };
}
function addStringField(record, key, value) {
  if (typeof value === "string" && value.trim()) {
    record[key] = value;
  }
}
function addIntegerField(record, key, value) {
  if (Number.isInteger(value)) {
    record[key] = value;
  }
}
function addBooleanField(record, key, value) {
  if (typeof value === "boolean") {
    record[key] = value;
  }
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
  if (provider === "cmd") return extractCmdText(event);
  if (provider === "agy") return extractAgyText(event);
  if (provider === "grok") return extractGrokText(event);
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
  meta = null,
  outcome = null,
  exitCode = null,
  terminationReason = null,
  responseMatched = null,
  errorCode = null
} = {}) {
  const metrics = {
    cold: unsupportedMetric(),
    ttft: capabilityMetric(ttftMs, Boolean(supportedMetrics.ttft)),
    gen: capabilityMetric(
      Number.isFinite(ttftMs) ? totalMs - ttftMs : null,
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
  if (TIMING_OUTCOMES2.has(outcome)) {
    record.outcome = outcome;
  }
  addIntegerField(record, "exitCode", exitCode);
  addStringField(record, "terminationReason", terminationReason);
  addBooleanField(record, "responseMatched", responseMatched);
  addStringField(record, "errorCode", errorCode);
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
  meta = null,
  outcome = null,
  exitCode = null,
  terminationReason = null,
  responseMatched = null,
  errorCode = null
} = {}) {
  const diagnostics = buildTimingDiagnostics(result, {
    outcome,
    exitCode,
    terminationReason,
    responseMatched,
    errorCode
  });
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
      ...diagnostics,
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
  pi: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  cmd: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "ephemeral" },
  agy: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  grok: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" }
};
var RUNTIMES = Object.freeze({
  claude: {
    id: "claude",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "status",
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
      authProbeCost: "model",
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
      authProbeCost: "model",
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
      authProbeCost: "model",
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
      authProbeCost: "model",
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
      structuredOutput: true,
      authProbeCost: "status",
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
      authProbeCost: "model",
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
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getPiAvailability,
    getAuthStatus: getPiAuthStatus,
    runPrompt: runPiPrompt,
    runPromptStreaming: runPiPromptStreaming
  },
  cmd: {
    id: "cmd",
    capabilities: {
      streaming: true,
      sessionResume: false,
      structuredOutput: false,
      authProbeCost: "status",
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getCmdAvailability,
    getAuthStatus: getCmdAuthStatus,
    runPrompt: runCmdPrompt,
    runPromptStreaming: runCmdPromptStreaming
  },
  agy: {
    id: "agy",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: false,
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getAgyAvailability,
    getAuthStatus: getAgyAuthStatus,
    runPrompt: runAgyPrompt,
    runPromptStreaming: runAgyPromptStreaming
  },
  grok: {
    id: "grok",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "status",
      operations: PROVIDER_OPERATION_NAMES
    },
    getAvailability: getGrokAvailability,
    getAuthStatus: getGrokAuthStatus,
    runPrompt: runGrokPrompt,
    runPromptStreaming: runGrokPromptStreaming
  }
});
for (const runtime of Object.values(RUNTIMES)) {
  Object.freeze(runtime.capabilities);
  Object.freeze(runtime);
}
function getTimingSupport(provider) {
  return TIMING_SUPPORT[provider] || {
    ttft: false,
    gen: false,
    tail: false,
    tool: false,
    runtimePersistence: "ephemeral"
  };
}
function getTimingSupportForRun(provider, options = {}) {
  const support = getTimingSupport(provider);
  if (provider === "claude" && options.executionMode === "tmux-tui") {
    return { ...support, ttft: false, gen: false, tail: false };
  }
  return support;
}
function inferRuntimePersistence(provider, result) {
  const support = getTimingSupport(provider);
  return support.runtimePersistence;
}
function buildTimingMeta(provider, result, meta, support = getTimingSupport(provider)) {
  const merged = {
    ...meta || {},
    ...result?.timingMeta || {}
  };
  if (provider === "claude" && result?.detached === true) {
    merged.tmuxDetached = true;
    merged.timingScope = merged.timingScope || "tmux_startup";
    merged.llmCompletionObserved = false;
  }
  if (support.runtimePersistence === "session" && !result?.sessionId) {
    merged.sessionIdMissing = true;
  }
  return Object.keys(merged).length > 0 ? merged : null;
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
  if (provider === "grok") {
    return event.type === "end";
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
function applyModelFallback(result, { model = null, defaultModel = null } = {}) {
  if (result.model) return result;
  const fallbackModel = model || defaultModel;
  return fallbackModel ? { ...result, model: fallbackModel } : result;
}
async function runProviderPromptStreaming({
  provider,
  kind = "prompt",
  measurementScope = "request",
  meta = null,
  defaultModel = null,
  onEvent,
  nowMs = () => performance.now(),
  runtime = null,
  ...options
}) {
  const startedAt = nowMs();
  const timingSupport = getTimingSupportForRun(provider, options);
  const selectedRuntime = runtime ?? getProviderRuntime(provider);
  let firstTextAt = null;
  let lastTextAt = null;
  const toolState = { pendingTools: /* @__PURE__ */ new Map(), toolMs: null };
  const result = await selectedRuntime.runPromptStreaming({
    ...options,
    defaultModel,
    onEvent(event) {
      const now = nowMs();
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
  const finishedAt = nowMs();
  const resultWithModel = applyModelFallback(result, {
    model: options.model,
    defaultModel
  });
  const runtimePersistence = inferRuntimePersistence(provider, resultWithModel);
  return attachPromptTiming(resultWithModel, {
    provider,
    kind,
    runtimePersistence,
    measurementScope,
    totalMs: finishedAt - startedAt,
    ttftMs: firstTextAt == null ? null : firstTextAt - startedAt,
    tailMs: lastTextAt == null ? null : Math.max(finishedAt - lastTextAt, 0),
    toolMs: toolState.toolMs,
    supportedMetrics: timingSupport,
    meta: buildTimingMeta(provider, result, meta, timingSupport)
  });
}

// packages/polycli-runtime/src/review-flags.js
var REVIEW_FLAG_EXPECTATIONS = Object.freeze({
  claude: Object.freeze({
    expectFlags: Object.freeze(["--tools", "--mcp-config", "--strict-mcp-config"]),
    extraArgTokens: Object.freeze(["--tools", "--mcp-config", "--strict-mcp-config"]),
    readOnlyOptionKey: "permissionMode",
    readOnlyValue: "plan",
    stopReviewGateSafety: "enforced"
  }),
  gemini: Object.freeze({
    expectFlags: Object.freeze(["--approval-mode", "--policy"]),
    extraArgTokens: Object.freeze(["--extensions", "--allowed-mcp-server-names"]),
    readOnlyOptionKey: "approvalMode",
    readOnlyValue: "plan",
    stopReviewGateSafety: "enforced"
  }),
  qwen: Object.freeze({
    expectFlags: Object.freeze(["--approval-mode", "--exclude-tools", "--max-session-turns"]),
    // Qwen Code 0.19.6 emits a minimal bare `qwen --help` page.
    // Supplying one registered option reveals the complete headless option
    // surface, but that option itself is omitted from the rendered help. Use
    // complementary, side-effect-free help probes so the drift check verifies
    // every invocation flag without issuing a model request.
    probes: Object.freeze([
      Object.freeze({
        helpArgs: Object.freeze(["--approval-mode", "plan", "--help"]),
        expect: Object.freeze(["--exclude-tools", "--max-session-turns"])
      }),
      Object.freeze({
        helpArgs: Object.freeze(["--max-session-turns", "1", "--help"]),
        expect: Object.freeze(["--approval-mode"])
      })
    ]),
    extraArgTokens: Object.freeze(["--exclude-tools"]),
    readOnlyOptionKey: "approvalMode",
    readOnlyValue: "plan",
    stopReviewGateSafety: "enforced"
  }),
  copilot: Object.freeze({
    expectFlags: Object.freeze([
      "--excluded-tools",
      "--allow-all-tools",
      "--allow-all-paths",
      "--allow-all-urls",
      "--no-ask-user"
    ]),
    extraArgTokens: Object.freeze(["--excluded-tools"]),
    readOnlyOptionKeys: Object.freeze(["allowAllTools", "allowAllPaths", "allowAllUrls"]),
    readOnlyValue: null,
    stopReviewGateSafety: "enforced"
  }),
  opencode: Object.freeze({
    expectFlags: Object.freeze(["--agent"]),
    extraArgTokens: Object.freeze(["--agent"]),
    readOnlyOptionKey: "skipPermissions",
    readOnlyValue: null,
    stopReviewGateSafety: "enforced"
  }),
  pi: Object.freeze({
    expectFlags: Object.freeze([
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-context-files"
    ]),
    extraArgTokens: Object.freeze([
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-context-files"
    ]),
    readOnlyOptionKey: null,
    readOnlyValue: null,
    stopReviewGateSafety: "enforced"
  }),
  cmd: Object.freeze({
    expectFlags: Object.freeze(["--permission-mode"]),
    extraArgTokens: Object.freeze(["--permission-mode"]),
    readOnlyOptionKey: "yolo",
    readOnlyValue: null,
    stopReviewGateSafety: "enforced"
  }),
  kimi: Object.freeze({
    // No independently verified flag-based no-tool/read-only lever is available for Kimi prompt
    // mode, so review is prompt-only (extraArgTokens empty, like minimax). expectFlags are the
    // load-bearing invocation flags the runtime depends on
    // (-p/--prompt + --output-format), so the drift check warns if kimi-code renames or drops them.
    expectFlags: Object.freeze(["--prompt", "--output-format"]),
    extraArgTokens: Object.freeze([]),
    stopReviewGateSafety: "prompt_only"
  }),
  agy: Object.freeze({
    // agy 1.1.2 exposes `--mode plan`, but the non-interactive `-p` path has
    // no verified hard no-write/no-command guarantee. Keep /review rejected
    // until that guarantee is independently proven without yolo permissions.
    expectFlags: Object.freeze(["--mode"]),
    extraArgTokens: Object.freeze([]),
    reviewUnsupported: true,
    stopReviewGateSafety: "unsupported"
  }),
  minimax: Object.freeze({
    expectFlags: Object.freeze([]),
    extraArgTokens: Object.freeze([]),
    probes: Object.freeze([
      Object.freeze({ helpArgs: Object.freeze(["text", "chat", "--help"]), expect: Object.freeze(["--message"]) }),
      Object.freeze({ helpArgs: Object.freeze(["--help"]), expect: Object.freeze(["--output", "--non-interactive"]) })
    ]),
    stopReviewGateSafety: "prompt_only"
  }),
  grok: Object.freeze({
    // grok review enforces read-only via the --permission-mode plan runtimeOption (composes with
    // the -p one-shot mode, verified). It carries no review extraArgs of its own.
    expectFlags: Object.freeze(["--permission-mode"]),
    extraArgTokens: Object.freeze([]),
    readOnlyOptionKey: "permissionMode",
    readOnlyValue: "plan",
    stopReviewGateSafety: "enforced"
  })
});

// plugins/polycli/scripts/lib/job-control.mjs
import fs6 from "node:fs";
import os4 from "node:os";
import process4 from "node:process";
import { spawnSync as spawnSync3 } from "node:child_process";

// plugins/polycli/scripts/lib/state.mjs
import crypto2 from "node:crypto";
import fs3 from "node:fs";
import os2 from "node:os";
import path3 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
var STATE_VERSION = 1;
var STATE_FILE_NAME = "state.json";
var JOBS_DIR_NAME = "jobs";
var MAX_JOBS = 100;
var POLYCLI_STATE_ROOT_ENV = "POLYCLI_STATE_ROOT";
var PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
var PRIVATE_DIR_MODE = 448;
var PRIVATE_FILE_MODE = 384;
var ACTIVE_STATUSES = /* @__PURE__ */ new Set(["queued", "running"]);
var FALLBACK_STATE_ROOT = path3.join(os2.homedir() || os2.tmpdir(), ".polycli", "state");
function runCommand2(command, args = [], options = {}) {
  const result = spawnSync2(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout,
    stdio: options.stdio ?? "pipe"
  });
  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}
function computeWorkspaceSlug(workspaceRoot) {
  const base = path3.basename(workspaceRoot).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "workspace";
  const hash = crypto2.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
  return `${base}-${hash}`;
}
function defaultState() {
  return {
    version: STATE_VERSION,
    config: {},
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
function describeStateRoot() {
  const polycliStateRoot = process.env[POLYCLI_STATE_ROOT_ENV];
  if (polycliStateRoot) {
    return {
      stateRoot: path3.resolve(polycliStateRoot),
      source: POLYCLI_STATE_ROOT_ENV
    };
  }
  const pluginData = process.env[PLUGIN_DATA_ENV];
  if (pluginData) {
    return {
      stateRoot: path3.join(pluginData, "state"),
      source: PLUGIN_DATA_ENV
    };
  }
  return {
    stateRoot: FALLBACK_STATE_ROOT,
    source: "home"
  };
}
function stateRootDir() {
  return describeStateRoot().stateRoot;
}
function resolveWorkspaceRoot(cwd = process.cwd()) {
  const result = runCommand2("git", ["rev-parse", "--show-toplevel"], { cwd });
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
function chmodPrivateDir(dir) {
  try {
    fs3.chmodSync(dir, PRIVATE_DIR_MODE);
  } catch {
  }
}
function ensurePrivateDir(dir) {
  fs3.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodPrivateDir(dir);
}
function ensureStateDir(workspaceRoot) {
  ensurePrivateDir(stateRootDir());
  ensurePrivateDir(resolveStateDir(workspaceRoot));
  ensurePrivateDir(resolveJobsDir(workspaceRoot));
}
function pruneJobsForSave(jobs, { preserveJobIds = [] } = {}) {
  const sorted = jobs.slice().sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
  const active = sorted.filter((job) => ACTIVE_STATUSES.has(job.status));
  const terminal = sorted.filter((job) => !ACTIVE_STATUSES.has(job.status));
  const preserve = new Set(preserveJobIds);
  const protectedTerminal = terminal.filter((job) => preserve.has(job.jobId));
  const remainingTerminal = terminal.filter((job) => !preserve.has(job.jobId));
  const retainedTerminal = [
    ...protectedTerminal,
    ...remainingTerminal.slice(0, Math.max(0, MAX_JOBS - protectedTerminal.length))
  ];
  return [...active, ...retainedTerminal].sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
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
      config: parsed.config && typeof parsed.config === "object" ? parsed.config : {},
      jobs: parsed.jobs
    };
  } catch {
    backupCorruptStateFile(stateFile);
    return defaultState();
  }
}
function saveState(workspaceRoot, state, { preserveJobIds = [] } = {}) {
  ensureStateDir(workspaceRoot);
  const jobs = pruneJobsForSave(state.jobs, { preserveJobIds });
  const keptIds = new Set(jobs.map((job) => job.jobId));
  const config = state.config && typeof state.config === "object" ? state.config : {};
  writeJsonAtomic(resolveStateFile(workspaceRoot), { version: STATE_VERSION, config, jobs }, { mode: PRIVATE_FILE_MODE });
  for (const job of state.jobs) {
    if (job && job.jobId && !keptIds.has(job.jobId)) {
      removeJobFile(workspaceRoot, job.jobId);
      removeJobConfigFile(workspaceRoot, job.jobId);
      removeJobLogFile(workspaceRoot, job.jobId);
    }
  }
  return { version: STATE_VERSION, config, jobs };
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
    const currentEnvelope = readJobFile(resolveJobFile(workspaceRoot, jobId));
    const next = buildNext(current, currentEnvelope);
    if (!next) {
      return { written: false, job: current, envelope: null };
    }
    const job = next.job ?? current;
    if (!job) {
      return { written: false, job: null, envelope: next.envelope ?? null };
    }
    if (Object.prototype.hasOwnProperty.call(next, "envelope")) {
      writeJsonAtomic(resolveJobFile(workspaceRoot, jobId), next.envelope, { mode: PRIVATE_FILE_MODE });
    }
    if (typeof next.beforeStateCommit === "function") {
      next.beforeStateCommit({
        current,
        job,
        envelope: next.envelope ?? null
      });
    }
    if (index >= 0) {
      state.jobs[index] = job;
    } else {
      state.jobs.push(job);
    }
    saveState(workspaceRoot, state, { preserveJobIds: [jobId] });
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
function getConfig(workspaceRoot) {
  return loadState(workspaceRoot).config || {};
}
function setConfig(workspaceRoot, key, value) {
  updateState(workspaceRoot, (state) => {
    state.config = state.config || {};
    state.config[key] = value;
  });
}
function recordLastUsedProvider(workspaceRoot, provider) {
  if (typeof provider !== "string" || !provider.trim()) return;
  updateState(workspaceRoot, (state) => {
    state.config = state.config || {};
    state.config.lastUsedProvider = provider.trim();
    state.config.lastUsedProviderAt = (/* @__PURE__ */ new Date()).toISOString();
  });
}
function readJobFile(jobFile) {
  try {
    return JSON.parse(fs3.readFileSync(jobFile, "utf8"));
  } catch {
    return null;
  }
}
function removeJobFile(workspaceRoot, jobId) {
  try {
    fs3.unlinkSync(resolveJobFile(workspaceRoot, jobId));
  } catch {
  }
}
function writeJobConfigFile(workspaceRoot, jobId, payload) {
  ensureStateDir(workspaceRoot);
  writeJsonAtomic(resolveJobConfigFile(workspaceRoot, jobId), payload, { mode: PRIVATE_FILE_MODE });
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
function removeJobLogFile(workspaceRoot, jobId) {
  try {
    fs3.unlinkSync(resolveJobLogFile(workspaceRoot, jobId));
  } catch {
  }
}

// plugins/polycli/scripts/lib/run-ledger.mjs
import { randomUUID as randomUUID2 } from "node:crypto";
import path4 from "node:path";

// packages/polycli-utils/src/ndjson.js
import fs4 from "node:fs";
function safeParseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
function retainCompactedLines(lines, keepFrom, retentionGroupKey) {
  const entries = [];
  for (const line of lines) {
    const record = safeParseLine(line);
    if (record != null) {
      entries.push({ line, record });
    }
  }
  if (typeof retentionGroupKey !== "function") {
    return entries.slice(keepFrom).map((entry) => entry.line);
  }
  const grouped = entries.map((entry) => ({
    ...entry,
    retentionGroup: retentionGroupKey(entry.record)
  }));
  const retainedStart = keepFrom < 0 ? Math.max(0, grouped.length + keepFrom) : Math.min(keepFrom, grouped.length);
  const retainedGroups = new Set(
    grouped.slice(keepFrom).map((entry) => entry.retentionGroup).filter((group) => group != null)
  );
  return grouped.filter((entry, index) => index >= retainedStart || entry.retentionGroup != null && retainedGroups.has(entry.retentionGroup)).map((entry) => entry.line);
}
function chmodIfRequested(filePath, mode) {
  if (mode === 438) return;
  try {
    fs4.chmodSync(filePath, mode);
  } catch {
  }
}
function readNdjson(filePath) {
  let text;
  try {
    text = fs4.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  if (text.length === 0) {
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
function appendNdjson(filePath, record, {
  timeoutMs = 1e4,
  staleMs = 3e4,
  pollMs = 25,
  maxBytes = null,
  keepRatio = 0.5,
  retentionGroupKey = null,
  mode = 438
} = {}) {
  const lockPath = `${filePath}.lock`;
  return withLockfile(lockPath, () => {
    ensureParentDir(filePath);
    let needsLeadingNewline = false;
    try {
      const stat = fs4.statSync(filePath);
      if (stat.size > 0) {
        const fd = fs4.openSync(filePath, "r");
        const lastByte = Buffer.alloc(1);
        try {
          fs4.readSync(fd, lastByte, 0, 1, stat.size - 1);
        } finally {
          fs4.closeSync(fd);
        }
        needsLeadingNewline = lastByte[0] !== 10;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    const line = `${needsLeadingNewline ? "\n" : ""}${JSON.stringify(record)}
`;
    fs4.appendFileSync(filePath, line, { encoding: "utf8", mode });
    chmodIfRequested(filePath, mode);
    if (maxBytes != null) {
      const stat = fs4.statSync(filePath);
      if (stat.size > maxBytes) {
        const lines = fs4.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
        const validCount = lines.reduce((count, entry) => count + (safeParseLine(entry) != null ? 1 : 0), 0);
        const keepFrom = Math.floor(validCount * (1 - keepRatio));
        const kept = retainCompactedLines(lines, keepFrom, retentionGroupKey);
        writeFileAtomic(filePath, `${kept.join("\n")}
`, { encoding: "utf8", mode });
        chmodIfRequested(filePath, mode);
      }
    }
    return true;
  }, { timeoutMs, staleMs, pollMs });
}
function appendNdjsonBatch(filePath, records, {
  timeoutMs = 1e4,
  staleMs = 3e4,
  pollMs = 25,
  maxBytes = null,
  keepRatio = 0.5,
  retentionGroupKey = null,
  mode = 438
} = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("records must be an array");
  }
  if (records.length === 0) {
    return true;
  }
  const serializedBatch = records.map((record) => {
    const serialized = JSON.stringify(record);
    if (typeof serialized !== "string") {
      throw new TypeError("each record must be JSON-serializable");
    }
    return serialized;
  });
  const batch = `${serializedBatch.join("\n")}
`;
  const lockPath = `${filePath}.lock`;
  return withLockfile(lockPath, () => {
    ensureParentDir(filePath);
    let text = "";
    try {
      text = fs4.readFileSync(filePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    let nextText = `${text}${text.length > 0 && !text.endsWith("\n") ? "\n" : ""}${batch}`;
    if (maxBytes != null && Buffer.byteLength(nextText, "utf8") > maxBytes) {
      const existing = text.split("\n").filter((entry) => safeParseLine(entry) != null);
      const targetCount = Math.max(
        serializedBatch.length,
        Math.ceil((existing.length + serializedBatch.length) * keepRatio)
      );
      const allLines = [...existing, ...serializedBatch];
      const keepFrom = Math.max(0, allLines.length - targetCount);
      const kept = retainCompactedLines(allLines, keepFrom, retentionGroupKey);
      nextText = `${kept.join("\n")}
`;
    }
    writeFileAtomic(filePath, nextText, { encoding: "utf8", mode });
    chmodIfRequested(filePath, mode);
    return true;
  }, { timeoutMs, staleMs, pollMs });
}

// plugins/polycli/scripts/lib/run-ledger.mjs
var MAX_LEDGER_BYTES = 2e6;
var KEEP_RATIO = 0.5;
var PRIVATE_FILE_MODE2 = 384;
var RUN_ID_RE = /^[A-Za-z0-9_.-]{1,96}$/;
var SECRET_LONG_OPT_RE = /(token|secret|password|api-?key|access-?key|credential)/i;
var SECRET_ENV_KEY_RE = /(TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_KEY|CREDENTIAL)/i;
var PROMPT_COMMANDS = /* @__PURE__ */ new Set(["ask", "rescue", "review", "adversarial-review"]);
var VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "--provider",
  "--model",
  "--base",
  "--scope",
  "--resume",
  "--effort",
  "--run-id",
  "--timeout-ms",
  "--history"
]);
var SHORT_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-m"]);
var FOCUS_VALUE_OPTIONS = /* @__PURE__ */ new Set(["--focus"]);
var VALID_HOST_SURFACES = /* @__PURE__ */ new Set([
  "terminal",
  "claude-plugin",
  "codex-skill",
  "copilot-skill",
  "opencode-plugin",
  "unknown"
]);
var TERMINAL_LEDGER_PHASES = /* @__PURE__ */ new Set(["attempt_result", "provider_decision"]);
function terminalLedgerRetentionGroupKey(event) {
  if (!TERMINAL_LEDGER_PHASES.has(event?.phase) || !event.runId || !event.jobId) {
    return null;
  }
  return JSON.stringify([event.runId, event.jobId]);
}
function resolveRunLedgerFile(workspaceRoot) {
  return path4.join(resolveStateDir(workspaceRoot), "run-ledger.ndjson");
}
function createRunId() {
  return `run_${randomUUID2().replaceAll("-", "").slice(0, 20)}`;
}
function resolveRunId(options = {}, env = process.env) {
  const runId = options.runId || env.POLYCLI_RUN_ID || createRunId();
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  return runId;
}
function resolveHostSurface(env = process.env, companionUrl = import.meta.url) {
  if (VALID_HOST_SURFACES.has(env.POLYCLI_HOST_SURFACE)) return env.POLYCLI_HOST_SURFACE;
  if (env.CLAUDE_PLUGIN_ROOT) return "claude-plugin";
  if (companionUrl.includes("polycli-codex")) return "codex-skill";
  if (companionUrl.includes("polycli-copilot")) return "copilot-skill";
  if (companionUrl.includes("polycli-opencode")) return "opencode-plugin";
  return "unknown";
}
function stripRunIdArgs(argv) {
  const next = [];
  let runId = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-id") {
      runId = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
      continue;
    }
    next.push(arg);
  }
  return { argv: next, runId };
}
function redactInlineValue(arg) {
  const eq = arg.indexOf("=");
  if (eq === -1) return arg;
  const key = arg.slice(0, eq);
  if (key.startsWith("--") && SECRET_LONG_OPT_RE.test(key)) {
    return `${key}=<secret:redacted>`;
  }
  if (!key.startsWith("--") && SECRET_ENV_KEY_RE.test(key)) {
    return `${key}=<secret:redacted>`;
  }
  return arg;
}
function redactArgv(argv, { command } = {}) {
  const redacted = [];
  const isPromptCommand = PROMPT_COMMANDS.has(command);
  let sawSubcommand = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== "string") {
      redacted.push(arg);
      continue;
    }
    if (arg.startsWith("--")) {
      if (arg.includes("=")) {
        redacted.push(redactInlineValue(arg));
        continue;
      }
      redacted.push(arg);
      const hasNext = i + 1 < argv.length;
      if (!hasNext) continue;
      if (SECRET_LONG_OPT_RE.test(arg)) {
        redacted.push("<secret:redacted>");
        i += 1;
        continue;
      }
      if (FOCUS_VALUE_OPTIONS.has(arg) && (command === "review" || command === "adversarial-review")) {
        redacted.push("<prompt:redacted>");
        i += 1;
        continue;
      }
      if (VALUE_OPTIONS.has(arg)) {
        redacted.push(argv[i + 1]);
        i += 1;
        continue;
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      redacted.push(arg);
      if (SHORT_VALUE_OPTIONS.has(arg) && i + 1 < argv.length) {
        redacted.push(argv[i + 1]);
        i += 1;
      }
      continue;
    }
    if (!sawSubcommand && command && arg === command) {
      sawSubcommand = true;
      redacted.push(arg);
      continue;
    }
    const inlineRedacted = redactInlineValue(arg);
    if (inlineRedacted !== arg) {
      redacted.push(inlineRedacted);
      continue;
    }
    if (isPromptCommand) {
      redacted.push("<prompt:redacted>");
      continue;
    }
    redacted.push(arg);
  }
  return redacted;
}
function createRunLedgerEvent(event = {}) {
  const at = event.at || (/* @__PURE__ */ new Date()).toISOString();
  const command = event.command || null;
  const commands = [...new Set(event.commands || (command ? [command] : []))].filter(Boolean).sort();
  return {
    version: 1,
    eventId: event.eventId || `evt_${randomUUID2().replaceAll("-", "").slice(0, 20)}`,
    at,
    runId: event.runId || null,
    workspaceRoot: event.workspaceRoot || null,
    workspaceSlug: event.workspaceSlug || null,
    kind: event.kind || event.command || null,
    provider: event.provider ?? null,
    reason: event.reason ?? null,
    attempt: event.attempt ?? null,
    jobId: event.jobId ?? null,
    model: event.model ?? null,
    sessionId: event.sessionId ?? null,
    sessionArtifactPath: event.sessionArtifactPath ?? null,
    defaultModel: event.defaultModel ?? null,
    timingRef: event.timingRef ?? null,
    error: event.error ?? null,
    preview: event.preview ?? null,
    stdoutBytes: event.stdoutBytes ?? null,
    stderrBytes: event.stderrBytes ?? null,
    durationMs: event.durationMs ?? null,
    errorCode: event.errorCode ?? null,
    failureClass: event.failureClass ?? null,
    terminalDescriptor: event.terminalDescriptor ?? null,
    pid: event.pid ?? null,
    logFile: event.logFile ?? null,
    argv: event.argv || [],
    command,
    commands,
    status: event.status,
    phase: event.phase,
    hostSurface: event.hostSurface || "unknown"
  };
}
function appendRunLedgerEvent(workspaceRoot, event) {
  if (workspaceRoot) ensureStateDir(workspaceRoot);
  const file = resolveRunLedgerFile(workspaceRoot);
  const workspaceSlug = workspaceRoot ? computeWorkspaceSlug(workspaceRoot) : null;
  const full = createRunLedgerEvent({
    ...event,
    workspaceRoot: workspaceRoot ?? event.workspaceRoot ?? null,
    workspaceSlug: event.workspaceSlug ?? workspaceSlug
  });
  appendNdjson(file, full, {
    maxBytes: MAX_LEDGER_BYTES,
    keepRatio: KEEP_RATIO,
    retentionGroupKey: terminalLedgerRetentionGroupKey,
    mode: PRIVATE_FILE_MODE2
  });
  return full;
}
function appendRunLedgerEvents(workspaceRoot, events) {
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }
  if (events.length === 0) return [];
  if (workspaceRoot) ensureStateDir(workspaceRoot);
  const file = resolveRunLedgerFile(workspaceRoot);
  const workspaceSlug = workspaceRoot ? computeWorkspaceSlug(workspaceRoot) : null;
  const full = events.map((event) => createRunLedgerEvent({
    ...event,
    workspaceRoot: workspaceRoot ?? event.workspaceRoot ?? null,
    workspaceSlug: event.workspaceSlug ?? workspaceSlug
  }));
  appendNdjsonBatch(file, full, {
    maxBytes: MAX_LEDGER_BYTES,
    keepRatio: KEEP_RATIO,
    retentionGroupKey: terminalLedgerRetentionGroupKey,
    mode: PRIVATE_FILE_MODE2
  });
  return full;
}
function canonicalTerminalValue(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => canonicalTerminalValue(entry));
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalTerminalValue(value[key])]));
}
function terminalEventMaterial(event) {
  return {
    phase: event.phase ?? null,
    status: event.status ?? null,
    reason: event.reason ?? null,
    provider: event.provider ?? null,
    command: event.command ?? null,
    kind: event.kind ?? null,
    hostSurface: event.hostSurface || "unknown",
    attempt: canonicalTerminalValue(event.attempt),
    sessionId: event.sessionId ?? null,
    model: event.model ?? null,
    defaultModel: event.defaultModel ?? null,
    timingRef: canonicalTerminalValue(event.timingRef),
    error: canonicalTerminalValue(event.error),
    errorCode: event.errorCode ?? null,
    failureClass: event.failureClass ?? null
  };
}
function stableTerminalJson(value) {
  return JSON.stringify(canonicalTerminalValue(value));
}
function validateTerminalPair(events) {
  if (!Array.isArray(events) || events.length !== 2) {
    throw new TypeError("terminal ledger pair must contain exactly two events");
  }
  const [first] = events;
  const runId = first?.runId;
  const jobId = first?.jobId;
  if (!runId || !jobId || events.some((event) => event?.runId !== runId || event?.jobId !== jobId || !TERMINAL_LEDGER_PHASES.has(event?.phase)) || new Set(events.map((event) => event.phase)).size !== TERMINAL_LEDGER_PHASES.size) {
    throw new TypeError("terminal ledger pair must share runId/jobId and contain attempt_result plus provider_decision");
  }
  return { runId, jobId };
}
function createTerminalLedgerDescriptor(events) {
  const { runId, jobId } = validateTerminalPair(events);
  return {
    version: 1,
    runId,
    jobId,
    events: events.map((event) => terminalEventMaterial(event)).sort((left, right) => left.phase.localeCompare(right.phase))
  };
}
function descriptorsMatch(left, right) {
  return stableTerminalJson(left) === stableTerminalJson(right);
}
function legacyTerminalEventMatches(existing, expected) {
  const actual = terminalEventMaterial(existing);
  const wanted = terminalEventMaterial(expected);
  for (const key of ["phase", "status", "reason", "provider", "command", "kind", "hostSurface"]) {
    if (actual[key] !== wanted[key]) return false;
  }
  for (const key of ["attempt", "sessionId", "model", "defaultModel", "timingRef", "error", "errorCode", "failureClass"]) {
    if (actual[key] != null && stableTerminalJson(actual[key]) !== stableTerminalJson(wanted[key])) {
      return false;
    }
  }
  return true;
}
function terminalEventMatches(existing, expected) {
  if (existing.phase !== expected.phase) return false;
  if (existing.terminalDescriptor != null) {
    return descriptorsMatch(existing.terminalDescriptor, expected.terminalDescriptor);
  }
  return legacyTerminalEventMatches(existing, expected);
}
function terminalPairMatches(existing, expected) {
  if (existing.length !== expected.length || new Set(existing.map((event) => event.phase)).size !== TERMINAL_LEDGER_PHASES.size) {
    return false;
  }
  const descriptorCount = existing.filter((event) => event.terminalDescriptor != null).length;
  if (descriptorCount !== 0 && descriptorCount !== existing.length) return false;
  return expected.every((expectedEvent) => existing.some((event) => terminalEventMatches(event, expectedEvent)));
}
function buildExpectedTerminalPair(events) {
  const rawExpected = events.map((event) => createRunLedgerEvent(event));
  const descriptor = createTerminalLedgerDescriptor(rawExpected);
  const supplied = rawExpected.map((event) => event.terminalDescriptor).filter((value) => value != null);
  if (supplied.length > 0 && (supplied.length !== rawExpected.length || supplied.some((value) => !descriptorsMatch(value, descriptor)))) {
    throw new Error("Terminal ledger descriptor does not match the terminal event pair");
  }
  return {
    descriptor,
    expected: rawExpected.map((event) => ({ ...event, terminalDescriptor: descriptor }))
  };
}
function ensureRunLedgerTerminalPair(workspaceRoot, events) {
  if (!Array.isArray(events) || events.length !== 2) {
    throw new TypeError("terminal ledger pair must contain exactly two events");
  }
  const { expected, descriptor } = buildExpectedTerminalPair(events);
  const { runId, jobId } = validateTerminalPair(expected);
  const existing = readRunLedgerEvents(workspaceRoot).filter((event) => event.runId === runId && event.jobId === jobId && TERMINAL_LEDGER_PHASES.has(event.phase));
  if (existing.length === 0) {
    return appendRunLedgerEvents(workspaceRoot, expected);
  }
  if (existing.length === 1) {
    const [partial] = existing;
    const matchingExpected = expected.find((event) => event.phase === partial.phase);
    if (!matchingExpected || !terminalEventMatches(partial, matchingExpected)) {
      throw new Error(`Incomplete or conflicting terminal ledger pair for job ${jobId}`);
    }
    const missing = expected.find((event) => event.phase !== partial.phase);
    const repair = partial.terminalDescriptor == null ? { ...missing, terminalDescriptor: null } : { ...missing, terminalDescriptor: descriptor };
    return [...existing, ...appendRunLedgerEvents(workspaceRoot, [repair])];
  }
  if (!terminalPairMatches(existing, expected)) {
    throw new Error(`Incomplete or conflicting terminal ledger pair for job ${jobId}`);
  }
  return existing;
}
function readRunLedgerEvents(workspaceRoot) {
  const file = resolveRunLedgerFile(workspaceRoot);
  return readNdjson(file);
}
function groupRunLedgerEvents(events) {
  const groups = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (!event?.runId) continue;
    const group = groups.get(event.runId) || { runId: event.runId, commands: [], events: [] };
    group.events.push(event);
    group.commands = [
      ...new Set([...group.commands, ...event.commands || [], event.command].filter(Boolean))
    ].sort();
    groups.set(event.runId, group);
  }
  for (const group of groups.values()) {
    group.events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return groups;
}
function incrementCount(counts, key) {
  if (!key) return;
  counts[key] = (counts[key] || 0) + 1;
}
function classifyRunFailure(event = {}) {
  if (event.failureClass) return event.failureClass;
  if (event.errorCode) return event.errorCode;
  if (event.status !== "failed" && event.status !== "cancelled" && !event.error) return null;
  const error = typeof event.error === "string" ? event.error : String(event.error?.message ?? event.error ?? "");
  const text = [
    event.provider,
    event.reason,
    error,
    event.preview
  ].filter(Boolean).join("\n");
  if (/\bmaximum session turn\b|\bmax(?:imum)? session turns?\b/i.test(text)) {
    return "qwen_max_session_turns";
  }
  if (/\bspawn\b.*\bENOENT\b|\bENOENT\b|\bnot found\b/i.test(text)) {
    return "binary_missing";
  }
  if (/\b(timed out|timeout)\b/i.test(text)) {
    return "timeout";
  }
  if (/\b(terminated|SIGTERM|exit(?:ed)? with code 143)\b/i.test(text)) {
    return "terminated";
  }
  if (/\b(interrupted|SIGINT|aborted|cancelled|canceled|exit(?:ed)? with code 130)\b/i.test(text)) {
    return "cancelled";
  }
  if (/\b(no visible text|produced no visible text)\b/i.test(text)) {
    return "no_visible_text";
  }
  if (/\b(auth|authenticated|login|credential)\b/i.test(text)) {
    return "auth";
  }
  const exitCodeMatch = text.match(/\bexit(?:ed)? with code (\d+)\b/i);
  if (exitCodeMatch) {
    return `exit_code_${exitCodeMatch[1]}`;
  }
  return event.reason || "unclassified_failure";
}
function summarizeRunLedger(events) {
  return [...groupRunLedgerEvents(events).values()].map((group) => {
    const decisions = group.events.filter(
      (event) => event.phase === "provider_decision" && event.provider
    );
    const failureClassCounts = {};
    for (const event of group.events) {
      if (event.phase !== "attempt_result") continue;
      incrementCount(failureClassCounts, classifyRunFailure(event));
    }
    return {
      runId: group.runId,
      commands: group.commands,
      startedAt: group.events[0]?.at || null,
      updatedAt: group.events.at(-1)?.at || null,
      providerCount: new Set(decisions.map((event) => event.provider)).size,
      adoptedCount: decisions.filter((event) => event.status === "adopted").length,
      skippedCount: decisions.filter((event) => event.status === "skipped").length,
      failedCount: decisions.filter((event) => event.status === "failed").length,
      failureClassCounts
    };
  });
}
function buildRunExplanation(events, runId) {
  const group = groupRunLedgerEvents(events).get(runId);
  if (!group) {
    return { runId, found: false, text: `Run ${runId} was not found.`, events: [] };
  }
  const decisions = group.events.filter((event) => event.phase === "provider_decision");
  const lines = decisions.map(
    (event) => `${event.provider || "run"} ${event.status}${event.reason ? ` (${event.reason})` : ""}`
  );
  for (const event of group.events.filter((item) => item.phase === "attempt_result" && item.status === "failed")) {
    const subject = event.provider || event.jobId || "run";
    lines.push(`attempt ${subject} failed (${classifyRunFailure(event)})`);
  }
  return { runId, found: true, text: lines.join("\n"), events: group.events };
}

// plugins/polycli/scripts/lib/sessions.mjs
import fs5 from "node:fs";
import os3 from "node:os";
import path5 from "node:path";
import { createHash } from "node:crypto";
function storeRoot(provider, homedir) {
  switch (provider) {
    case "claude":
      return path5.join(homedir, ".claude", "projects");
    case "kimi":
      return path5.join(homedir, ".kimi-code", "sessions");
    default:
      return null;
  }
}
function isUnder(root, target) {
  if (!root) return false;
  const rel = path5.relative(root, target);
  return rel === "" || !rel.startsWith("..") && !path5.isAbsolute(rel);
}
function deriveSessionArtifactCandidate({ provider, sessionId, workspaceRoot, homedir } = {}) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { path: null, reason: "no sessionId captured for this run" };
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    return { path: null, reason: "no workspace root" };
  }
  switch (provider) {
    case "claude": {
      const encoded = workspaceRoot.replaceAll("/", "-");
      return {
        provider: "claude",
        path: path5.join(homedir, ".claude", "projects", encoded, `${sessionId}.jsonl`),
        kind: "file"
      };
    }
    case "kimi": {
      let realCwd = workspaceRoot;
      try {
        realCwd = fs5.realpathSync(workspaceRoot);
      } catch {
      }
      const slug = `wd_${path5.basename(realCwd)}_${createHash("sha256").update(realCwd).digest("hex").slice(0, 12)}`;
      return {
        provider: "kimi",
        path: path5.join(homedir, ".kimi-code", "sessions", slug, sessionId),
        kind: "dir"
      };
    }
    case "pi":
      return { path: null, reason: "pi session files are timestamp-prefixed; exact path is not derivable without a directory scan" };
    case "gemini":
      return { path: null, reason: "per-project dir, no per-session artifact" };
    case "codex":
      return { path: null, reason: "separate polycli-codex plugin" };
    case "minimax":
    case "cmd":
      return { path: null, reason: "ephemeral, no per-session store" };
    case "grok":
      return { path: null, reason: "grok session files live under a url-encoded cwd dir; exact path is not derivable without a scan" };
    default:
      return { path: null, reason: `no artifact derivation for provider ${provider ?? "?"}` };
  }
}
function recordArtifactPath(candidate, { homedir, lstatFn = fs5.lstatSync, realpathFn = fs5.realpathSync, existsFn = fs5.existsSync } = {}) {
  if (!candidate || typeof candidate.path !== "string") return null;
  const { path: candidatePath, provider } = candidate;
  if (!existsFn(candidatePath)) return null;
  let stat;
  try {
    stat = lstatFn(candidatePath);
  } catch {
    return null;
  }
  if (stat && typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) return null;
  let real;
  try {
    real = realpathFn(candidatePath);
  } catch {
    return null;
  }
  const root = storeRoot(provider, homedir);
  if (!isUnder(root, real)) return null;
  return real;
}
function collectRecordedArtifacts(events = []) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const event of events) {
    const sessionArtifactPath = event?.sessionArtifactPath;
    if (typeof sessionArtifactPath !== "string" || sessionArtifactPath.length === 0) continue;
    const provider = event.provider ?? null;
    const sessionId = event.sessionId ?? null;
    const workspaceRoot = event.workspaceRoot ?? null;
    const key = JSON.stringify([provider, sessionId, sessionArtifactPath, workspaceRoot]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider, sessionId, sessionArtifactPath, workspaceRoot });
  }
  return out;
}
function collectNonPurgeableSessions(events = [], { homedir = os3.homedir() } = {}) {
  const withPath = /* @__PURE__ */ new Set();
  for (const event of events) {
    if (typeof event?.sessionArtifactPath === "string" && event.sessionArtifactPath.length > 0 && typeof event?.sessionId === "string") {
      withPath.add(JSON.stringify([event.provider ?? null, event.sessionId, event.workspaceRoot ?? null]));
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const event of events) {
    const sessionId = event?.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) continue;
    const provider = event.provider ?? null;
    const workspaceRoot = event.workspaceRoot ?? null;
    const key = JSON.stringify([provider, sessionId, workspaceRoot]);
    if (withPath.has(key) || seen.has(key)) continue;
    seen.add(key);
    const derived = deriveSessionArtifactCandidate({ provider, sessionId, workspaceRoot, homedir });
    out.push({ provider, sessionId, reason: derived?.reason ?? "no recorded artifact path" });
  }
  return out;
}
function planPurge({ recorded = [], homedir, lstatFn = fs5.lstatSync, realpathFn = fs5.realpathSync, existsFn = fs5.existsSync, sizeFn } = {}) {
  const deletable = [];
  const skipped = [];
  const defaultSizeFn = (p) => {
    try {
      return lstatFn(p).size ?? 0;
    } catch {
      return 0;
    }
  };
  const resolveSize = typeof sizeFn === "function" ? sizeFn : defaultSizeFn;
  for (const rec of recorded) {
    const { provider, sessionId } = rec;
    const candidatePath = rec.sessionArtifactPath;
    if (typeof candidatePath !== "string" || candidatePath.length === 0) {
      skipped.push({ provider, reason: "no recorded artifact path" });
      continue;
    }
    if (!existsFn(candidatePath)) {
      skipped.push({ path: candidatePath, reason: "artifact no longer exists" });
      continue;
    }
    let stat;
    try {
      stat = lstatFn(candidatePath);
    } catch {
      skipped.push({ path: candidatePath, reason: "lstat failed" });
      continue;
    }
    if (stat && typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) {
      skipped.push({ path: candidatePath, reason: "refused: path is a symlink" });
      continue;
    }
    let real;
    try {
      real = realpathFn(candidatePath);
    } catch {
      skipped.push({ path: candidatePath, reason: "realpath failed" });
      continue;
    }
    const root = storeRoot(provider, homedir);
    if (!isUnder(root, real)) {
      skipped.push({ path: candidatePath, reason: "refused: realpath escaped the provider store root" });
      continue;
    }
    const base = path5.basename(candidatePath);
    const fileMatch = base === `${sessionId}.jsonl`;
    const dirMatch = base === sessionId;
    if (!fileMatch && !dirMatch) {
      skipped.push({ path: candidatePath, reason: "refused: basename no longer matches the recorded sessionId" });
      continue;
    }
    deletable.push({ provider, sessionId, path: candidatePath, bytes: resolveSize(candidatePath) });
  }
  return { deletable, skipped };
}
function executePurge(plan, { confirm = false, rmFn = (p) => fs5.rmSync(p, { recursive: true, force: true }) } = {}) {
  const deletable = plan?.deletable ?? [];
  const skipped = plan?.skipped ?? [];
  if (!confirm) {
    return { confirmed: false, deleted: 0, wouldDelete: deletable.length, skipped: skipped.length };
  }
  let deleted = 0;
  for (const entry of deletable) {
    rmFn(entry.path);
    deleted += 1;
  }
  return { confirmed: true, deleted, wouldDelete: deletable.length, skipped: skipped.length };
}
function defaultHomedir() {
  return os3.homedir();
}

// plugins/polycli/scripts/lib/job-control.mjs
var ACTIVE_STATUSES2 = /* @__PURE__ */ new Set(["queued", "running"]);
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
function isExpectedWorkerProcess(pid, configFile) {
  if (!Number.isInteger(pid) || pid <= 0 || !configFile) return null;
  try {
    const result = process4.platform === "win32" ? spawnSync3("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`
    ], { encoding: "utf8", stdio: "pipe" }) : spawnSync3("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: "pipe"
    });
    if (result.error) return null;
    if (result.status !== 0) return false;
    return result.stdout.includes("_job-worker") && result.stdout.includes(configFile);
  } catch {
    return null;
  }
}
function sortJobsNewestFirst(jobs) {
  return jobs.slice().sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}
function readProgressPreview(logFile, maxLines = 4) {
  if (!logFile) return "";
  try {
    const lines = fs6.readFileSync(logFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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
function isTerminalEnvelope(envelope) {
  return Boolean(envelope?.job && TERMINAL_STATUSES.has(envelope.job.status));
}
function buildRecoveredTerminalEvents(workspaceRoot, job, config, runContext, { result = null, reason = "worker_exited", terminalDescriptor = null } = {}) {
  const command = runContext.command || config?.execution?.kind || job.kind || null;
  const provider = runContext.provider || config?.execution?.provider || job.provider || null;
  const kind = runContext.kind || config?.execution?.kind || job.kind || command;
  const cancelled = reason === "cancelled" || job.status === "cancelled";
  const succeeded = !cancelled && job.status === "completed" && result?.ok !== false;
  const status = cancelled ? "cancelled" : succeeded ? "completed" : "failed";
  const decisionStatus = cancelled ? "cancelled" : succeeded ? "adopted" : "failed";
  const terminalReason = succeeded ? null : reason;
  const errorMessage = succeeded ? null : result?.error || job.error || "worker exited before writing a result envelope";
  const recoveredSessionId = result?.sessionId ?? job.sessionId ?? null;
  const recoveredCwd = config?.execution?.cwd ?? config?.workspaceRoot ?? workspaceRoot ?? null;
  const sessionArtifactPath = recoveredSessionId && recoveredCwd ? recordArtifactPath(
    deriveSessionArtifactCandidate({
      provider,
      sessionId: recoveredSessionId,
      workspaceRoot: recoveredCwd,
      homedir: os4.homedir()
    }),
    { homedir: os4.homedir() }
  ) : null;
  const base = {
    runId: runContext.runId,
    command,
    commands: command ? [command] : [],
    kind,
    provider,
    jobId: job.jobId,
    sessionId: recoveredSessionId,
    sessionArtifactPath,
    // A descriptor-bearing envelope came from the worker finalizer, whose terminal event records
    // only upstream-returned model fields. Do not substitute configured defaults during recovery:
    // doing so would manufacture a different terminal identity after a crash.
    model: terminalDescriptor ? result?.model ?? null : result?.model || runContext.model || config?.execution?.model || job.model || null,
    defaultModel: terminalDescriptor ? result?.defaultModel ?? null : result?.defaultModel || runContext.defaultModel || config?.execution?.defaultModel || null,
    hostSurface: runContext.hostSurface || "unknown",
    logFile: runContext.logFile || job.logFile || null
  };
  return [
    {
      ...base,
      phase: "attempt_result",
      status,
      reason: terminalReason,
      attempt: { ordinal: 1 },
      preview: result?.response ? String(result.response).slice(0, 180) : null,
      stdoutBytes: result?.stdoutBytes ?? null,
      stderrBytes: result?.stderrBytes ?? null,
      errorCode: result?.errorCode ?? result?.timing?.errorCode ?? null,
      failureClass: result?.errorCode ?? result?.timing?.errorCode ?? null,
      timingRef: result?.timing ? {
        provider: result.timing.provider,
        kind: result.timing.kind,
        completedAt: result.timing.completedAt
      } : null,
      error: errorMessage ? { message: String(errorMessage).slice(0, 300) } : null
    },
    {
      ...base,
      phase: "provider_decision",
      status: decisionStatus,
      reason: terminalReason
    }
  ];
}
function applyTerminalDescriptor(events, terminalDescriptor) {
  if (!terminalDescriptor) return events;
  const byPhase = new Map((terminalDescriptor.events || []).map((event) => [event.phase, event]));
  return events.map((event) => {
    const material = byPhase.get(event.phase);
    if (!material) return event;
    return {
      ...event,
      phase: material.phase,
      status: material.status,
      reason: material.reason,
      provider: material.provider,
      command: material.command,
      kind: material.kind,
      hostSurface: material.hostSurface,
      attempt: material.attempt,
      sessionId: material.sessionId,
      model: material.model,
      defaultModel: material.defaultModel,
      timingRef: material.timingRef,
      error: material.error,
      errorCode: material.errorCode,
      failureClass: material.failureClass
    };
  });
}
function prepareRecoveredTerminalEvents(workspaceRoot, job, config, { result = null, reason = "worker_exited", terminalDescriptor = null } = {}) {
  const runContext = config?.runContext;
  if (!runContext?.runId) return { events: [], terminalDescriptor };
  const events = buildRecoveredTerminalEvents(workspaceRoot, job, config, runContext, {
    result,
    reason,
    terminalDescriptor
  });
  const descriptor = terminalDescriptor || createTerminalLedgerDescriptor(events);
  return {
    events: applyTerminalDescriptor(events, terminalDescriptor).map((event) => ({ ...event, terminalDescriptor: descriptor })),
    terminalDescriptor: descriptor
  };
}
function ensureRecoveredTerminalEvents(workspaceRoot, prepared) {
  if (prepared.events.length > 0) {
    ensureRunLedgerTerminalPair(workspaceRoot, prepared.events);
  }
}
function cleanupRuntimePaths(config) {
  const cleanupPaths = config?.execution?.runtimeOptions?.cleanupPaths;
  if (!Array.isArray(cleanupPaths)) return;
  for (const cleanupPath of cleanupPaths) {
    if (typeof cleanupPath !== "string" || !cleanupPath) continue;
    try {
      fs6.rmSync(cleanupPath, { recursive: true, force: true });
    } catch {
    }
  }
}
function refreshJob(workspaceRoot, job) {
  if (!job || !ACTIVE_STATUSES2.has(job.status)) {
    return job ? enrichJob(workspaceRoot, job) : null;
  }
  const storedEnvelope = readJobFile(resolveJobFile(workspaceRoot, job.jobId));
  if (!job.pid && !isTerminalEnvelope(storedEnvelope)) {
    return enrichJob(workspaceRoot, job);
  }
  if (isProcessAlive(job.pid)) {
    const identity = isExpectedWorkerProcess(job.pid, resolveJobConfigFile(workspaceRoot, job.jobId));
    if (!isTerminalEnvelope(storedEnvelope) || identity !== false) {
      return enrichJob(workspaceRoot, job);
    }
  }
  try {
    const write = updateJobAtomically(workspaceRoot, job.jobId, (latest, storedEnvelope2) => {
      if (!latest || !ACTIVE_STATUSES2.has(latest.status)) return null;
      const hasStoredTerminalIntent = isTerminalEnvelope(storedEnvelope2);
      const finalizedAt = (/* @__PURE__ */ new Date()).toISOString();
      const finalizedBase = hasStoredTerminalIntent ? {
        ...latest,
        ...storedEnvelope2.job,
        pid: null
      } : {
        ...latest,
        status: "failed",
        pid: null,
        finishedAt: finalizedAt,
        error: "worker exited before writing a result envelope"
      };
      const finalized = {
        ...finalizedBase,
        finishedAt: finalizedBase.finishedAt || finalizedAt,
        updatedAt: finalizedAt
      };
      const result = hasStoredTerminalIntent ? storedEnvelope2.result || {
        ok: finalized.status === "completed",
        error: finalized.status === "cancelled" ? "cancelled" : finalized.error || null
      } : { ok: false, error: finalized.error };
      const inferredReason = finalized.status === "cancelled" ? "cancelled" : result.ok ? null : result.error === "worker exited before writing a result envelope" ? "worker_exited" : `${finalized.kind || latest.kind}_failed`;
      const terminalReason = hasStoredTerminalIntent && Object.prototype.hasOwnProperty.call(storedEnvelope2, "terminalReason") ? storedEnvelope2.terminalReason : inferredReason;
      const config = readJobConfigFile(resolveJobConfigFile(workspaceRoot, latest.jobId));
      const terminal = prepareRecoveredTerminalEvents(workspaceRoot, finalized, config, {
        result,
        reason: terminalReason,
        terminalDescriptor: storedEnvelope2?.terminalDescriptor ?? null
      });
      return {
        job: finalized,
        envelope: {
          job: finalized,
          result,
          terminalReason,
          terminalDescriptor: terminal.terminalDescriptor
        },
        // The envelope is the recoverable intent. Do not publish the terminal state until the
        // ledger has either atomically accepted the complete pair or already contains that pair.
        beforeStateCommit() {
          ensureRecoveredTerminalEvents(workspaceRoot, terminal);
        }
      };
    });
    if (write.written) {
      const config = readJobConfigFile(resolveJobConfigFile(workspaceRoot, job.jobId));
      cleanupRuntimePaths(config);
      removeJobConfigFile(workspaceRoot, job.jobId);
    }
    const current = write.written ? write.job : getJob(workspaceRoot, job.jobId) || job;
    return enrichJob(workspaceRoot, current);
  } catch {
    return enrichJob(workspaceRoot, getJob(workspaceRoot, job.jobId) || job);
  }
}
function buildStatusSnapshot(workspaceRoot, { showAll = false } = {}) {
  const refreshed = sortJobsNewestFirst(listJobs(workspaceRoot)).map((job) => refreshJob(workspaceRoot, job));
  const limited = showAll ? refreshed : refreshed.slice(0, DEFAULT_STATUS_LIMIT);
  return {
    totalJobs: refreshed.length,
    running: limited.filter((job) => ACTIVE_STATUSES2.has(job.status)),
    recent: limited.filter((job) => TERMINAL_STATUSES.has(job.status))
  };
}
function refreshJobsForLedgerRecovery(workspaceRoot) {
  return sortJobsNewestFirst(listJobs(workspaceRoot)).map((job) => refreshJob(workspaceRoot, job));
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
  return resolveJobReference(workspaceRoot, null, (job) => ACTIVE_STATUSES2.has(job.status));
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
    if (!ACTIVE_STATUSES2.has(refreshed.status)) {
      return { job: refreshed, waitTimedOut: false };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  const timed = getJob(workspaceRoot, jobId);
  return { job: timed ? refreshJob(workspaceRoot, timed) : null, waitTimedOut: true };
}
async function cancelJob(workspaceRoot, jobId, {
  terminate = terminateProcessTree,
  isWorkerAlive = isProcessAlive,
  isExpectedWorker = isExpectedWorkerProcess
} = {}) {
  let pidToKill = null;
  let configForCleanup = null;
  let cancellationEnvelope = null;
  let reason = null;
  const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
  const intentWrite = updateJobAtomically(workspaceRoot, jobId, (current, storedEnvelope) => {
    if (!current) {
      reason = "not_found";
      return null;
    }
    if (!ACTIVE_STATUSES2.has(current.status)) {
      reason = "not_cancellable";
      return null;
    }
    const resumingCancellation = storedEnvelope?.job?.status === "cancelled";
    if (isTerminalEnvelope(storedEnvelope) && !resumingCancellation) {
      reason = "not_cancellable";
      return null;
    }
    pidToKill = current.pid ?? null;
    configForCleanup = readJobConfigFile(resolveJobConfigFile(workspaceRoot, jobId));
    const intentJob = resumingCancellation ? {
      ...current,
      ...storedEnvelope.job,
      status: "cancelled",
      pid: null,
      finishedAt: storedEnvelope.job.finishedAt || requestedAt,
      updatedAt: requestedAt
    } : {
      ...current,
      status: "cancelled",
      pid: null,
      finishedAt: requestedAt,
      updatedAt: requestedAt
    };
    const cancellationResult = resumingCancellation ? storedEnvelope.result || { ok: false, error: "cancelled" } : { ok: false, error: "cancelled" };
    const terminal = prepareRecoveredTerminalEvents(workspaceRoot, intentJob, configForCleanup, {
      result: cancellationResult,
      reason: "cancelled",
      terminalDescriptor: storedEnvelope?.terminalDescriptor ?? null
    });
    cancellationEnvelope = {
      job: intentJob,
      result: cancellationResult,
      terminalReason: "cancelled",
      terminalDescriptor: terminal.terminalDescriptor
    };
    return {
      // Do not make the state terminal yet. It remains the recovery point if this process exits
      // after persisting the intent but before the worker receives its signal.
      job: current,
      envelope: cancellationEnvelope,
      beforeStateCommit() {
        ensureRecoveredTerminalEvents(workspaceRoot, terminal);
      }
    };
  });
  if (!intentWrite.written) {
    return { cancelled: false, reason: reason || "not_cancellable", jobId };
  }
  const configFile = resolveJobConfigFile(workspaceRoot, jobId);
  if (pidToKill && isWorkerAlive(pidToKill)) {
    if (!isExpectedWorker(pidToKill, configFile)) {
      return { cancelled: false, reason: "worker_identity_unverified", jobId };
    }
    try {
      await terminate(pidToKill, {
        signal: "SIGINT",
        forceSignal: "SIGKILL",
        forceAfterMs: 2e3
      });
    } catch (error) {
      return { cancelled: false, reason: "kill_failed", jobId, killWarning: error.message };
    }
    if (isWorkerAlive(pidToKill)) {
      const postSignalIdentity = isExpectedWorker(pidToKill, configFile);
      if (postSignalIdentity === true) {
        return { cancelled: false, reason: "worker_still_running", jobId };
      }
      if (postSignalIdentity == null) {
        return { cancelled: false, reason: "worker_identity_unverified", jobId };
      }
    }
  }
  let finalConfig = configForCleanup;
  const finalWrite = updateJobAtomically(workspaceRoot, jobId, (current, storedEnvelope) => {
    if (!current) {
      reason = "not_found";
      return null;
    }
    if (current.status === "cancelled") return null;
    if (!ACTIVE_STATUSES2.has(current.status) || storedEnvelope?.job?.status !== "cancelled") {
      reason = "cancellation_finalization_pending";
      return null;
    }
    finalConfig = readJobConfigFile(resolveJobConfigFile(workspaceRoot, jobId)) || finalConfig;
    const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    const finalJob = {
      ...current,
      ...storedEnvelope.job,
      status: "cancelled",
      pid: null,
      finishedAt: storedEnvelope.job.finishedAt || finishedAt,
      updatedAt: finishedAt
    };
    const result = storedEnvelope.result || cancellationEnvelope?.result || { ok: false, error: "cancelled" };
    const terminal = prepareRecoveredTerminalEvents(workspaceRoot, finalJob, finalConfig, {
      result,
      reason: "cancelled",
      terminalDescriptor: storedEnvelope?.terminalDescriptor ?? null
    });
    return {
      job: finalJob,
      envelope: {
        ...storedEnvelope,
        job: finalJob,
        result,
        terminalReason: "cancelled",
        terminalDescriptor: terminal.terminalDescriptor
      },
      beforeStateCommit() {
        ensureRecoveredTerminalEvents(workspaceRoot, terminal);
      }
    };
  });
  if (!finalWrite.written) {
    const current = getJob(workspaceRoot, jobId);
    if (current?.status === "cancelled") {
      return { cancelled: true, jobId };
    }
    return { cancelled: false, reason: reason || "cancellation_finalization_pending", jobId };
  }
  cleanupRuntimePaths(finalConfig);
  removeJobConfigFile(workspaceRoot, jobId);
  return { cancelled: true, jobId };
}

// plugins/polycli/scripts/lib/prompt-runtime.mjs
var PROMPT_FINAL_ANSWER_APPEND_SYSTEM = "Always emit a visible final answer in assistant text. Never finish with reasoning blocks only.";
var GEMINI_PROMPT_DISABLED_MCP_NAME = "__polycli_prompt_no_mcp__";
var COPILOT_PROMPT_EXCLUDED_TOOLS = [
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
var QWEN_PROMPT_EXCLUDED_TOOLS = [
  "agent",
  "task_stop",
  "send_message",
  "skill",
  "list_directory",
  "read_file",
  "grep_search",
  "glob",
  "todo_write",
  "ask_user_question",
  "exit_plan_mode",
  "web_fetch"
];
function mergeExtraArgs(runtimeOptions, extraArgs) {
  return [...runtimeOptions.extraArgs || [], ...extraArgs];
}
function buildPromptRuntimeOptions({
  provider,
  kind,
  runtimeOptions = {}
} = {}) {
  if ((kind === "ask" || kind === "rescue") && provider === "agy") {
    return {
      ...runtimeOptions,
      yolo: true
    };
  }
  if (kind === "ask" && provider === "claude") {
    return {
      ...runtimeOptions,
      permissionMode: "plan",
      extraArgs: mergeExtraArgs(runtimeOptions, [
        "--tools",
        "",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--strict-mcp-config"
      ])
    };
  }
  if (kind === "ask" && provider === "gemini") {
    return {
      ...runtimeOptions,
      approvalMode: "plan",
      extraArgs: mergeExtraArgs(runtimeOptions, [
        "--extensions",
        "",
        "--allowed-mcp-server-names",
        GEMINI_PROMPT_DISABLED_MCP_NAME
      ])
    };
  }
  if (kind === "ask" && provider === "copilot") {
    return {
      ...runtimeOptions,
      allowAllTools: false,
      allowAllPaths: false,
      allowAllUrls: false,
      noAskUser: true,
      extraArgs: mergeExtraArgs(runtimeOptions, ["--excluded-tools", COPILOT_PROMPT_EXCLUDED_TOOLS])
    };
  }
  if (kind === "ask" && provider === "opencode") {
    return {
      ...runtimeOptions,
      skipPermissions: false,
      extraArgs: mergeExtraArgs(runtimeOptions, ["--agent", "plan"]),
      env: {
        ...runtimeOptions.env || {},
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          permission: "deny"
        })
      }
    };
  }
  if (kind === "ask" && provider === "pi") {
    return {
      ...runtimeOptions,
      noSession: true,
      extraArgs: mergeExtraArgs(runtimeOptions, [
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-context-files"
      ])
    };
  }
  if (kind === "ask" && provider === "cmd") {
    return {
      ...runtimeOptions,
      yolo: false,
      extraArgs: mergeExtraArgs(runtimeOptions, ["--permission-mode", "plan"])
    };
  }
  if (provider === "qwen") {
    const merged = {
      ...runtimeOptions,
      appendSystem: runtimeOptions.appendSystem || PROMPT_FINAL_ANSWER_APPEND_SYSTEM
    };
    if (kind === "ask") {
      merged.approvalMode = "plan";
      merged.maxSteps = 20;
      merged.extraArgs = mergeExtraArgs(
        runtimeOptions,
        QWEN_PROMPT_EXCLUDED_TOOLS.flatMap((tool) => ["--exclude-tools", tool])
      );
    }
    return merged;
  }
  return runtimeOptions;
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
import fs7 from "node:fs";
import os5 from "node:os";
import path6 from "node:path";
var DEFAULT_MAX_DIFF_BYTES = null;
var REVIEW_SCOPES = /* @__PURE__ */ new Set(["auto", "staged", "unstaged", "working-tree", "branch"]);
var REVIEW_APPEND_SYSTEM = "Always emit a visible final markdown answer in assistant text. Never finish with reasoning blocks only. If there are no actionable issues, output exactly: No issues found.";
var REVIEW_CONSTRAINT_ERROR = "non-overridable review hard constraints";
var AGY_REVIEW_UNSUPPORTED_ERROR = "agy --mode plan is not a verified non-interactive hard read-only mode; /review cannot enforce constraints.";
var STOP_REVIEW_GATE_SAFETY_ERROR = "cannot enforce stop-review safety";
var REVIEW_UNSUPPORTED_PROVIDERS = /* @__PURE__ */ new Set(["agy"]);
var GEMINI_REVIEW_DISABLED_MCP_NAME = "__polycli_review_no_mcp__";
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
var QWEN_REVIEW_EXCLUDED_TOOLS = [
  "agent",
  "task_stop",
  "send_message",
  "skill",
  "list_directory",
  "read_file",
  "grep_search",
  "glob",
  "todo_write",
  "ask_user_question",
  "exit_plan_mode",
  "web_fetch"
];
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
function makeReviewTempDir(prefix) {
  return fs7.mkdtempSync(path6.join(os5.tmpdir(), `polycli-review-${prefix}-`));
}
function assertNoReviewConstraintOverride(provider, runtimeOptions = {}) {
  const extraArgs = Array.isArray(runtimeOptions.extraArgs) ? runtimeOptions.extraArgs : [];
  if (extraArgs.length > 0) {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
  const spec = REVIEW_FLAG_EXPECTATIONS[provider];
  if (!spec) return;
  const keys = spec.readOnlyOptionKeys ?? (spec.readOnlyOptionKey ? [spec.readOnlyOptionKey] : []);
  for (const key of keys) {
    const value = runtimeOptions[key];
    const overridden = spec.readOnlyValue ? Boolean(value) && value !== spec.readOnlyValue : value !== void 0 && value !== false;
    if (overridden) {
      throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
    }
  }
}
function assertReviewProviderSupported(provider) {
  if (REVIEW_UNSUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(AGY_REVIEW_UNSUPPORTED_ERROR);
  }
}
function assertStopReviewGateProviderSupported(provider) {
  if (REVIEW_FLAG_EXPECTATIONS[provider]?.stopReviewGateSafety !== "enforced") {
    throw new Error(`Provider '${provider}' ${STOP_REVIEW_GATE_SAFETY_ERROR}.`);
  }
}
var REVIEW_HARD_CONSTRAINTS = {
  kimi() {
    return {};
  },
  qwen() {
    return {
      approvalMode: "plan",
      appendSystem: REVIEW_APPEND_SYSTEM,
      extraArgs: QWEN_REVIEW_EXCLUDED_TOOLS.flatMap((tool) => ["--exclude-tools", tool])
    };
  },
  claude() {
    return {
      permissionMode: "plan",
      extraArgs: ["--tools", "", "--mcp-config", '{"mcpServers":{}}', "--strict-mcp-config"]
    };
  },
  gemini() {
    const cwd = makeReviewTempDir("gemini-cwd");
    return {
      approvalMode: "plan",
      cwd,
      cleanupPaths: [cwd],
      extraArgs: ["--extensions", "", "--allowed-mcp-server-names", GEMINI_REVIEW_DISABLED_MCP_NAME]
    };
  },
  copilot() {
    return {
      allowAllTools: false,
      allowAllPaths: false,
      allowAllUrls: false,
      noAskUser: true,
      extraArgs: ["--excluded-tools", COPILOT_REVIEW_EXCLUDED_TOOLS]
    };
  },
  opencode({ env } = {}) {
    return {
      skipPermissions: false,
      extraArgs: ["--agent", "plan"],
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          permission: "deny"
        })
      }
    };
  },
  pi() {
    return { noSession: true, extraArgs: ["--no-tools", "--no-extensions", "--no-skills", "--no-context-files"] };
  },
  cmd() {
    return { yolo: false, extraArgs: ["--permission-mode", "plan"] };
  },
  minimax() {
    return {};
  },
  grok() {
    return { permissionMode: "plan", alwaysApprove: false };
  }
};
function buildReviewRuntimeOptions({
  provider,
  cwd,
  runtimeOptions = {},
  env = process.env
} = {}) {
  assertReviewProviderSupported(provider);
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
  const capActive = typeof maxDiffBytes === "number" && Number.isFinite(maxDiffBytes) && maxDiffBytes > 0;
  const truncated = capActive && Buffer.byteLength(diffText, "utf8") > maxDiffBytes;
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
function escapeGeminiAtCommandSyntax(text) {
  return String(text ?? "").replace(/(?<!\\)@/g, "\\@");
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
  const promptDiff = provider === "gemini" ? escapeGeminiAtCommandSyntax(diff || "(empty diff)") : diff || "(empty diff)";
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
    promptDiff
  ].join("\n");
}

// plugins/polycli/scripts/lib/timing.mjs
import path7 from "node:path";
var TIMING_FILE_NAME = "timings.ndjson";
var MAX_TIMING_BYTES = 2e6;
var PRIVATE_FILE_MODE3 = 384;
function resolveTimingHistoryFile(workspaceRoot) {
  return path7.join(resolveStateDir(workspaceRoot), TIMING_FILE_NAME);
}
function describeTimingStore(workspaceRoot) {
  const root = describeStateRoot();
  return {
    stateRoot: root.stateRoot,
    stateRootSource: root.source,
    workspaceRoot,
    workspaceSlug: computeWorkspaceSlug(workspaceRoot),
    stateDir: resolveStateDir(workspaceRoot),
    timingFile: resolveTimingHistoryFile(workspaceRoot)
  };
}
function appendTimingRecord(workspaceRoot, record) {
  const validation = validateTimingRecord(record);
  if (!validation.ok) {
    throw new Error(`Invalid timing record: ${validation.errors.join("; ")}`);
  }
  ensureStateDir(workspaceRoot);
  appendNdjson(resolveTimingHistoryFile(workspaceRoot), record, {
    maxBytes: MAX_TIMING_BYTES,
    keepRatio: 0.5,
    mode: PRIVATE_FILE_MODE3
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
import fs8 from "node:fs";
var PREVIEW_MAX_LINES = 10;
var PREVIEW_TAIL_CACHE = /* @__PURE__ */ new Map();
var PRIVATE_FILE_MODE4 = 384;
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
  if (provider === "agy") {
    if (event.type === "text_delta" && typeof event.delta === "string") return event.delta;
    if (event.type === "result" && typeof event.text === "string") return event.text;
  }
  return "";
}
function appendPreview(logFile, provider, event, { fsImpl = fs8, tailCache = PREVIEW_TAIL_CACHE } = {}) {
  const text = summarizeEventText(provider, event);
  if (!text) return;
  const lines = String(text).split(/\r?\n/).map((line) => collapseWhitespace(line)).filter(Boolean).slice(0, PREVIEW_MAX_LINES);
  if (lines.length === 0) return;
  const currentTail = tailCache.get(logFile) || [];
  if (currentTail.slice(-lines.length).join("\n") === lines.join("\n")) {
    return;
  }
  fsImpl.appendFileSync(logFile, `${lines.join("\n")}
`, { encoding: "utf8", mode: PRIVATE_FILE_MODE4 });
  if (fsImpl === fs8) {
    try {
      fs8.chmodSync(logFile, PRIVATE_FILE_MODE4);
    } catch {
    }
  }
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
  review: 3e5,
  "adversarial-review": 3e5,
  health: 6e4
};
var PROVIDER_TIMEOUT_MULTIPLIERS = {
  gemini: {
    "gemini-3.1-pro-preview": 2
  },
  // opencode's kimi-for-coding variant is a code-reasoning model that hits
  // 120s+ on HumanEval-class problems (verified 2026-05-02 multiway bench R3).
  opencode: {
    "kimi-for-coding/k2p6": 2
  }
};
function resolveTimeoutMs(provider, kind, { model = null, defaultModel = null } = {}) {
  const base = TIMEOUTS_MS[kind];
  if (!Number.isFinite(base)) return base;
  const entry = PROVIDER_TIMEOUT_MULTIPLIERS[provider];
  if (entry == null) return base;
  if (typeof entry === "number") return base * entry;
  const lookup = model || defaultModel;
  const multiplier = lookup && entry[lookup] || 1;
  return base * multiplier;
}
var HEALTH_SENTINEL = "POLYCLI_HEALTH_OK";
var SESSION_ID_ENV = "POLYCLI_COMPANION_SESSION_ID";
var RUN_TRACKED_COMMANDS = /* @__PURE__ */ new Set([
  "health",
  "ask",
  "rescue",
  "review",
  "adversarial-review"
]);
var TERMINAL_JOB_STATUSES = /* @__PURE__ */ new Set(["completed", "failed", "cancelled"]);
var ACTIVE_JOB_STATUSES = /* @__PURE__ */ new Set(["queued", "running"]);
var RUN_CONTEXT = {
  runId: null,
  command: null,
  hostSurface: "unknown",
  rawArgs: []
};
function buildCurrentRunContext(overrides = {}) {
  if (!RUN_CONTEXT.runId) return null;
  const command = overrides.command || RUN_CONTEXT.command;
  return {
    version: 1,
    runId: RUN_CONTEXT.runId,
    command,
    commands: [command].filter(Boolean),
    hostSurface: RUN_CONTEXT.hostSurface,
    argv: redactArgv(RUN_CONTEXT.rawArgs, { command: RUN_CONTEXT.command }),
    ...overrides
  };
}
function buildRunEventForContext(runContext, base = {}) {
  if (!runContext?.runId) return null;
  const command = base.command || runContext.command;
  const commands = Array.from(
    new Set([...runContext.commands || [], command, ...base.commands || []].filter(Boolean))
  ).sort();
  return {
    runId: runContext.runId,
    hostSurface: runContext.hostSurface,
    argv: runContext.argv || [],
    ...base,
    command,
    commands
  };
}
function recordRunEventForContext(workspaceRoot, runContext, base = {}) {
  const event = buildRunEventForContext(runContext, base);
  return event ? appendRunLedgerEvent(workspaceRoot, event) : null;
}
function prepareTerminalRunEventsForContext(runContext, bases = []) {
  const events = bases.map((base) => buildRunEventForContext(runContext, base)).filter(Boolean);
  if (events.length === 0) return { events, terminalDescriptor: null };
  const terminalDescriptor = createTerminalLedgerDescriptor(events);
  return {
    events: events.map((event) => ({ ...event, terminalDescriptor })),
    terminalDescriptor
  };
}
function ensureTerminalRunEventsForContext(workspaceRoot, prepared) {
  return prepared.events.length > 0 ? ensureRunLedgerTerminalPair(workspaceRoot, prepared.events) : [];
}
function hasTerminalJobEnvelope(envelope) {
  return TERMINAL_JOB_STATUSES.has(envelope?.job?.status);
}
function claimBackgroundWorker(workspaceRoot, jobId) {
  const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
    if (!latest || !ACTIVE_JOB_STATUSES.has(latest.status) || hasTerminalJobEnvelope(storedEnvelope)) {
      return null;
    }
    if (latest.pid != null && latest.pid !== process5.pid) {
      return null;
    }
    return {
      job: {
        ...latest,
        status: "running",
        pid: process5.pid,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  });
  return write.written ? write.job : null;
}
function shouldRetainJobConfig(workspaceRoot, jobId) {
  const current = getJob(workspaceRoot, jobId);
  return current?.status === "queued" || current?.status === "running";
}
function recordBackgroundSpawnFailure(workspaceRoot, jobId, execution, runContext, error) {
  const config = readJobConfigFile(resolveJobConfigFile(workspaceRoot, jobId));
  try {
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || !ACTIVE_JOB_STATUSES.has(latest.status) || hasTerminalJobEnvelope(storedEnvelope)) {
        return null;
      }
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const failedJob = {
        ...latest,
        ...execution.jobMeta,
        status: "failed",
        pid: null,
        finishedAt,
        updatedAt: finishedAt,
        error: error.message
      };
      const terminalReason = `${execution.kind}_failed`;
      const terminalEvents = [
        {
          command: runContext?.command || execution.kind,
          kind: execution.kind,
          provider: execution.provider,
          phase: "attempt_result",
          status: "failed",
          reason: terminalReason,
          attempt: { ordinal: 1 },
          jobId,
          error: { message: String(error.message || error).slice(0, 300) },
          logFile: failedJob.logFile || null
        },
        {
          command: runContext?.command || execution.kind,
          kind: execution.kind,
          provider: execution.provider,
          phase: "provider_decision",
          status: "failed",
          reason: terminalReason,
          jobId
        }
      ];
      const terminal = prepareTerminalRunEventsForContext(runContext, terminalEvents);
      return {
        job: failedJob,
        envelope: {
          job: failedJob,
          result: { ok: false, error: error.message },
          terminalReason,
          terminalDescriptor: terminal.terminalDescriptor
        },
        beforeStateCommit() {
          ensureTerminalRunEventsForContext(workspaceRoot, terminal);
        }
      };
    });
    if (write.written) {
      cleanupRuntimeOptions(config?.execution?.runtimeOptions);
      removeJobConfigFile(workspaceRoot, jobId);
    }
  } catch {
  }
}
async function recordRunEvent(workspaceRoot, base = {}) {
  return recordRunEventForContext(workspaceRoot, buildCurrentRunContext(), base);
}
function resolveSessionArtifactPath(provider, sessionId, cwd) {
  if (!sessionId || !cwd) return null;
  const homedir = defaultHomedir();
  const candidate = deriveSessionArtifactCandidate({
    provider,
    sessionId,
    workspaceRoot: cwd,
    homedir
  });
  if (!candidate.path) return null;
  return recordArtifactPath(candidate, { homedir });
}
function printUsage() {
  console.log(
    [
      "Usage:",
      "  polycli-companion.mjs setup [--provider <provider>] [--probe-auth] [--json]",
      "    [--enable-review-gate|--disable-review-gate]",
      "  polycli-companion.mjs health [--provider <provider>] [--model <model>] [--timeout-ms <ms>] [--json]",
      "  polycli-companion.mjs ask --provider <provider> [--model <model>] [--background] [--json] <prompt>",
      "  polycli-companion.mjs rescue --provider <provider> [--model <model>] [--background] [--json] <prompt>",
      "  polycli-companion.mjs review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [--json] [focus ...]",
      "  polycli-companion.mjs adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [--json] [focus ...]",
      "  polycli-companion.mjs status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]",
      "  polycli-companion.mjs result [job-id] [--json]",
      "  polycli-companion.mjs cancel [job-id] [--json]",
      "  polycli-companion.mjs timing [--provider <provider>] [--history <count|all>] [--all] [--json]",
      "  polycli-companion.mjs debug runs [--json]",
      "  polycli-companion.mjs debug show <run-id> [--json]",
      "  polycli-companion.mjs debug explain <run-id> [--json]",
      "  polycli-companion.mjs sessions [list] [--json]",
      "  polycli-companion.mjs sessions purge [--confirm] [--json]"
    ].join("\n")
  );
}
function hasHelpFlag(args = []) {
  return args.includes("--help") || args.includes("-h");
}
function wantsJson(args = []) {
  return args.includes("--json");
}
function classifyErrorCode(message = "") {
  if (message.startsWith("Missing provider.")) return "missing_provider";
  if (message.startsWith("Unknown provider ")) return "unknown_provider";
  if (message.startsWith("Invalid --scope value ")) return "invalid_scope";
  if (message.startsWith("Missing prompt text ")) return "missing_prompt";
  if (message.startsWith("Unknown subcommand ")) return "unknown_subcommand";
  if (/^Job '.+' not found\.$/.test(message)) return "job_not_found";
  if (message === "No completed job found.") return "no_completed_job";
  if (message === "No active job found.") return "no_active_job";
  if (message === "--history must be a non-negative integer." || message === "--history must be a non-negative integer or all.") return "invalid_history";
  if (message === "--max-diff-bytes must be a non-negative integer.") return "invalid_max_diff_bytes";
  return "error";
}
function exitWithError({ message, code = classifyErrorCode(message), asJson = false, exitCode = 1 }) {
  if (asJson) {
    process5.stdout.write(`${JSON.stringify({ error: message, code }, null, 2)}
`);
  } else {
    process5.stderr.write(`Error: ${message}
`);
  }
  process5.exitCode = exitCode;
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
function resolveProviderModelCacheFile(workspaceRoot) {
  return path8.join(resolveStateDir(workspaceRoot), "provider-models.json");
}
function readProviderModelCache(workspaceRoot) {
  try {
    const parsed = JSON.parse(fs9.readFileSync(resolveProviderModelCacheFile(workspaceRoot), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function readCachedProviderModel(workspaceRoot, provider) {
  const cached = readProviderModelCache(workspaceRoot)[provider];
  return typeof cached === "string" && cached.trim() ? cached : null;
}
function cacheProviderModel(workspaceRoot, provider, model) {
  if (typeof model !== "string" || !model.trim()) return;
  const cacheFile = resolveProviderModelCacheFile(workspaceRoot);
  fs9.mkdirSync(path8.dirname(cacheFile), { recursive: true, mode: 448 });
  withLockfile(`${cacheFile}.lock`, () => {
    writeJsonAtomic(cacheFile, { ...readProviderModelCache(workspaceRoot), [provider]: model }, { mode: 384 });
  });
}
function normalizeAuthProbeCost(runtime) {
  const value = runtime.capabilities?.authProbeCost;
  return value === "status" || value === "model" ? value : "unknown";
}
function deriveAuthState(auth) {
  if (!auth) return "unknown";
  const detail = String(auth.detail ?? auth.reason ?? "");
  if (/auth probe inconclusive/i.test(detail)) return "unknown";
  if (auth.loggedIn === true) return "authenticated";
  if (auth.loggedIn === false) return "unauthenticated";
  return "unknown";
}
function skippedAuthDetail({ available, authProbeCost }) {
  if (!available) return "not checked because the provider CLI is unavailable";
  if (authProbeCost === "model") {
    return "not checked by default because authentication uses a model prompt; rerun setup --probe-auth to opt in";
  }
  return "not checked because this provider has no declared safe auth-status probe";
}
async function inspectProvider(provider, { probeAuth = false } = {}) {
  const runtime = getProviderRuntime(provider);
  const availability = await Promise.resolve(runtime.getAvailability(process5.cwd()));
  const available = availability.available === true;
  const authProbeCost = normalizeAuthProbeCost(runtime);
  const authChecked = available && (probeAuth || authProbeCost === "status");
  const auth = authChecked ? await Promise.resolve(runtime.getAuthStatus(process5.cwd())) : null;
  const row = {
    provider,
    available,
    availabilityDetail: availability.detail ?? null,
    loggedIn: auth?.loggedIn ?? null,
    authState: deriveAuthState(auth),
    authChecked,
    authProbeCost,
    authDetail: auth?.detail ?? auth?.reason ?? skippedAuthDetail({ available, authProbeCost }),
    model: auth?.model ?? null,
    capabilities: runtime.capabilities
  };
  cacheProviderModel(resolveWorkspaceRoot(process5.cwd()), provider, row.model);
  return row;
}
async function inspectProviderAvailability(provider) {
  const runtime = getProviderRuntime(provider);
  const availability = await Promise.resolve(runtime.getAvailability(process5.cwd()));
  const authProbeCost = normalizeAuthProbeCost(runtime);
  return {
    provider,
    available: availability.available ?? false,
    availabilityDetail: availability.detail ?? null,
    loggedIn: null,
    authState: "unknown",
    authChecked: false,
    authProbeCost,
    authDetail: "not checked by health",
    model: null,
    capabilities: runtime.capabilities
  };
}
function createJobId(kind) {
  const prefix = JOB_PREFIXES[kind] || "pj";
  return `${prefix}-${randomUUID3().slice(0, 8)}`;
}
function parseExecutionMode(options) {
  if (options.background && options.wait) {
    throw new Error("Choose either --background or --wait, not both.");
  }
  return {
    background: Boolean(options.background)
  };
}
function emitNote(line) {
  if (!line) return;
  process5.stderr.write(`${line}
`);
}
function emitRuntimeWarnings(result = {}) {
  if (!Array.isArray(result.warnings)) return;
  for (const warning of result.warnings) {
    if (typeof warning === "string" && warning.trim()) {
      process5.stderr.write(`${warning.trim()}
`);
    }
  }
}
function validateEffort(effort) {
  if (effort == null) return;
  if (!["low", "medium", "high"].includes(effort)) {
    throw new Error("--effort must be one of: low, medium, high.");
  }
}
function buildProviderFlagRuntimeOptions(provider, options) {
  const runtimeOptions = {};
  const notes = [];
  const resumeFlags = [
    options["resume-last"] ? "--resume-last" : null,
    options.resume ? "--resume" : null,
    options.fresh ? "--fresh" : null
  ].filter(Boolean);
  if (provider === "kimi") {
    if (resumeFlags.length > 1) {
      throw new Error("Choose only one of --resume-last, --resume, or --fresh.");
    }
    if (options["resume-last"]) runtimeOptions.resumeLast = true;
    if (options.resume) runtimeOptions.resumeSessionId = options.resume;
    if (options.fresh) runtimeOptions.fresh = true;
    if (options.write) {
      notes.push("Kimi doesn't distinguish plan-mode from write-mode; it will act on what the prompt asks.");
    }
    if (options.effort) {
      notes.push(`--effort is gemini-specific; ${provider} will proceed without it.`);
    }
    return { runtimeOptions, notes };
  }
  if (provider === "gemini") {
    if (options.write) runtimeOptions.write = true;
    if (options.effort) runtimeOptions.effort = options.effort;
    if (resumeFlags.length > 0) {
      notes.push(`${resumeFlags.join(", ")} ${resumeFlags.length === 1 ? "is" : "are"} kimi-specific; ${provider} will proceed without ${resumeFlags.length === 1 ? "it" : "them"}.`);
    }
    return { runtimeOptions, notes };
  }
  if (provider === "agy") {
    if (resumeFlags.length > 1) {
      throw new Error("Choose only one of --resume-last, --resume, or --fresh.");
    }
    if (options["resume-last"]) runtimeOptions.continueLast = true;
    if (options.resume) runtimeOptions.resumeConversationId = options.resume;
    if (options.fresh) {
      notes.push("--fresh is already agy's default for non-resumed print runs.");
    }
    if (options.write) {
      notes.push("--write is gemini-specific; agy will proceed without it.");
    }
    if (options.effort) {
      notes.push("--effort is gemini-specific; agy will proceed without it.");
    }
    return { runtimeOptions, notes };
  }
  if (provider === "grok") {
    if (resumeFlags.length > 1) {
      throw new Error("Choose only one of --resume-last, --resume, or --fresh.");
    }
    if (options["resume-last"]) runtimeOptions.continueLast = true;
    if (options.resume) runtimeOptions.resumeSessionId = options.resume;
    if (options.fresh) {
      notes.push("--fresh is already grok's default for non-resumed -p runs.");
    }
    if (options.effort) runtimeOptions.effort = options.effort;
    if (options.write) {
      notes.push("--write is gemini-specific; grok will proceed without it.");
    }
    return { runtimeOptions, notes };
  }
  if (options.write) {
    notes.push(`--write is gemini-specific; ${provider} will proceed without it.`);
  }
  if (options.effort) {
    notes.push(`--effort is gemini-specific; ${provider} will proceed without it.`);
  }
  if (resumeFlags.length > 0) {
    notes.push(`${resumeFlags.join(", ")} ${resumeFlags.length === 1 ? "is" : "are"} kimi-specific; ${provider} will proceed without ${resumeFlags.length === 1 ? "it" : "them"}.`);
  }
  return { runtimeOptions, notes };
}
function buildExecutionEnvelope(execution, result) {
  return {
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || execution.defaultModel || null,
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    meta: execution.meta || {},
    ...compactProviderResult(result)
  };
}
function compactProviderResult(result = {}) {
  const compact = { ...result };
  if (typeof result.stdout === "string") {
    compact.stdoutBytes = Buffer.byteLength(result.stdout, "utf8");
    delete compact.stdout;
  }
  if (typeof result.stderr === "string") {
    compact.stderrBytes = Buffer.byteLength(result.stderr, "utf8");
    delete compact.stderr;
  }
  if (Array.isArray(result.events)) {
    compact.eventCount = result.events.length;
    delete compact.events;
  }
  return compact;
}
function cleanupRuntimeOptions(runtimeOptions = {}) {
  const cleanupPaths = Array.isArray(runtimeOptions.cleanupPaths) ? runtimeOptions.cleanupPaths : [];
  for (const cleanupPath of cleanupPaths) {
    if (typeof cleanupPath !== "string" || cleanupPath.trim() === "") continue;
    try {
      fs9.rmSync(cleanupPath, { recursive: true, force: true });
    } catch {
    }
  }
}
function hydrateRuntimeOptions(runtimeOptions = {}) {
  if (!runtimeOptions.env) {
    return runtimeOptions;
  }
  return {
    ...runtimeOptions,
    env: { ...process5.env, ...runtimeOptions.env }
  };
}
async function runForegroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  await recordRunEvent(workspaceRoot, {
    command: execution.kind,
    kind: execution.kind,
    provider: execution.provider,
    phase: "attempt_started",
    status: "started",
    attempt: { ordinal: 1 }
  });
  let result;
  try {
    result = await runProviderPromptStreaming({
      provider: execution.provider,
      prompt: execution.prompt,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      cwd: execution.cwd,
      timeout: execution.timeout,
      kind: execution.kind,
      measurementScope: execution.measurementScope || "request",
      meta: execution.meta || null,
      ...hydrateRuntimeOptions(execution.runtimeOptions),
      onEvent() {
      }
    });
  } finally {
    cleanupRuntimeOptions(execution.runtimeOptions);
  }
  emitRuntimeWarnings(result);
  if (result.timing) {
    appendTimingRecord(workspaceRoot, result.timing);
  }
  cacheProviderModel(workspaceRoot, execution.provider, result.model);
  const sessionArtifactPath = resolveSessionArtifactPath(
    execution.provider,
    result.sessionId,
    execution.cwd
  );
  await recordRunEvent(workspaceRoot, {
    command: execution.kind,
    kind: execution.kind,
    provider: execution.provider,
    phase: "attempt_result",
    status: result.ok ? "completed" : "failed",
    attempt: { ordinal: 1 },
    model: result.model || null,
    sessionId: result.sessionId ?? null,
    sessionArtifactPath,
    defaultModel: result.defaultModel || null,
    preview: result.response ? String(result.response).slice(0, 180) : null,
    stdoutBytes: result.stdoutBytes ?? null,
    stderrBytes: result.stderrBytes ?? null,
    errorCode: result.errorCode ?? result.timing?.errorCode ?? null,
    failureClass: result.errorCode ?? result.timing?.errorCode ?? null,
    timingRef: result.timing ? {
      provider: result.timing.provider,
      kind: result.timing.kind,
      completedAt: result.timing.completedAt
    } : null,
    error: result.ok || !result.error ? null : { message: String(result.error).slice(0, 300) }
  });
  await recordRunEvent(workspaceRoot, {
    command: execution.kind,
    kind: execution.kind,
    provider: execution.provider,
    phase: "provider_decision",
    status: result.ok ? "adopted" : "failed",
    reason: result.ok ? null : `${execution.kind}_failed`,
    sessionId: result.sessionId ?? null,
    sessionArtifactPath
  });
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
    defaultModel: execution.defaultModel || null,
    status: "queued",
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    logFile: resolveJobLogFile(workspaceRoot, jobId),
    createdAt: now,
    updatedAt: now,
    sessionId: process5.env[SESSION_ID_ENV] || null,
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
  const lines = [
    ...snapshot.waitTimedOut ? ["Timed out waiting for all jobs."] : []
  ];
  if (rows.length === 0) {
    lines.push("No jobs found.");
    return lines.join("\n");
  }
  lines.push("| jobId | provider | kind | status | prompt |");
  lines.push("|---|---|---|---|---|");
  for (const job of rows) {
    lines.push(`| ${job.jobId} | ${job.provider} | ${job.kind} | ${job.status} | ${job.promptPreview || ""} |`);
    if (job.progressPreview && snapshot.running.some((running) => running.jobId === job.jobId)) {
      lines.push(`|  |  |  | progress | ${previewText(job.progressPreview, 180)} |`);
    }
  }
  return lines.join("\n");
}
async function waitForAllJobs(workspaceRoot, { timeoutMs = 24e4, pollIntervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = buildStatusSnapshot(workspaceRoot, { showAll: true });
    if (snapshot.running.length === 0) {
      return { ...snapshot, waitTimedOut: false };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  snapshot = buildStatusSnapshot(workspaceRoot, { showAll: true });
  return { ...snapshot, waitTimedOut: snapshot.running.length > 0 };
}
function parseStatusTimeoutMs(rawValue) {
  if (rawValue == null) return void 0;
  const value = String(rawValue);
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs)) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  return timeoutMs;
}
function renderResultEnvelope(envelope) {
  const result = envelope.result ?? envelope;
  const lines = [
    `Job: ${envelope.job.jobId}`,
    `Provider: ${envelope.job.provider}`,
    `Kind: ${envelope.job.kind}`,
    `Status: ${envelope.job.status}`
  ];
  if (envelope.job.finishedAt) lines.push(`Finished: ${envelope.job.finishedAt}`);
  if (envelope.job.sessionId) lines.push(`Session: ${envelope.job.sessionId}`);
  if (result?.response) {
    lines.push("");
    lines.push("Response:");
    lines.push(result.response);
  }
  if (!result?.response && result?.error) {
    lines.push("");
    lines.push("Error:");
    lines.push(result.error);
  }
  return lines.join("\n");
}
function buildResultPayload(envelope) {
  const job = envelope.job || {};
  const result = envelope.result || {};
  return {
    provider: result.provider ?? job.provider ?? null,
    kind: result.kind ?? job.kind ?? null,
    model: result.model ?? job.model ?? null,
    promptPreview: result.promptPreview ?? job.promptPreview ?? null,
    ...result,
    job: {
      jobId: job.jobId ?? null,
      provider: job.provider ?? null,
      kind: job.kind ?? null,
      model: job.model ?? null,
      status: job.status ?? null,
      promptPreview: job.promptPreview ?? null,
      createdAt: job.createdAt ?? null,
      updatedAt: job.updatedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      pid: job.pid ?? null,
      logFile: job.logFile ?? null,
      sessionId: job.sessionId ?? null,
      error: job.error ?? null
    }
  };
}
async function startBackgroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  const job = buildQueuedJob(execution, workspaceRoot);
  upsertJob(workspaceRoot, job);
  const runContext = buildCurrentRunContext({
    command: execution.kind,
    jobId: job.jobId,
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || null,
    defaultModel: execution.defaultModel || null,
    logFile: job.logFile
  });
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
    jobId: job.jobId,
    runContext
  });
  fs9.writeFileSync(job.logFile, `[${(/* @__PURE__ */ new Date()).toISOString()}] started ${job.provider} ${job.kind}
`, {
    encoding: "utf8",
    mode: 384
  });
  const logFd = fs9.openSync(job.logFile, "a", 384);
  const child = spawn2(process5.execPath, [COMPANION_PATH, "_job-worker", resolveJobConfigFile(workspaceRoot, job.jobId)], {
    cwd: execution.cwd,
    env: { ...process5.env },
    stdio: ["ignore", logFd, logFd],
    detached: true
  });
  child.once("error", (error) => {
    recordBackgroundSpawnFailure(workspaceRoot, job.jobId, execution, runContext, error);
  });
  child.unref();
  fs9.closeSync(logFd);
  const runningWrite = updateJobAtomically(workspaceRoot, job.jobId, (latest) => {
    if (!latest || latest.status !== "queued") return null;
    return {
      job: {
        ...latest,
        status: "running",
        pid: child.pid ?? null,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  });
  const runningJob = runningWrite.written ? runningWrite.job : getJob(workspaceRoot, job.jobId) || job;
  if (!ACTIVE_JOB_STATUSES.has(runningJob.status)) {
    removeJobConfigFile(workspaceRoot, job.jobId);
  }
  if (runContext && ACTIVE_JOB_STATUSES.has(runningJob.status)) {
    await recordRunEventForContext(workspaceRoot, runContext, {
      command: execution.kind,
      kind: execution.kind,
      provider: execution.provider,
      phase: "job_started",
      status: "started",
      jobId: job.jobId,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      logFile: job.logFile,
      pid: runningJob.pid ?? null
    });
  }
  if (asJson) {
    output({ ok: true, job: runningJob }, true);
    return;
  }
  output(renderStartedJob(runningJob), false);
}
async function runSetup(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "probe-auth", "enable-review-gate", "disable-review-gate"],
    valueOptions: ["provider"]
  });
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate, not both.");
  }
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }
  let providers;
  if (options.provider) {
    providers = [resolveProvider({ provider: options.provider }).provider];
  } else if (positionals[0]) {
    providers = [resolveProvider({ positionals }).provider];
  } else {
    providers = listProviderRuntimes().map((runtime) => runtime.id);
  }
  const gateConfig = getConfig(workspaceRoot);
  const results = [];
  for (const provider of providers) {
    results.push({
      ...await inspectProvider(provider, { probeAuth: Boolean(options["probe-auth"]) }),
      stopReviewGate: gateConfig.stopReviewGate === true,
      stopReviewGateWorkspace: workspaceRoot
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
        `auth=${row.authState}`,
        `authProbe=${row.authChecked ? "checked" : `skipped:${row.authProbeCost}`}`,
        row.model ? `model=${row.model}` : null,
        row.availabilityDetail ? `version=${row.availabilityDetail}` : null,
        row.authDetail ? `detail=${row.authDetail}` : null
      ].filter(Boolean).join(" ")
    );
  }
  output(lines.join("\n"), false);
}
async function probeProviderHealth({
  provider,
  model = null,
  timeout,
  workspaceRoot
}) {
  const inspection = await inspectProviderAvailability(provider);
  const report = {
    ...inspection,
    ok: false,
    probe: {
      ok: false,
      responseMatched: false,
      expected: HEALTH_SENTINEL,
      responsePreview: null,
      error: null,
      timing: null
    }
  };
  if (!inspection.available) {
    report.probe.error = inspection.availabilityDetail || "provider CLI is unavailable";
  } else if (provider === "claude") {
    try {
      const auth = await Promise.resolve(getProviderRuntime(provider).getAuthStatus(process5.cwd()));
      report.loggedIn = auth.loggedIn ?? false;
      report.authDetail = auth.detail ?? auth.reason ?? null;
      report.model = auth.model ?? report.model;
      report.probe = {
        ok: Boolean(auth.loggedIn),
        kind: "auth_status",
        authOnly: true,
        responseMatched: Boolean(auth.loggedIn),
        expected: "authenticated",
        responsePreview: auth.detail ?? null,
        error: auth.loggedIn ? null : auth.detail ?? "claude auth status did not report authenticated",
        timing: null
      };
      report.ok = Boolean(auth.loggedIn);
    } catch (error) {
      report.probe.error = error.message;
    }
  } else {
    try {
      const result = await runProviderPromptStreaming({
        provider,
        prompt: `Reply with ${HEALTH_SENTINEL} only.`,
        model,
        defaultModel: model ? null : readCachedProviderModel(workspaceRoot, provider),
        cwd: process5.cwd(),
        timeout,
        kind: "health",
        measurementScope: "request",
        meta: { health: true },
        ...hydrateRuntimeOptions(buildPromptRuntimeOptions({
          provider,
          kind: "ask"
        })),
        onEvent() {
        }
      });
      if (result.timing) {
        appendTimingRecord(workspaceRoot, result.timing);
      }
      const response = result.response || "";
      const responseMatched = response.trim() === HEALTH_SENTINEL;
      report.probe = {
        ok: result.ok,
        responseMatched,
        expected: HEALTH_SENTINEL,
        responsePreview: previewText(response, 180),
        error: result.error ?? null,
        timing: result.timing ?? null
      };
      report.ok = Boolean(result.ok && responseMatched);
      report.model = result.model ?? report.model;
      cacheProviderModel(workspaceRoot, provider, report.model);
    } catch (error) {
      report.probe.error = error.message;
    }
  }
  return report;
}
function renderHealthReport(report) {
  const lines = [
    `[${report.provider}] health=${report.ok ? "ok" : "failed"}`,
    `available=${report.available ? "yes" : "no"}`,
    `auth=${report.loggedIn == null ? "not_checked" : report.loggedIn ? "yes" : "no"}`
  ];
  if (report.model) lines.push(`model=${report.model}`);
  if (report.availabilityDetail) lines.push(`version=${report.availabilityDetail}`);
  if (report.authDetail) lines.push(`detail=${report.authDetail}`);
  lines.push(`probe=${report.probe.ok ? "ok" : "failed"}`);
  lines.push(`matched=${report.probe.responseMatched ? "yes" : "no"}`);
  if (report.probe.responsePreview) lines.push(`response=${report.probe.responsePreview}`);
  if (report.probe.error) lines.push(`error=${report.probe.error}`);
  return lines.join(" ");
}
function buildHealthPayload(results) {
  const healthyProviders = results.filter((result) => result.ok).map((result) => result.provider);
  const unhealthyProviders = results.filter((result) => !result.ok).map((result) => result.provider);
  return {
    ok: healthyProviders.length > 0,
    anyHealthy: healthyProviders.length > 0,
    allHealthy: results.length > 0 && unhealthyProviders.length === 0,
    healthyProviders,
    unhealthyProviders,
    results
  };
}
async function runHealth(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider", "model", "timeout-ms"],
    aliasMap: { m: "model" }
  });
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const timeoutMs = options["timeout-ms"] ? Number.parseInt(options["timeout-ms"], 10) : TIMEOUTS_MS.health;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TIMEOUTS_MS.health;
  const hasSingleProvider = Boolean(options.provider || positionals[0]);
  if (options.model && !hasSingleProvider) {
    throw new Error("--model requires --provider for health; provider model names are not portable.");
  }
  const providers = hasSingleProvider ? [resolveProvider({ provider: options.provider, positionals }).provider] : listProviderRuntimes().map((runtime) => runtime.id);
  const results = await Promise.all(providers.map((provider) => probeProviderHealth({
    provider,
    model: options.model || null,
    timeout,
    workspaceRoot
  })));
  for (const report of results) {
    await recordRunEvent(workspaceRoot, {
      command: "health",
      kind: "health",
      provider: report.provider,
      phase: "health_result",
      status: report.ok ? "passed" : "failed",
      reason: report.ok ? "health_passed" : "health_failed",
      model: report.model || null,
      preview: report.probe?.responsePreview || null,
      error: report.probe?.error ? { message: String(report.probe.error).slice(0, 300) } : null
    });
    await recordRunEvent(workspaceRoot, {
      command: "health",
      kind: "health",
      provider: report.provider,
      phase: "provider_decision",
      status: report.ok ? "passed" : "skipped",
      reason: report.ok ? "health_passed" : "health_failed"
    });
  }
  const payload = buildHealthPayload(results);
  if (!payload.anyHealthy) {
    process5.exitCode = 2;
  }
  output(
    options.json ? payload : [
      `Healthy providers: ${payload.healthyProviders.length > 0 ? payload.healthyProviders.join(", ") : "none"}`,
      `All healthy: ${payload.allHealthy ? "yes" : "no"}`,
      ...results.map((result) => renderHealthReport(result))
    ].join("\n"),
    options.json
  );
}
function parsePromptExecution(rawArgs, kind) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait", "resume-last", "fresh", "write"],
    valueOptions: ["provider", "model", "resume", "effort"],
    aliasMap: { m: "model" }
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals
  });
  validateEffort(options.effort);
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const userPrompt = remainingPositionals.join(" ").trim();
  if (!userPrompt) {
    throw new Error(`Missing prompt text for ${kind}.`);
  }
  const providerFlags = buildProviderFlagRuntimeOptions(provider, options);
  for (const note of providerFlags.notes) emitNote(note);
  const cachedDefaultModel = readCachedProviderModel(workspaceRoot, provider);
  return {
    options,
    execution: {
      provider,
      kind,
      prompt: userPrompt,
      userPrompt,
      model: options.model || null,
      defaultModel: cachedDefaultModel,
      cwd: process5.cwd(),
      timeout: resolveTimeoutMs(provider, kind, {
        model: options.model || null,
        defaultModel: cachedDefaultModel
      }),
      meta: {},
      jobMeta: {},
      measurementScope: "request",
      runtimeOptions: buildPromptRuntimeOptions({
        provider,
        kind,
        runtimeOptions: providerFlags.runtimeOptions
      })
    }
  };
}
async function runAsk(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "ask");
  recordLastUsedProvider(resolveWorkspaceRoot(execution.cwd), execution.provider);
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}
async function runRescue(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "rescue");
  recordLastUsedProvider(resolveWorkspaceRoot(execution.cwd), execution.provider);
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}
function buildStopReviewGateExecution(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider"]
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals
  });
  assertStopReviewGateProviderSupported(provider);
  const prompt = remainingPositionals.join(" ").trim();
  if (!prompt) {
    throw new Error("Missing prompt text for stop-review-gate.");
  }
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const defaultModel = readCachedProviderModel(workspaceRoot, provider);
  return {
    options,
    execution: {
      provider,
      // This private command uses the normal review timing budget and schema,
      // but its separate kind keeps stop-time gate latency out of ordinary
      // review cohorts. It also does not record a last-used provider or expose
      // a general-purpose prompt surface.
      kind: "stop-review-gate",
      prompt,
      userPrompt: "stop-time review gate",
      model: null,
      defaultModel,
      cwd: process5.cwd(),
      timeout: resolveTimeoutMs(provider, "review", { defaultModel }),
      meta: { stopReviewGate: true },
      jobMeta: {},
      measurementScope: "request",
      runtimeOptions: buildReviewRuntimeOptions({
        provider,
        cwd: process5.cwd()
      })
    }
  };
}
async function runStopReviewGate(rawArgs) {
  const { options, execution } = buildStopReviewGateExecution(rawArgs);
  await runForegroundExecution(execution, options.json);
}
function buildReviewExecution(rawArgs, { adversarial }) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait"],
    valueOptions: ["provider", "model", "base", "scope", "max-diff-bytes"],
    aliasMap: { m: "model" }
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals
  });
  assertReviewProviderSupported(provider);
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const focus = remainingPositionals.join(" ").trim();
  const maxDiffBytes = parseMaxDiffBytes(options["max-diff-bytes"]);
  const reviewContext = collectReviewContext({
    cwd: process5.cwd(),
    scope: options.scope,
    baseRef: options.base || null,
    maxDiffBytes
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
      defaultModel: readCachedProviderModel(workspaceRoot, provider),
      cwd: process5.cwd(),
      timeout: resolveTimeoutMs(provider, adversarial ? "adversarial-review" : "review", {
        model: options.model || null,
        defaultModel: readCachedProviderModel(workspaceRoot, provider)
      }),
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
    try {
      const warnings = Array.isArray(reviewContext.warnings) && reviewContext.warnings.length > 0 ? reviewContext.warnings : void 0;
      const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
      await recordRunEvent(workspaceRoot, {
        command: execution.kind,
        kind: execution.kind,
        provider: null,
        phase: "provider_decision",
        status: "skipped",
        reason: "no_changes"
      });
      output(
        options.json ? { ok: true, provider, verdict: "no_changes", scope: reviewContext.scope, warnings } : [
          ...warnings ? [`Note: ${warnings.join(" | ")}`] : [],
          "No changes to review."
        ].join("\n\n"),
        options.json
      );
      return;
    } finally {
      cleanupRuntimeOptions(execution.runtimeOptions);
    }
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
  const timeoutMs = options.wait ? parseStatusTimeoutMs(options["timeout-ms"]) : void 0;
  if (options.wait && options.all && !reference) {
    const waited = await waitForAllJobs(workspaceRoot, {
      timeoutMs
    });
    if (waited.waitTimedOut) {
      process5.exitCode = 2;
    }
    if (options.json) {
      output(waited, true);
      return;
    }
    output(renderStatusSnapshot(waited), false);
    return;
  }
  if (options.wait) {
    const target = reference ? resolveJobReference(workspaceRoot, reference) : resolveLatestActiveJob(workspaceRoot);
    if (!target) {
      throw new Error(reference ? `Job '${reference}' not found.` : "No active job found.");
    }
    const waited = await waitForJob(workspaceRoot, target.jobId, {
      timeoutMs
    });
    if (waited.waitTimedOut) {
      process5.exitCode = 2;
    }
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
    output(buildResultPayload(envelope), true);
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
      process5.exitCode = 1;
      return;
    }
    output(positionals[0] ? `Job ${positionals[0]} not found.` : "No active job found to cancel.", false);
    process5.exitCode = 1;
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
function formatCohortValue(value) {
  return value ?? "unspecified";
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
    "Comparable timing cohorts (percentiles stay within provider, kind, scope, outcome, and runtime persistence):"
  ];
  for (const cohort of aggregate.cohorts) {
    lines.push(
      `- provider=${cohort.provider} kind=${formatCohortValue(cohort.kind)} scope=${cohort.measurementScope} outcome=${formatCohortValue(cohort.outcome)} persistence=${cohort.runtimePersistence}: count=${cohort.recordCount} total.p50=${cohort.metrics.total.p50} total.p95=${cohort.metrics.total.p95}`
    );
  }
  lines.push("", "Provider summary (counts/capability only; use comparable cohorts for percentiles):");
  for (const [provider, summary] of Object.entries(aggregate.byProvider)) {
    const mixed = summary.mixedDimensions.length > 0 ? ` mixed=${summary.mixedDimensions.join(",")}` : "";
    lines.push(`- ${provider}: count=${summary.recordCount} cohorts=${summary.cohortCount}${mixed}`);
  }
  return lines.join("\n");
}
function parseHistoryLimit(value, { all = false } = {}) {
  if (all) return null;
  if (value == null) return 20;
  if (String(value).toLowerCase() === "all") return null;
  if (!/^\d+$/.test(String(value))) {
    throw new Error("--history must be a non-negative integer or all.");
  }
  return Number.parseInt(value, 10);
}
function parseMaxDiffBytes(value) {
  if (value == null) return null;
  if (!/^\d+$/.test(String(value))) {
    throw new Error("--max-diff-bytes must be a non-negative integer.");
  }
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}
async function runTiming(rawArgs) {
  const { options } = parseArgs(rawArgs, {
    booleanOptions: ["all", "json"],
    valueOptions: ["provider", "history"]
  });
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const provider = options.provider ? resolveProvider({ provider: options.provider }).provider : null;
  const limit = parseHistoryLimit(options.history, { all: options.all });
  const records = listTimingRecords(workspaceRoot, {
    provider,
    limit
  });
  const aggregate = summarizeTimingRecords(records);
  const metadata = {
    ...describeTimingStore(workspaceRoot),
    provider,
    historyLimit: limit == null ? "all" : limit,
    recordCount: records.length,
    aggregateScope: "records",
    percentileCohortDimensions: aggregate.cohortDimensions
  };
  if (options.json) {
    output({ records, aggregate, metadata }, true);
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
  const { workspaceRoot, execution, jobId, runContext } = payload;
  const current = claimBackgroundWorker(workspaceRoot, jobId);
  if (!current) {
    return;
  }
  if (runContext?.runId) {
    await recordRunEventForContext(workspaceRoot, runContext, {
      command: runContext.command || execution.kind,
      kind: execution.kind,
      provider: execution.provider,
      phase: "attempt_started",
      status: "started",
      attempt: { ordinal: 1 },
      jobId,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      logFile: current.logFile || null
    });
  }
  const startedAt = Date.now();
  try {
    const result = await runProviderPromptStreaming({
      provider: execution.provider,
      prompt: execution.prompt,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      cwd: execution.cwd,
      timeout: execution.timeout,
      kind: execution.kind,
      measurementScope: execution.measurementScope || "job",
      meta: execution.meta || null,
      ...hydrateRuntimeOptions(execution.runtimeOptions),
      onEvent(event) {
        appendPreview(current.logFile, execution.provider, event);
      }
    });
    if (result.timing) {
      appendTimingRecord(workspaceRoot, result.timing);
    }
    cacheProviderModel(workspaceRoot, execution.provider, result.model);
    const compactResult = compactProviderResult(result);
    const sessionArtifactPath = resolveSessionArtifactPath(
      execution.provider,
      result.sessionId,
      execution.cwd
    );
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || latest.status === "cancelled" || hasTerminalJobEnvelope(storedEnvelope)) {
        return null;
      }
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const finishedJob = {
        ...latest,
        ...execution.jobMeta,
        status: result.ok ? "completed" : "failed",
        pid: null,
        finishedAt,
        updatedAt: finishedAt,
        sessionId: result.sessionId ?? null,
        error: result.error ?? null
      };
      const terminalReason = result.ok ? null : `${execution.kind}_failed`;
      const terminalEvents = runContext?.runId ? [
        {
          command: runContext.command || execution.kind,
          kind: execution.kind,
          provider: execution.provider,
          phase: "attempt_result",
          status: result.ok ? "completed" : "failed",
          reason: terminalReason,
          attempt: { ordinal: 1 },
          jobId,
          model: result.model || null,
          sessionId: result.sessionId ?? null,
          sessionArtifactPath,
          defaultModel: result.defaultModel || null,
          preview: result.response ? String(result.response).slice(0, 180) : null,
          stdoutBytes: compactResult.stdoutBytes ?? null,
          stderrBytes: compactResult.stderrBytes ?? null,
          errorCode: result.errorCode ?? result.timing?.errorCode ?? null,
          failureClass: result.errorCode ?? result.timing?.errorCode ?? null,
          durationMs: Date.now() - startedAt,
          timingRef: result.timing ? {
            provider: result.timing.provider,
            kind: result.timing.kind,
            completedAt: result.timing.completedAt
          } : null,
          error: result.ok || !result.error ? null : { message: String(result.error).slice(0, 300) },
          logFile: finishedJob.logFile || null
        },
        {
          command: runContext.command || execution.kind,
          kind: execution.kind,
          provider: execution.provider,
          phase: "provider_decision",
          status: result.ok ? "adopted" : "failed",
          reason: terminalReason,
          jobId,
          sessionId: result.sessionId ?? null,
          sessionArtifactPath
        }
      ] : [];
      const terminal = prepareTerminalRunEventsForContext(runContext, terminalEvents);
      return {
        job: finishedJob,
        envelope: {
          job: finishedJob,
          result: compactResult,
          terminalReason,
          terminalDescriptor: terminal.terminalDescriptor
        },
        // state.mjs writes this envelope first. A crash or ledger failure leaves a recoverable
        // intent instead of exposing a terminal state with only half of its ledger pair.
        beforeStateCommit() {
          ensureTerminalRunEventsForContext(workspaceRoot, terminal);
        }
      };
    });
    if (!write.written) {
      if (!shouldRetainJobConfig(workspaceRoot, jobId)) {
        removeJobConfigFile(workspaceRoot, jobId);
      }
      return;
    }
    removeJobConfigFile(workspaceRoot, jobId);
  } catch (error) {
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || latest.status === "cancelled" || hasTerminalJobEnvelope(storedEnvelope)) {
        return null;
      }
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const failedJob = {
        ...latest,
        ...execution.jobMeta,
        status: "failed",
        pid: null,
        finishedAt,
        updatedAt: finishedAt,
        error: error.message
      };
      const terminalReason = `${execution.kind}_failed`;
      const terminalEvents = runContext?.runId ? [
        {
          command: runContext.command || execution.kind,
          kind: execution.kind,
          provider: execution.provider,
          phase: "attempt_result",
          status: "failed",
          reason: terminalReason,
          attempt: { ordinal: 1 },
          jobId,
          durationMs: Date.now() - startedAt,
          error: { message: String(error?.message || error).slice(0, 300) },
          logFile: failedJob.logFile || null
        },
        {
          command: runContext.command || execution.kind,
          kind: execution.kind,
          provider: execution.provider,
          phase: "provider_decision",
          status: "failed",
          reason: terminalReason,
          jobId
        }
      ] : [];
      const terminal = prepareTerminalRunEventsForContext(runContext, terminalEvents);
      return {
        job: failedJob,
        envelope: {
          job: failedJob,
          result: { ok: false, error: error.message },
          terminalReason,
          terminalDescriptor: terminal.terminalDescriptor
        },
        beforeStateCommit() {
          ensureTerminalRunEventsForContext(workspaceRoot, terminal);
        }
      };
    });
    if (!write.written) {
      if (!shouldRetainJobConfig(workspaceRoot, jobId)) {
        removeJobConfigFile(workspaceRoot, jobId);
      }
      return;
    }
    removeJobConfigFile(workspaceRoot, jobId);
    throw error;
  } finally {
    if (!shouldRetainJobConfig(workspaceRoot, jobId)) {
      cleanupRuntimeOptions(execution.runtimeOptions);
    }
  }
}
function formatDebugRunsTable(runs) {
  if (runs.length === 0) return "No runs found.";
  const lines = [
    "| runId | commands | startedAt | updatedAt | adopted | skipped | failed |",
    "|---|---|---|---|---|---|---|"
  ];
  for (const run of runs) {
    lines.push(
      `| ${run.runId} | ${run.commands.join(",")} | ${run.startedAt || ""} | ${run.updatedAt || ""} | ${run.adoptedCount} | ${run.skippedCount} | ${run.failedCount} |`
    );
  }
  return lines.join("\n");
}
async function runDebugCommand(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"]
  });
  const subcommand = positionals[0] || "runs";
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  refreshJobsForLedgerRecovery(workspaceRoot);
  const events = await readRunLedgerEvents(workspaceRoot);
  const asJson = Boolean(options.json);
  if (subcommand === "runs") {
    const runs = summarizeRunLedger(events);
    if (asJson) {
      output({ ok: true, runs }, true);
      return;
    }
    output(formatDebugRunsTable(runs), false);
    return;
  }
  if (subcommand === "show") {
    const runId = positionals[1];
    if (!runId) {
      throw new Error("Missing run id for debug show.");
    }
    const runEvents = events.filter((event) => event.runId === runId);
    if (asJson) {
      output({ ok: true, runId, events: runEvents }, true);
      return;
    }
    output(JSON.stringify({ runId, events: runEvents }, null, 2), false);
    return;
  }
  if (subcommand === "explain") {
    const runId = positionals[1];
    if (!runId) {
      throw new Error("Missing run id for debug explain.");
    }
    const explanation = buildRunExplanation(events, runId);
    if (asJson) {
      output({ ok: true, ...explanation }, true);
      return;
    }
    output(explanation.text, false);
    return;
  }
  throw new Error(`Unknown subcommand 'debug ${subcommand}'.`);
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "?";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function renderSessionsList(recorded, nonPurgeable = []) {
  const lines = [];
  if (recorded.length === 0) {
    lines.push("No polycli-recorded purgeable upstream sessions in this workspace.");
  } else {
    lines.push("Recorded upstream sessions (this workspace):");
    for (const rec of recorded) {
      const exists = fs9.existsSync(rec.sessionArtifactPath);
      let size = "";
      if (exists) {
        try {
          size = ` ${formatBytes(fs9.lstatSync(rec.sessionArtifactPath).size)}`;
        } catch {
          size = "";
        }
      }
      lines.push(`- ${rec.provider} ${rec.sessionId} ${exists ? "exists" : "missing"}${size} ${rec.sessionArtifactPath}`);
    }
  }
  if (nonPurgeable.length > 0) {
    lines.push("Tracked but not purgeable (no recorded artifact path):");
    for (const np of nonPurgeable) {
      lines.push(`- ${np.provider} ${np.sessionId} (${np.reason})`);
    }
  }
  return lines.join("\n");
}
function renderPurgePlan(plan, summary, nonPurgeable = []) {
  const lines = [];
  if (summary.confirmed) {
    lines.push(`Deleted ${summary.deleted} recorded upstream session artifact(s).`);
  } else {
    lines.push(`Dry run: ${plan.deletable.length} artifact(s) would be deleted. Re-run with --confirm to delete.`);
  }
  for (const entry of plan.deletable) {
    lines.push(`  ${summary.confirmed ? "deleted" : "would delete"}: ${entry.provider} ${entry.sessionId} ${entry.path}`);
  }
  for (const entry of plan.skipped) {
    lines.push(`  skipped: ${entry.path ?? entry.provider ?? "?"} (${entry.reason})`);
  }
  for (const np of nonPurgeable) {
    lines.push(`  not purgeable: ${np.provider} ${np.sessionId} (${np.reason})`);
  }
  if (plan.deletable.length === 0 && plan.skipped.length === 0 && nonPurgeable.length === 0) {
    lines.push("  nothing to purge.");
  }
  return lines.join("\n");
}
async function runSessionsCommand(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "confirm"]
  });
  const subcommand = positionals[0] || "list";
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  const events = await readRunLedgerEvents(workspaceRoot);
  const recorded = collectRecordedArtifacts(events);
  const nonPurgeable = collectNonPurgeableSessions(events);
  const asJson = Boolean(options.json);
  if (subcommand === "list") {
    if (asJson) {
      output({ ok: true, recorded, nonPurgeable }, true);
      return;
    }
    output(renderSessionsList(recorded, nonPurgeable), false);
    return;
  }
  if (subcommand === "purge") {
    const homedir = defaultHomedir();
    const plan = planPurge({ recorded, homedir });
    const confirm = Boolean(options.confirm);
    const summary = executePurge(plan, { confirm });
    if (asJson) {
      output({ ok: true, confirmed: summary.confirmed, plan, nonPurgeable, summary }, true);
      return;
    }
    output(renderPurgePlan(plan, summary, nonPurgeable), false);
    return;
  }
  throw new Error(`Unknown subcommand 'sessions ${subcommand}'.`);
}
async function dispatchCommand(command, rawArgs) {
  if (command === "setup") return runSetup(rawArgs);
  if (command === "health") return runHealth(rawArgs);
  if (command === "ask") return runAsk(rawArgs);
  if (command === "rescue") return runRescue(rawArgs);
  if (command === "review") return runReviewCommand(rawArgs, { adversarial: false });
  if (command === "adversarial-review") return runReviewCommand(rawArgs, { adversarial: true });
  if (command === "status") return runStatus(rawArgs);
  if (command === "result") return runResult(rawArgs);
  if (command === "cancel") return runCancel(rawArgs);
  if (command === "timing") return runTiming(rawArgs);
  if (command === "debug") return runDebugCommand(rawArgs);
  if (command === "sessions") return runSessionsCommand(rawArgs);
  if (command === "_stop-review-gate") return runStopReviewGate(rawArgs);
  if (command === "_job-worker") return runJobWorker(rawArgs);
  throw new Error(`Unknown subcommand '${command}'.`);
}
async function main() {
  const fullArgs = process5.argv.slice(2);
  const { argv: normalizedArgs, runId: explicitRunId } = stripRunIdArgs(fullArgs);
  const [command, ...rawArgs] = normalizedArgs;
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (hasHelpFlag(rawArgs) && command !== "_job-worker") {
    printUsage();
    return;
  }
  RUN_CONTEXT.command = command;
  RUN_CONTEXT.hostSurface = resolveHostSurface(process5.env, import.meta.url);
  RUN_CONTEXT.rawArgs = fullArgs;
  RUN_CONTEXT.runId = RUN_TRACKED_COMMANDS.has(command) ? resolveRunId({ runId: explicitRunId }, process5.env) : null;
  if (!RUN_CONTEXT.runId) {
    return dispatchCommand(command, rawArgs);
  }
  const workspaceRoot = resolveWorkspaceRoot(process5.cwd());
  await recordRunEvent(workspaceRoot, { phase: "run_started", status: "started" });
  try {
    const result = await dispatchCommand(command, rawArgs);
    const failed = process5.exitCode != null && process5.exitCode !== 0;
    await recordRunEvent(workspaceRoot, {
      phase: "run_summary",
      status: failed ? "failed" : "completed"
    });
    return result;
  } catch (error) {
    await recordRunEvent(workspaceRoot, {
      phase: "run_summary",
      status: "failed",
      error: { message: String(error?.message || error).slice(0, 300) }
    });
    throw error;
  }
}
main().catch((error) => {
  exitWithError({
    message: error.message,
    asJson: wantsJson(process5.argv.slice(2)),
    exitCode: process5.exitCode || 1
  });
});
