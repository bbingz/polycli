import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";

import { formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const QWEN_BIN = process.env.QWEN_CLI_BIN || "qwen";
const DEFAULT_TIMEOUT_MS = 300_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
const NO_PROXY_DEFAULTS = ["localhost", "127.0.0.1"];
const QWEN_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
const QWEN_TRANSIENT_PROBE_ERROR_RE = /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i;
const ENV_ALLOW_EXACT = new Set([
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE",
  "LC_MESSAGES", "LC_NUMERIC", "LC_TIME", "TMPDIR", "TZ", "PWD", "LOGNAME",
  "NODE_PATH", "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy",
  "CLAUDE_PLUGIN_DATA",
  "OPENAI_BASE_URL",
]);
const ENV_ALLOW_PREFIXES = ["QWEN_", "BAILIAN_", "DASHSCOPE_", "ALIBABA_", "ALI_", "NPM_CONFIG_"];

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

export function buildQwenEnv(settings = null, parentEnv = process.env) {
  const env = filterEnvForChild(parentEnv);
  const proxy = settings?.proxy;
  const existingProxy = PROXY_KEYS.map((key) => env[key]).find(Boolean) || null;
  const effectiveProxy = existingProxy || proxy;

  if (effectiveProxy) {
    for (const key of PROXY_KEYS) {
      env[key] = effectiveProxy;
    }
  }

  const noProxy = (env.NO_PROXY ?? env.no_proxy ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const mergedNoProxy = Array.from(new Set([...noProxy, ...NO_PROXY_DEFAULTS])).join(",");
  env.NO_PROXY = mergedNoProxy;
  env.no_proxy = mergedNoProxy;
  return env;
}

export function buildQwenInvocation({
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
  bin = QWEN_BIN,
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
    approvalMode: effectiveApprovalMode,
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
        input: block.input ?? block.tool_input ?? null,
      });
    } else if (block.type === "tool_result") {
      out.toolResults.push({
        tool_use_id: block.tool_use_id ?? null,
        content: block.content ?? null,
        is_error: Boolean(block.is_error),
      });
    } else if (block.type === "image") {
      out.imageCount += 1;
    }
  }

  return out;
}

export function extractQwenText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  if (isSuccessfulQwenResultEvent(event) && typeof event.result === "string") {
    return event.result;
  }
  if (event.type !== "assistant" || !Array.isArray(event.message?.content)) {
    return "";
  }

  return event.message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
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
  return typeof event.result === "string" && event.result.trim()
    ? event.result
    : null;
}

export function parseQwenStreamText(text) {
  const out = {
    sessionId: null,
    model: null,
    mcpServers: [],
    assistantTexts: [],
    toolUses: [],
    toolResults: [],
    imageCount: 0,
    resultEvent: null,
    response: "",
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

export function getQwenAvailability(cwd) {
  return binaryAvailable(QWEN_BIN, ["--version"], { cwd });
}

function buildQwenAuthStatus(pingResult) {
  if (pingResult.ok) {
    return {
      loggedIn: true,
      detail: "authenticated",
      model: pingResult.model ?? null,
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

export function getQwenAuthStatus(cwd, { promptRunner = runQwenPrompt, envBuilder = buildQwenEnv } = {}) {
  const env = envBuilder();
  const pingResult = promptRunner({
    prompt: "ping",
    cwd,
    env,
    timeout: AUTH_CHECK_TIMEOUT_MS,
    maxSteps: 1,
  });
  return buildQwenAuthStatus(pingResult);
}

export function runQwenPrompt({
  prompt,
  cwd,
  env = buildQwenEnv(),
  timeout = DEFAULT_TIMEOUT_MS,
  sessionId,
  resumeLast = false,
  resumeId,
  approvalMode,
  unsafeFlag = false,
  background = false,
  maxSteps = 20,
  appendSystem,
  appendDirs,
  bin = QWEN_BIN,
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
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, {
    cwd,
    env,
    timeout,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  const parsed = parseQwenStreamText(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"],
  });
  const resultEventError = extractQwenResultError(parsed.resultEvent);
  return {
    ok: result.status === 0 && !resultEventError && Boolean(parsed.response.trim()),
    status: result.status,
    stderr: result.stderr,
    ...parsed,
    sessionId: parsed.sessionId ?? resolvedSession.sessionId,
    error: result.status === 0 && !resultEventError && parsed.response.trim()
      ? null
      : result.stderr.trim() || resultEventError || formatProviderExitError("qwen", result.status),
  };
}

export function runQwenPromptStreaming({
  prompt,
  cwd,
  env = buildQwenEnv(),
  timeout = DEFAULT_TIMEOUT_MS,
  sessionId,
  resumeLast = false,
  resumeId,
  approvalMode,
  unsafeFlag = false,
  background = false,
  maxSteps = 20,
  appendSystem,
  appendDirs,
  onEvent = () => {},
  bin = QWEN_BIN,
  spawnImpl,
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
    bin,
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
      } catch {}
    },
  }).then((result) => {
    const parsed = parseQwenStreamText(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const hasVisibleText = Boolean(parsed.response.trim());
    const resultEventError = extractQwenResultError(parsed.resultEvent);
    return {
      ...result,
      ...parsed,
      sessionId: parsed.sessionId ?? resolvedSession.sessionId,
      ok: result.ok && !resultEventError && hasVisibleText,
      error: result.ok && !resultEventError
        ? (hasVisibleText ? null : (resultEventError || "qwen produced no visible text"))
        : (resultEventError || result.error),
    };
  });
}
