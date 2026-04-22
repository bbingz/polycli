import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildClaudeInvocation,
  extractClaudeText,
  parseClaudeJsonResult,
  parseClaudeStreamText,
  runClaudePromptStreaming,
} from "../src/index.js";

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
    "acceptEdits",
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
    "acceptEdits",
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
