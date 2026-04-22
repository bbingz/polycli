import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildPiInvocation,
  extractPiText,
  parsePiStreamText,
  runPiPromptStreaming,
} from "../src/index.js";

test("buildPiInvocation targets print json mode with model and session support", () => {
  const invocation = buildPiInvocation({
    prompt: "ping",
    model: "openai/gpt-4o-mini",
    resumeSessionId: "pi-1",
  });

  assert.deepEqual(invocation.args, [
    "--print",
    "--mode",
    "json",
    "--model",
    "openai/gpt-4o-mini",
    "--session",
    "pi-1",
    "ping",
  ]);
});

test("parsePiStreamText collects session id and streaming deltas from json mode", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"session_header","sessionId":"pi-1","model":"pi-test"}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello "}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"world"}}',
      '{"type":"agent_end","result":{"text":"hello world"}}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "pi-1");
  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.events.length, 4);
  assert.equal(
    extractPiText({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ok" } }),
    "ok"
  );
});

test("runPiPromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runPiPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn pi ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});
