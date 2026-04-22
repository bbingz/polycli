import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildGeminiInvocation,
  extractGeminiText,
  parseGeminiStreamText,
  runGeminiPromptStreaming,
} from "../src/index.js";

test("buildGeminiInvocation uses stdin for large prompts and preserves approval mode", () => {
  const prompt = "x".repeat(100_001);
  const invocation = buildGeminiInvocation({
    prompt,
    model: "gemini-2.5-pro",
    approvalMode: "auto_edit",
    outputFormat: "stream-json",
    resumeSessionId: "session-123",
  });

  assert.equal(invocation.useStdin, true);
  assert.equal(invocation.input, prompt);
  assert.deepEqual(invocation.args, [
    "-p",
    "",
    "-o",
    "stream-json",
    "-m",
    "gemini-2.5-pro",
    "--approval-mode",
    "auto_edit",
    "--resume",
    "session-123",
  ]);
});

test("parseGeminiStreamText collects session id, stats, and assistant text", () => {
  const parsed = parseGeminiStreamText(
    [
      'noise before json {"type":"init","session_id":"gem-1","model":"gemini-2.5-pro"}',
      '{"type":"message","content":"hello "}',
      '{"type":"message","delta":"world"}',
      '{"type":"result","stats":{"turns":1}}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "gem-1");
  assert.equal(parsed.response, "hello world");
  assert.deepEqual(parsed.stats, { turns: 1 });
  assert.equal(parsed.events.length, 4);
  assert.equal(extractGeminiText({ type: "message", delta: "ok" }), "ok");
});

test("runGeminiPromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runGeminiPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn gemini ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});
