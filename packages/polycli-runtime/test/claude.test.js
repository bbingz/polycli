import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import {
  buildClaudeInvocation,
  buildClaudeTuiInvocation,
  extractClaudeText,
  getClaudeAuthStatus,
  parseClaudeJsonResult,
  parseClaudeStreamText,
  runClaudePrompt,
  runClaudePromptStreaming,
} from "../src/index.js";

function withFakeClaudeBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-claude-sync-"));
  const bin = path.join(root, "claude");
  fs.writeFileSync(bin, source, { mode: 0o755 });

  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function withFakeBin(name, source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `polycli-${name}-sync-`));
  const bin = path.join(root, name);
  fs.writeFileSync(bin, source, { mode: 0o755 });

  let deferCleanup = false;
  try {
    const result = fn({ root, bin });
    if (result && typeof result.finally === "function") {
      deferCleanup = true;
      return result.finally(() => {
        fs.rmSync(root, { recursive: true, force: true });
      });
    }
    return result;
  } finally {
    if (!deferCleanup) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

test("buildClaudeInvocation uses stdin for large prompts and preserves session options", () => {
  const prompt = "x".repeat(100_001);
  const invocation = buildClaudeInvocation({
    prompt,
    model: "claude-sonnet-4-20250514",
    resumeSessionId: "123e4567-e89b-12d3-a456-426614174000",
    maxTurns: 4,
  });

  assert.equal(invocation.useStdin, true);
  assert.equal(invocation.input, prompt);
  assert.deepEqual(invocation.args, [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "bypassPermissions",
    "--max-turns",
    "4",
    "--model",
    "claude-sonnet-4-20250514",
    "--resume",
    "123e4567-e89b-12d3-a456-426614174000",
  ]);
});

test("buildClaudeInvocation enables verbose output for stream-json mode", () => {
  const invocation = buildClaudeInvocation({
    prompt: "ping",
    outputFormat: "stream-json",
  });

  assert.deepEqual(invocation.args, [
    "-p",
    "ping",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--max-turns",
    "10",
  ]);
});

test("buildClaudeTuiInvocation starts an interactive claude session through tmux", () => {
  const invocation = buildClaudeTuiInvocation({
    prompt: "review this",
    model: "claude-sonnet-4-20250514",
    permissionMode: "plan",
    maxTurns: 1,
    resumeSessionId: "123e4567-e89b-12d3-a456-426614174000",
    extraArgs: ["--tools", "", "--mcp-config", "{\"mcpServers\":{}}", "--strict-mcp-config"],
    bin: "/opt/bin/claude",
    tmuxBin: "/opt/bin/tmux",
    tmuxSessionName: "polycli-claude-test",
    cwd: "/repo",
    env: {
      ANTHROPIC_API_KEY: "test-key",
      CLAUDE_CONFIG_DIR: "/tmp/claude",
      POLYCLI_INTERNAL_SECRET: "do-not-forward",
    },
  });

  assert.equal(invocation.bin, "/opt/bin/tmux");
  assert.deepEqual(invocation.startArgs, [
    "new-session",
    "-d",
    "-s",
    "polycli-claude-test",
    "-e",
    "ANTHROPIC_API_KEY=test-key",
    "-e",
    "CLAUDE_CONFIG_DIR=/tmp/claude",
    "-c",
    "/repo",
    "/opt/bin/claude --permission-mode plan --model claude-sonnet-4-20250514 --resume 123e4567-e89b-12d3-a456-426614174000 --tools '' --mcp-config '{\"mcpServers\":{}}' --strict-mcp-config",
  ]);
  assert.deepEqual(invocation.loadBufferArgs, ["load-buffer", "-b", "polycli-claude-test-prompt", "-"]);
  assert.deepEqual(invocation.pasteBufferArgs, ["paste-buffer", "-d", "-b", "polycli-claude-test-prompt", "-t", "polycli-claude-test"]);
  assert.deepEqual(invocation.sendEnterArgs, ["send-keys", "-t", "polycli-claude-test", "Enter"]);
  assert.equal(invocation.input, "review this");
  assert.equal(invocation.attachCommand, "tmux attach -t polycli-claude-test");
  assert.doesNotMatch(invocation.startArgs.at(-1), /(^| )-p( |$)|--print|--output-format|--max-turns/);
  assert.equal(invocation.startArgs.includes("POLYCLI_INTERNAL_SECRET=do-not-forward"), false);
});

test("parseClaudeStreamText collects session id, result metadata, and assistant text", () => {
  const parsed = parseClaudeStreamText(
    [
      '{"type":"system","subtype":"init","session_id":"claude-1","model":"claude-sonnet-4"}',
      '{"type":"user","message":{"role":"user","content":"ignore me"}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello "},{"type":"tool_use","name":"Read","input":{"file":"README.md"}},{"type":"text","text":"world"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"hello world","session_id":"claude-1","duration_ms":1200,"total_cost_usd":0.001}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "claude-1");
  assert.equal(parsed.model, "claude-sonnet-4");
  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.events.length, 4);
  assert.deepEqual(parsed.resultEvent, {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "hello world",
    session_id: "claude-1",
    duration_ms: 1200,
    total_cost_usd: 0.001,
  });
  assert.equal(
    extractClaudeText({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    }),
    "ok"
  );
  assert.equal(
    extractClaudeText({ type: "result", is_error: false, result: "done" }),
    "done"
  );
});

test("parseClaudeJsonResult surfaces successful result payloads", () => {
  const parsed = parseClaudeJsonResult(
    'noise before json {"type":"result","subtype":"success","is_error":false,"result":"pong","session_id":"claude-2","duration_ms":456}',
    "",
    0
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.response, "pong");
  assert.equal(parsed.sessionId, "claude-2");
  assert.equal(parsed.durationMs, 456);
});

test("parseClaudeJsonResult treats non-zero process status as failure", () => {
  const parsed = parseClaudeJsonResult(
    '{"type":"result","subtype":"success","is_error":false,"result":"pong","session_id":"claude-2"}',
    "",
    1
  );

  assert.equal(parsed.ok, false);
  assert.equal(parsed.response, "pong");
  assert.match(parsed.error, /claude exited with code 1/);
});

test("runClaudePrompt returns parsed success payloads", () => {
  withFakeClaudeBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "pong", session_id: "claude-sync-1", duration_ms: 321 }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runClaudePrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.response, "pong");
      assert.equal(result.sessionId, "claude-sync-1");
      assert.equal(result.durationMs, 321);
    }
  );
});

