import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildQwenEnv,
  buildQwenInvocation,
  extractQwenText,
  parseQwenStreamText,
  runQwenPrompt,
  runQwenPromptStreaming,
} from "../src/index.js";

function withFakeQwenBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-qwen-sync-"));
  const bin = path.join(root, "qwen");
  fs.writeFileSync(bin, source, { mode: 0o755 });
  const env = {
    PATH: `${root}:${process.env.PATH || ""}`,
    HOME: process.env.HOME || root,
    LANG: process.env.LANG || "en_US.UTF-8",
  };

  try {
    return fn({ root, env });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

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

test("parseQwenStreamText falls back to result text when assistant text is missing", () => {
  const parsed = parseQwenStreamText(
    [
      '{"type":"system","subtype":"init","session_id":"q-2","model":"qwen-max"}',
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hidden"}]}}',
      '{"type":"result","subtype":"success","result":"No issues found."}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "q-2");
  assert.equal(parsed.response, "No issues found.");
  assert.deepEqual(parsed.resultEvent, {
    type: "result",
    subtype: "success",
    result: "No issues found.",
  });
});

test("extractQwenText falls back to successful result event text", () => {
  assert.equal(
    extractQwenText({ type: "result", subtype: "success", result: "No issues found." }),
    "No issues found."
  );
});

test("extractQwenText ignores error result events", () => {
  assert.equal(
    extractQwenText({ type: "result", subtype: "error", is_error: true, result: "permission denied" }),
    ""
  );
});

test("parseQwenStreamText does not treat error result text as a successful response", () => {
  const parsed = parseQwenStreamText(
    [
      '{"type":"system","subtype":"init","session_id":"q-err","model":"qwen-max"}',
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hidden"}]}}',
      '{"type":"result","subtype":"error","is_error":true,"result":"permission denied"}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "q-err");
  assert.equal(parsed.response, "");
  assert.deepEqual(parsed.resultEvent, {
    type: "result",
    subtype: "error",
    is_error: true,
    result: "permission denied",
  });
});

test("runQwenPrompt accepts result-only success responses", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "q-sync-1", model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: "No issues found.", is_error: false }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, true);
      assert.equal(result.response, "No issues found.");
      assert.equal(result.error, null);
    }
  );
});

test("runQwenPrompt surfaces result-only errors", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "q-sync-2", model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "error", result: "permission denied", is_error: true }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, false);
      assert.equal(result.response, "");
      assert.equal(result.error, "permission denied");
    }
  );
});

test("runQwenPrompt fails when assistant text is followed by an error result", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "q-sync-3", model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "partial answer" }] } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "error", result: "permission denied", is_error: true }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, false);
      assert.equal(result.response, "partial answer");
      assert.equal(result.error, "permission denied");
    }
  );
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

test("runQwenPromptStreaming returns an explicit error when no visible assistant text is emitted", async () => {
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
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"q-3","model":"qwen-test"}\n');
        child.stdout.emit("data", '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hidden"}]}}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"success"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "qwen produced no visible text");
});

test("runQwenPromptStreaming surfaces result-event errors when the process exits cleanly", async () => {
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
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"q-4","model":"qwen-test"}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"error","is_error":true,"result":"permission denied"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "permission denied");
});

test("runQwenPromptStreaming fails when assistant text is followed by an error result event", async () => {
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
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"q-5","model":"qwen-test"}\n');
        child.stdout.emit("data", '{"type":"assistant","message":{"content":[{"type":"text","text":"partial answer"}]}}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"error","is_error":true,"result":"permission denied"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response, "partial answer");
  assert.equal(result.error, "permission denied");
});
