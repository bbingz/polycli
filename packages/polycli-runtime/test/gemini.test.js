import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildGeminiInvocation,
  extractGeminiText,
  getGeminiAuthStatus,
  parseGeminiStreamText,
  runGeminiPrompt,
  runGeminiPromptStreaming,
} from "../src/index.js";

function withFakeGeminiBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-gemini-sync-"));
  const bin = path.join(root, "gemini");
  fs.writeFileSync(bin, source, { mode: 0o755 });

  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

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
      '{"type":"message","role":"user","content":"ignore me"}',
      '{"type":"message","role":"assistant","content":"hello "}',
      '{"type":"message","role":"assistant","delta":"world"}',
      '{"type":"result","stats":{"turns":1}}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "gem-1");
  assert.equal(parsed.response, "hello world");
  assert.deepEqual(parsed.stats, { turns: 1 });
  assert.equal(parsed.events.length, 5);
  assert.equal(extractGeminiText({ type: "message", role: "assistant", delta: "ok" }), "ok");
  assert.equal(extractGeminiText({ type: "message", role: "user", content: "nope" }), "");
});

test("parseGeminiStreamText ignores non-assistant text fields", () => {
  const parsed = parseGeminiStreamText(
    [
      '{"type":"system","text":"ignore me"}',
      '{"type":"message","role":"assistant","content":"done"}',
    ].join("\n")
  );

  assert.equal(parsed.response, "done");
  assert.equal(extractGeminiText({ type: "system", text: "ignore me" }), "");
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

test("getGeminiAuthStatus keeps loggedIn=true for transient probe failures", () => {
  const auth = getGeminiAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "gemini timed out after 30s" };
    },
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /timed out after 30s/i);
});

test("getGeminiAuthStatus reports loggedIn=false for explicit auth failures", () => {
  const auth = getGeminiAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "401 unauthorized: please log in again" };
    },
  });

  assert.equal(auth.loggedIn, false);
  assert.match(auth.detail, /unauthorized/i);
});

test("runGeminiPrompt falls back to stderr session ids when stdout has none", () => {
  withFakeGeminiBin(
    `#!/usr/bin/env node
process.stderr.write("resume 123e4567-e89b-42d3-a456-426614174000\\n");
process.stdout.write(JSON.stringify({ response: "pong" }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runGeminiPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.sessionId, "123e4567-e89b-42d3-a456-426614174000");
    }
  );
});

test("runGeminiPromptStreaming returns an explicit error when no visible assistant text is emitted", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runGeminiPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"init","session_id":"gem-no-text"}\n');
        child.stdout.emit("data", '{"type":"result","stats":{"turns":1}}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "gemini produced no visible text");
});