test("runClaudePrompt treats subtype-only error results as failures", () => {
  withFakeClaudeBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "result", subtype: "error", is_error: false, result: "permission denied", session_id: "claude-sync-err" }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runClaudePrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.equal(result.response, "permission denied");
      assert.equal(result.error, "permission denied");
    }
  );
});

test("runClaudePrompt falls back to stderr session ids when stdout has none", () => {
  withFakeClaudeBin(
    `#!/usr/bin/env node
process.stderr.write("resume 123e4567-e89b-42d3-a456-426614174000\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "pong" }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runClaudePrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.sessionId, "123e4567-e89b-42d3-a456-426614174000");
    }
  );
});

test("runClaudePrompt does not leak stdout on non-zero exit", () => {
  withFakeClaudeBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "secret token" }) + "\\n");
process.exit(2);
`,
    ({ root, bin }) => {
      const result = runClaudePrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "claude exited with code 2");
    }
  );
});

test("runClaudePromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runClaudePromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn claude ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test("runClaudePromptStreaming treats subtype-only error results as failures", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runClaudePromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"claude-stream-err"}\n');
        child.stdout.emit("data", '{"type":"content_block_delta","delta":{"type":"text_delta","text":"partial answer"}}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"error","is_error":false,"result":"permission denied"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response, "partial answer");
  assert.equal(result.error, "permission denied");
});

