import { parseStreamJsonLine } from "@bbingz/polycli-utils/parse-stream-json";
import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";
import { randomUUID } from "node:crypto";

import { formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const CLAUDE_BIN = process.env.CLAUDE_CLI_BIN || "claude";
const CLAUDE_TMUX_BIN = process.env.POLYCLI_TMUX_BIN || "tmux";
const DEFAULT_TIMEOUT_MS = 900_000;
const TMUX_START_TIMEOUT_MS = 30_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PROMPT_STDIN_THRESHOLD = 100_000;
const CLAUDE_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
const CLAUDE_TMUX_ENV_EXACT = new Set([
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
  "no_proxy",
]);
const CLAUDE_TMUX_DETACHED_WARNING = "Claude tmux TUI mode starts a detached interactive Claude TUI session; attach to read the model response. Timing covers tmux startup and prompt submission only, not LLM completion.";
const TMUX_CLEANUP_SIGNALS = ["SIGINT", "SIGTERM"];
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
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

  return Object.entries(env)
    .filter(([key, value]) => (
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      && shouldForwardClaudeTmuxEnv(key)
      && value != null
      && !String(value).includes("\0")
    ))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ["-e", `${key}=${String(value)}`]);
}

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

function firstNonEmptyLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function parseClaudeLegacyAuthText(text) {
  const detail = firstNonEmptyLine(text);
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

export function buildClaudeInvocation({
  prompt,
  model = null,
  outputFormat = "json",
  permissionMode = "bypassPermissions",
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

export function buildClaudeTuiInvocation({
  prompt,
  model = null,
  permissionMode = "bypassPermissions",
  resumeSessionId = null,
  extraArgs = [],
  bin = CLAUDE_BIN,
  tmuxBin = CLAUDE_TMUX_BIN,
  tmuxSessionName = null,
  cwd = null,
  env = process.env,
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
    attachCommand: `tmux attach -t ${shellQuote(sessionName)}`,
  };
}

function runTmuxStep(invocation, args, options = {}) {
  return runCommand(invocation.bin, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    timeout: options.timeout,
  });
}

function sleepSync(ms) {
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
  const handlers = new Map();
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
      { cwd, env, timeout: 1_000 }
    );
    last = captured;
    if (captured.status === 0 && /Claude Code/.test(captured.stdout || "")) {
      return { ok: true };
    }
    sleepSync(100);
  }
  return {
    ok: false,
    error: last ? describeTmuxFailure("capture-pane", last) : "tmux capture-pane did not report Claude readiness",
  };
}

function firstPromptNeedle(input) {
  return String(input || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 80) || "";
}

function pasteReadySignal(text, promptNeedle) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => /Pasted text #|paste again to expand/i.test(line) || (promptNeedle && line.includes(promptNeedle)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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
      { cwd, env, timeout: 1_000 }
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
    sleepSync(100);
  }

  return {
    ok: false,
    error: last ? describeTmuxFailure("capture-pane", last) : "tmux capture-pane did not show pasted prompt",
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
  signalEmitter = process,
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
    env,
  });
  const startTimeout = Math.min(timeout || TMUX_START_TIMEOUT_MS, TMUX_START_TIMEOUT_MS);

  const start = runTmuxStep(invocation, invocation.startArgs, { cwd, env, timeout: startTimeout });
  if (start.error || start.status !== 0) {
    return { ok: false, error: describeTmuxFailure("new-session", start), stdout: start.stdout, stderr: start.stderr };
  }

  const signalCleanup = installTmuxSignalCleanup(invocation, { cwd, env, timeout: startTimeout, signalEmitter });
  const interrupted = () => signalCleanup.state.signal
    ? { ok: false, error: `Claude TUI tmux session interrupted by ${signalCleanup.state.signal}` }
    : null;
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
    timeout: startTimeout,
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
  sleepSync(250);

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
    "The prompt was pasted into the interactive session.",
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
      llmCompletionObserved: false,
    },
    stdout: "",
    stderr: "",
  });
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

export function getClaudeAuthStatus(cwd, {
  authRunner = (options = {}) => runCommand(CLAUDE_BIN, ["auth", "status", "--json"], options),
} = {}) {
  const result = authRunner({
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
  });

  if (result.error) {
    const detail = result.error.message || "claude auth status failed";
    if (
      result.error.code === "ETIMEDOUT"
      || TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))
    ) {
      return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
    }
    return { loggedIn: false, detail };
  }

  if (result.status === 0) {
    let parsed = null;
    try {
      parsed = JSON.parse(String(result.stdout || "{}"));
    } catch {
      const legacy = parseClaudeLegacyAuthText(`${result.stdout || ""}\n${result.stderr || ""}`);
      if (legacy) {
        return legacy;
      }
      const detail = firstNonEmptyLine(`${result.stdout || ""}\n${result.stderr || ""}`);
      return {
        loggedIn: true,
        detail: `auth probe inconclusive: claude auth status returned non-json output${detail ? `: ${detail}` : ""}`,
        model: null,
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
      model: parsed?.model ?? null,
    };
  }

  // A timeout / 429 / transient probe failure must NOT regress to loggedIn:false
  // (the probe is inconclusive, not proof of logout).
  const detail = String(result.stderr || result.stdout || "").trim() || `claude auth status exited with code ${result.status}`;
  if (CLAUDE_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: null };
  }
  return { loggedIn: false, detail };
}

export function runClaudePrompt({
  prompt,
  model = null,
  permissionMode = "bypassPermissions",
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
  permissionMode = "bypassPermissions",
  maxTurns = 10,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  defaultModel = null,
  onEvent = () => {},
  bin = CLAUDE_BIN,
  tmuxBin = CLAUDE_TMUX_BIN,
  tmuxSessionName = null,
  executionMode = "print",
  env = process.env,
  signalEmitter = process,
  spawnImpl,
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
      signalEmitter,
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
    bin,
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
      errorCode: completed && !resultError
        ? (hasVisibleText ? null : "no_visible_text")
        : result.errorCode,
      terminationReason: completed ? null : result.terminationReason,
    };
  });
}
