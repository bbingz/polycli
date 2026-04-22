import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildKimiInvocation,
  extractKimiText,
  parseKimiStreamText,
  runKimiPromptStreaming,
} from "../src/index.js";

test("buildKimiInvocation omits -p in stdin mode and enables input-format text", () => {
  const invocation = buildKimiInvocation({
    prompt: "x".repeat(100_000),
    model: "kimi-k2",
    resumeSessionId: "123e4567-e89b-12d3-a456-426614174000",
  });

  assert.equal(invocation.useStdin, true);
  assert.equal(invocation.input.length, 100_000);
  assert.deepEqual(invocation.args, [
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "-m",
    "kimi-k2",
    "-r",
    "123e4567-e89b-12d3-a456-426614174000",
  ]);
});

test("parseKimiStreamText keeps assistant text and tool events separate", () => {
  const parsed = parseKimiStreamText(
    [
      '{"role":"assistant","content":[{"type":"text","text":"hello"},{"type":"think","text":"hidden"}]}',
      '{"role":"tool","name":"bash","content":[{"type":"text","text":"ran"}]}',
      '{"role":"assistant","content":[{"type":"text","text":" world"}]}',
    ].join("\n")
  );

  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.events.length, 3);
  assert.equal(parsed.toolEvents.length, 1);
  assert.equal(extractKimiText({ role: "assistant", content: [{ type: "text", text: "ok" }] }), "ok");
});

test("runKimiPromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runKimiPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn kimi ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});