test("runClaudePromptStreaming treats a successful final result before timeout as completed", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {
    queueMicrotask(() => child.emit("close", 143, null));
  };

  const result = await runClaudePromptStreaming({
    prompt: "ping",
    timeout: 5,
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"claude-stream-timeout"}\n');
        child.stdout.emit("data", '{"type":"content_block_delta","delta":{"type":"text_delta","text":"review complete"}}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"success","is_error":false,"result":"review complete","session_id":"claude-stream-timeout"}\n');
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.response, "review complete");
  assert.equal(result.error, null);
  assert.equal(result.sessionId, "claude-stream-timeout");
});

test("runClaudePromptStreaming passes caller env through print mode", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  const env = { PATH: "/bin", POLYCLI_SENTINEL: "present" };
  let observedEnv = null;

  const result = await runClaudePromptStreaming({
    prompt: "ping",
    env,
    spawnImpl(_bin, _args, options) {
      observedEnv = options.env;
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"content_block_delta","delta":{"type":"text_delta","text":"pong"}}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"success","is_error":false,"result":"pong"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(observedEnv, env);
});

test("runClaudePromptStreaming returns a structured failure when tmux cannot start", async () => {
  await withFakeBin(
    "tmux",
    `#!/usr/bin/env node
process.stderr.write("session failed\\n");
process.exit(2);
`,
    async ({ root, bin }) => {
      const result = await runClaudePromptStreaming({
        prompt: "ping",
        cwd: root,
        bin: "/usr/bin/false",
        tmuxBin: bin,
        tmuxSessionName: "polycli-claude-fail",
        executionMode: "tmux-tui",
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /tmux new-session exited with code 2: session failed/);
    }
  );
});

test("runClaudePromptStreaming submits folded Claude paste markers", async () => {
  await withFakeBin(
    "tmux",
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
if (process.env.TMUX_ARGV_LOG) {
  fs.appendFileSync(process.env.TMUX_ARGV_LOG, JSON.stringify({ argv: args, stdin }) + "\\n");
}
if (args[0] === "capture-pane") {
  process.stdout.write("Claude Code\\npaste again to expand\\n");
}
process.exit(0);
`,
    async ({ root, bin }) => {
      const logFile = path.join(root, "tmux.jsonl");
      const result = await runClaudePromptStreaming({
        prompt: "review this",
        cwd: root,
        bin: "/usr/bin/false",
        tmuxBin: bin,
        tmuxSessionName: "polycli-claude-folded-paste",
        executionMode: "tmux-tui",
        timeout: 2_000,
        env: { ...process.env, TMUX_ARGV_LOG: logFile },
      });

      const commands = fs.readFileSync(logFile, "utf8")
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.equal(result.ok, true);
      assert.equal(result.detached, true);
      assert.equal(result.responseKind, "tmux_tui_session_started");
      assert.equal(result.timingMeta.tmuxDetached, true);
      assert.equal(result.timingMeta.timingScope, "tmux_startup");
      assert.equal(result.timingMeta.llmCompletionObserved, false);
      assert.match(result.warnings.join("\n"), /detached interactive Claude TUI/i);
      assert.equal(commands.at(-1).argv[0], "send-keys");
      assert.match(commands.find((entry) => entry.argv[0] === "load-buffer").stdin, /review this/);
    }
  );
});

test("runClaudePromptStreaming kills tmux session when signalled during TUI orchestration", async () => {
  await withFakeBin(
    "tmux",
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.TMUX_ARGV_LOG) {
  fs.appendFileSync(process.env.TMUX_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
if (args[0] === "capture-pane") {
  process.stdout.write("Claude Code\\n");
}
process.exit(0);
`,
    async ({ root, bin }) => {
      const logFile = path.join(root, "tmux.jsonl");
      class ImmediateSigtermEmitter extends EventEmitter {
        once(event, listener) {
          super.once(event, listener);
          if (event === "SIGTERM") {
            listener();
          }
          return this;
        }
      }

      const result = await runClaudePromptStreaming({
        prompt: "ping",
        cwd: root,
        bin: "/usr/bin/false",
        tmuxBin: bin,
        tmuxSessionName: "polycli-claude-signal",
        executionMode: "tmux-tui",
        timeout: 1_000,
        env: { ...process.env, TMUX_ARGV_LOG: logFile },
        signalEmitter: new ImmediateSigtermEmitter(),
      });

      const commands = fs.readFileSync(logFile, "utf8")
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line).argv);
      assert.equal(result.ok, false);
      assert.match(result.error, /interrupted by SIGTERM/);
      assert.deepEqual(commands[0].slice(0, 4), ["new-session", "-d", "-s", "polycli-claude-signal"]);
      assert.match(commands[0].at(-1), /\/usr\/bin\/false/);
      assert.deepEqual(commands[1], ["kill-session", "-t", "polycli-claude-signal"]);
    }
  );
});

