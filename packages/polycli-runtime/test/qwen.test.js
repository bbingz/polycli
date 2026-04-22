import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildQwenEnv,
  buildQwenInvocation,
  parseQwenStreamText,
  runQwenPromptStreaming,
} from "../src/index.js";

test("buildQwenInvocation defaults to auto-edit and validates uuid session ids", () => {
  const invocation = buildQwenInvocation({
    prompt: "review this diff",
    sessionId: "123e4567-e89b-12d3-a456-426614174000",
  });

  assert.deepEqual(invocation.args, [
    "--session-id",
    "123e4567-e89b-12d3-a456-426614174000",
    "--output-format",
    "stream-json",
    "--approval-mode",
    "auto-edit",
    "--max-session-turns",
    "20",
    "review this diff",
  ]);

  assert.throws(
    () => buildQwenInvocation({ prompt: "x", sessionId: "not-a-uuid" }),
    /UUID/
  );
});

test("buildQwenInvocation supports resume-last and rejects background yolo without unsafe mode", () => {
  const invocation = buildQwenInvocation({
    prompt: "continue",
    resumeLast: true,
    maxSteps: 5,
  });

  assert.deepEqual(invocation.args, [
    "-c",
    "--output-format",
    "stream-json",
    "--approval-mode",
    "auto-edit",
    "--max-session-turns",
    "5",
    "continue",
  ]);

  assert.throws(
    () => buildQwenInvocation({ prompt: "x", approvalMode: "yolo", background: true }),
    /unsafeFlag/
  );
});

test("buildQwenEnv injects proxy settings without overwriting explicit env", () => {
  const env = buildQwenEnv(
    { proxy: "http://127.0.0.1:7890" },
    {
      PATH: "/bin",
      HTTPS_PROXY: "http://keep.me:9000",
      OPENAI_API_KEY: "secret",
      ANTHROPIC_API_KEY: "secret-2",
    }
  );

  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.HTTPS_PROXY, "http://keep.me:9000");
  assert.equal(env.HTTP_PROXY, "http://keep.me:9000");
  assert.equal(env.PATH, "/bin");
  assert.match(env.NO_PROXY, /localhost/);
});

test("parseQwenStreamText keeps assistant text, tool calls, and result event", () => {
  const parsed = parseQwenStreamText(
    [
      '{"type":"system","subtype":"init","session_id":"q-1","model":"qwen-max","mcp_servers":["fs"]}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"},{"type":"tool_use","id":"1","name":"bash","input":{"cmd":"pwd"}}]}}',
      '{"type":"result","subtype":"success"}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "q-1");
  assert.equal(parsed.response, "hello");
  assert.equal(parsed.toolUses.length, 1);
  assert.deepEqual(parsed.mcpServers, ["fs"]);
  assert.deepEqual(parsed.resultEvent, { type: "result", subtype: "success" });
});

test("runQwenPromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runQwenPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn qwen ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});
