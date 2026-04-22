import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildOpenCodeInvocation,
  extractOpenCodeText,
  getOpenCodeAuthStatus,
  parseOpenCodeJsonResult,
  parseOpenCodeStreamText,
  runOpenCodePrompt,
  runOpenCodePromptStreaming,
} from "../src/index.js";

function withFakeOpenCodeBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-opencode-sync-"));
  const bin = path.join(root, "opencode");
  fs.writeFileSync(bin, source, { mode: 0o755 });

  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("buildOpenCodeInvocation targets run json mode with session support", () => {
  const invocation = buildOpenCodeInvocation({
    prompt: "ping",
    model: "anthropic/claude-sonnet-4.5",
    cwd: "/tmp/project",
    resumeSessionId: "open-1",
  });

  assert.deepEqual(invocation.args, [
    "run",
    "ping",
    "--format",
    "json",
    "--dir",
    "/tmp/project",
    "--dangerously-skip-permissions",
    "--model",
    "anthropic/claude-sonnet-4.5",
    "--session",
    "open-1",
  ]);
});

test("parseOpenCodeStreamText collects session id and assistant text", () => {
  const parsed = parseOpenCodeStreamText(
    [
      '{"type":"session.start","session":{"id":"open-1","model":"open-test"}}',
      '{"type":"message","role":"assistant","content":[{"type":"text","text":"hello "}]}',
      '{"type":"message.delta","delta":"world"}',
      '{"type":"result","text":"hello world"}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "open-1");
  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.events.length, 4);
  assert.equal(
    extractOpenCodeText({ type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] }),
    "ok"
  );
});

test("parseOpenCodeStreamText handles step text events from the real cli", () => {
  const parsed = parseOpenCodeStreamText(
    [
      '{"type":"step_start","sessionID":"open-2","part":{"sessionID":"open-2","type":"step-start"}}',
      '{"type":"text","sessionID":"open-2","part":{"sessionID":"open-2","type":"text","text":"hello world"}}',
      '{"type":"step_finish","sessionID":"open-2","part":{"sessionID":"open-2","type":"step-finish","reason":"stop"}}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "open-2");
  assert.equal(parsed.response, "hello world");
  assert.equal(
    extractOpenCodeText({ type: "text", part: { type: "text", text: "ok" } }),
    "ok"
  );
});

test("parseOpenCodeJsonResult extracts final response from raw event output", () => {
  const parsed = parseOpenCodeJsonResult(
    [
      '{"type":"session.start","session":{"id":"open-2"}}',
      '{"type":"result","text":"pong"}',
    ].join("\n"),
    "",
    0
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.response, "pong");
  assert.equal(parsed.sessionId, "open-2");
});

test("parseOpenCodeJsonResult does not leak stdout on non-zero exit", () => {
  const parsed = parseOpenCodeJsonResult(
    '{"type":"result","text":"secret token"}',
    "",
    2
  );

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "opencode exited with code 2");
});

test("runOpenCodePrompt returns parsed success payloads", () => {
  withFakeOpenCodeBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "session.start", session: { id: "open-sync-1", model: "open-test" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "text", sessionID: "open-sync-1", part: { sessionID: "open-sync-1", type: "text", text: "hello world" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", text: "hello world" }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runOpenCodePrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.response, "hello world");
      assert.equal(result.sessionId, "open-sync-1");
      assert.equal(result.model, "open-test");
    }
  );
});

test("runOpenCodePrompt falls back to stderr session ids when stdout has none", () => {
  withFakeOpenCodeBin(
    `#!/usr/bin/env node
process.stderr.write("resume 123e4567-e89b-42d3-a456-426614174000\\n");
process.stdout.write(JSON.stringify({ type: "text", part: { type: "text", text: "hello world" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", text: "hello world" }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runOpenCodePrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.sessionId, "123e4567-e89b-42d3-a456-426614174000");
    }
  );
});

test("getOpenCodeAuthStatus keeps loggedIn=true for transient probe failures", () => {
  const auth = getOpenCodeAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "opencode timed out after 30s" };
    },
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /timed out after 30s/i);
});

test("runOpenCodePromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runOpenCodePromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn opencode ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});