test("runClaudePromptStreaming kills tmux session when the TUI never becomes ready", async () => {
  await withFakeBin(
    "tmux",
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.TMUX_ARGV_LOG) {
  fs.appendFileSync(process.env.TMUX_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
if (args[0] === "capture-pane") {
  process.stdout.write("not ready\\n");
}
process.exit(0);
`,
    async ({ root, bin }) => {
      const logFile = path.join(root, "tmux.jsonl");
      const result = await runClaudePromptStreaming({
        prompt: "ping",
        cwd: root,
        bin: "/usr/bin/false",
        tmuxBin: bin,
        tmuxSessionName: "polycli-claude-not-ready",
        executionMode: "tmux-tui",
        timeout: 1_000,
        env: { ...process.env, TMUX_ARGV_LOG: logFile },
      });

      const commands = fs.readFileSync(logFile, "utf8")
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line).argv[0]);
      assert.equal(result.ok, false);
      assert.match(result.error, /capture-pane/);
      assert.equal(commands.includes("kill-session"), true);
    }
  );
});

test("runClaudePromptStreaming kills tmux session when the pasted prompt never appears", async () => {
  await withFakeBin(
    "tmux",
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.TMUX_ARGV_LOG) {
  fs.appendFileSync(process.env.TMUX_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
if (args[0] === "capture-pane") {
  const stateFile = process.env.TMUX_STATE_FILE;
  const count = stateFile && fs.existsSync(stateFile) ? Number.parseInt(fs.readFileSync(stateFile, "utf8"), 10) : 0;
  const next = Number.isFinite(count) ? count + 1 : 1;
  if (stateFile) fs.writeFileSync(stateFile, String(next));
  process.stdout.write(next === 1 ? "Claude Code\\n" : "Claude Code\\nno pasted prompt\\n");
}
process.exit(0);
`,
    async ({ root, bin }) => {
      const logFile = path.join(root, "tmux.jsonl");
      const stateFile = path.join(root, "state");
      const result = await runClaudePromptStreaming({
        prompt: "ping",
        cwd: root,
        bin: "/usr/bin/false",
        tmuxBin: bin,
        tmuxSessionName: "polycli-claude-no-paste",
        executionMode: "tmux-tui",
        timeout: 1_000,
        env: { ...process.env, TMUX_ARGV_LOG: logFile, TMUX_STATE_FILE: stateFile },
      });

      const commands = fs.readFileSync(logFile, "utf8")
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line).argv[0]);
      assert.equal(result.ok, false);
      assert.match(result.error, /capture-pane/);
      assert.deepEqual(commands.slice(0, 4), ["new-session", "capture-pane", "load-buffer", "paste-buffer"]);
      assert.equal(commands.at(-1), "kill-session");
    }
  );
});

