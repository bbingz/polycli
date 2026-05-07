import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import {
  buildClaudeInvocation,
  extractClaudeText,
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