test("runClaudePromptStreaming deletes the tmux prompt buffer when paste fails", async () => {
  await withFakeBin(
    "tmux",
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.TMUX_ARGV_LOG) {
  fs.appendFileSync(process.env.TMUX_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
if (args[0] === "capture-pane") {
  process.stdout.write("Claude Code\\n");
}
if (args[0] === "paste-buffer") {
  process.stderr.write("paste failed\\n");
  process.exit(2);
}
process.exit(0);
`,
    async ({ root, bin }) => {
      const logFile = path.join(root, "tmux.jsonl");
      const result = await runClaudePromptStreaming({
        prompt: "ping",
        cwd: root,
        bin: "/usr/bin/false",
        tmuxBin: bin,
        tmuxSessionName: "polycli-claude-paste-fails",
        executionMode: "tmux-tui",
        timeout: 1_000,
        env: { ...process.env, TMUX_ARGV_LOG: logFile },
      });

      const commands = fs.readFileSync(logFile, "utf8")
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line).argv);
      assert.equal(result.ok, false);
      assert.match(result.error, /paste-buffer exited with code 2/);
      assert.deepEqual(commands.at(-2), ["delete-buffer", "-b", "polycli-claude-paste-fails-prompt"]);
      assert.deepEqual(commands.at(-1), ["kill-session", "-t", "polycli-claude-paste-fails"]);
    }
  );
});

test("runClaudePromptStreaming still fails timeout recovery when no visible text exists", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {
    queueMicrotask(() => child.emit("close", 143, null));
  };

  const result = await runClaudePromptStreaming({
    prompt: "ping",
    timeout: 5,
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"claude-empty-timeout"}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"success","is_error":false,"result":"","session_id":"claude-empty-timeout"}\n');
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.response, "");
  assert.equal(result.error, "claude produced no visible text");
});

test("parseClaudeStreamText replays a captured real cli fixture", () => {
  const { stream, meta } = loadStreamFixture("claude", "stream-success");
  const parsed = parseClaudeStreamText(stream);

  assert.equal(parsed.response, meta.expected.response);
  assert.equal(parsed.sessionId, meta.expected.sessionId);
  assert.ok(
    parsed.model && typeof parsed.model === "string" && parsed.model.length > 0,
    "claude ask result must carry a non-empty model"
  );
});

test("getClaudeAuthStatus keeps loggedIn=true for a transient/timeout probe failure", () => {
  const auth = getClaudeAuthStatus(process.cwd(), {
    authRunner: () => ({ status: 1, stdout: "", stderr: "claude timed out after 30s", error: null }),
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /inconclusive/i);
});

test("getClaudeAuthStatus keeps loggedIn=true when auth status times out", () => {
  const timeout = new Error("spawnSync claude ETIMEDOUT");
  timeout.code = "ETIMEDOUT";
  const auth = getClaudeAuthStatus(process.cwd(), {
    authRunner: () => ({ status: null, stdout: "", stderr: "", error: timeout }),
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /inconclusive/i);
});

test("getClaudeAuthStatus reads legacy non-json authenticated output", () => {
  const auth = getClaudeAuthStatus(process.cwd(), {
    authRunner: () => ({ status: 0, stdout: "authenticated\n", stderr: "", error: null }),
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /authenticated/i);
});

test("getClaudeAuthStatus reads legacy non-json logged-out output", () => {
  const auth = getClaudeAuthStatus(process.cwd(), {
    authRunner: () => ({ status: 0, stdout: "not authenticated\n", stderr: "", error: null }),
  });

  assert.equal(auth.loggedIn, false);
  assert.match(auth.detail, /not authenticated/i);
});

test("getClaudeAuthStatus treats unknown non-json success output as inconclusive", () => {
  const auth = getClaudeAuthStatus(process.cwd(), {
    authRunner: () => ({ status: 0, stdout: "Claude Code auth status unavailable\n", stderr: "", error: null }),
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /inconclusive/i);
});

test("getClaudeAuthStatus reports loggedIn=false only on an explicit auth error", () => {
  const auth = getClaudeAuthStatus(process.cwd(), {
    authRunner: () => ({ status: 1, stdout: "", stderr: "401 Unauthorized: invalid api key", error: null }),
  });

  assert.equal(auth.loggedIn, false);
  assert.match(auth.detail, /unauthorized/i);
});
