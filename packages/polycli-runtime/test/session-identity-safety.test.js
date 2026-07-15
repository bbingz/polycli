import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  runClaudePrompt,
  runClaudePromptStreaming,
  runCopilotPrompt,
  runCopilotPromptStreaming,
  runOpenCodePrompt,
  runOpenCodePromptStreaming,
  runQwenPrompt,
  runQwenPromptStreaming,
} from "../src/index.js";

const PROSE_UUID = "123e4567-e89b-42d3-a456-426614174000";
const STRUCTURED_UUID = "223e4567-e89b-42d3-a456-426614174000";
const RESUME_UUID = "323e4567-e89b-42d3-a456-426614174000";

function createFakeChild({ stdout, stderr = "" }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.write = () => true;
  child.stdin.end = () => {};
  child.kill = () => true;
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", 0, null);
  });
  return child;
}

const PROVIDERS = [
  {
    provider: "claude",
    sync: runClaudePrompt,
    streaming: runClaudePromptStreaming,
    syncStdout(response, sessionId = null) {
      return JSON.stringify({ type: "result", subtype: "success", result: response, ...(sessionId ? { session_id: sessionId } : {}) });
    },
    streamStdout(response, sessionId = null) {
      return [
        JSON.stringify({ type: "system", subtype: "init", ...(sessionId ? { session_id: sessionId } : {}) }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: response }] } }),
        JSON.stringify({ type: "result", subtype: "success", result: response, ...(sessionId ? { session_id: sessionId } : {}) }),
      ].join("\n") + "\n";
    },
  },
  {
    provider: "copilot",
    sync: runCopilotPrompt,
    streaming: runCopilotPromptStreaming,
    syncStdout(response, sessionId = null) {
      return JSON.stringify({ type: "result", result: response, ...(sessionId ? { sessionId } : {}) }) + "\n";
    },
    streamStdout(response, sessionId = null) {
      return this.syncStdout(response, sessionId);
    },
  },
  {
    provider: "opencode",
    sync: runOpenCodePrompt,
    streaming: runOpenCodePromptStreaming,
    syncStdout(response, sessionId = null) {
      return JSON.stringify({ type: "text", part: { text: response, ...(sessionId ? { sessionID: sessionId } : {}), model: "test" } }) + "\n";
    },
    streamStdout(response, sessionId = null) {
      return this.syncStdout(response, sessionId);
    },
  },
  {
    provider: "qwen",
    sync: runQwenPrompt,
    streaming: runQwenPromptStreaming,
    syncStdout(response, sessionId = null) {
      return [
        ...(sessionId ? [JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: "test" })] : []),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: response }] } }),
        JSON.stringify({ type: "result", subtype: "success", is_error: false, result: response }),
      ].join("\n") + "\n";
    },
    streamStdout(response, sessionId = null) {
      return this.syncStdout(response, sessionId);
    },
  },
];

function syncRun(entry, stdout, stderr = "") {
  return entry.sync({
    prompt: "short",
    env: {},
    cwd: process.cwd(),
    defaultModel: "test",
    bin: `${entry.provider}-fake`,
    spawnImpl() {
      return { status: 0, signal: null, stdout, stderr, error: null };
    },
  });
}

function streamingRun(entry, stdout, stderr = "") {
  return entry.streaming({
    prompt: "short",
    env: {},
    cwd: process.cwd(),
    defaultModel: "test",
    bin: `${entry.provider}-fake`,
    spawnImpl() {
      return createFakeChild({ stdout, stderr });
    },
  });
}

for (const mode of ["sync", "streaming"]) {
  test(`session identity ${mode}: prose UUID stays null for all four providers`, async (t) => {
    for (const entry of PROVIDERS) {
      await t.test(entry.provider, async () => {
        const stdout = entry[mode === "sync" ? "syncStdout" : "streamStdout"](`answer mentions ${PROSE_UUID}`);
        const result = mode === "sync" ? syncRun(entry, stdout) : await streamingRun(entry, stdout);
        assert.equal(result.ok, true);
        assert.equal(result.sessionId, null);
      });
    }
  });

  test(`session identity ${mode}: structured fields are preserved for all four providers`, async (t) => {
    for (const entry of PROVIDERS) {
      await t.test(entry.provider, async () => {
        const stdout = entry[mode === "sync" ? "syncStdout" : "streamStdout"]("ok", STRUCTURED_UUID);
        const result = mode === "sync" ? syncRun(entry, stdout) : await streamingRun(entry, stdout);
        assert.equal(result.ok, true);
        assert.equal(result.sessionId, STRUCTURED_UUID);
      });
    }
  });

  test(`session identity ${mode}: standalone stderr resume line remains compatible`, async (t) => {
    for (const entry of PROVIDERS) {
      await t.test(entry.provider, async () => {
        const stdout = entry[mode === "sync" ? "syncStdout" : "streamStdout"]("ok");
        const result = mode === "sync"
          ? syncRun(entry, stdout, `resume ${RESUME_UUID}\n`)
          : await streamingRun(entry, stdout, `resume ${RESUME_UUID}\n`);
        assert.equal(result.ok, true);
        assert.equal(result.sessionId, RESUME_UUID);
      });
    }
  });

  test(`session identity ${mode}: UUID embedded in stderr prose stays null`, async (t) => {
    for (const entry of PROVIDERS) {
      await t.test(entry.provider, async () => {
        const stdout = entry[mode === "sync" ? "syncStdout" : "streamStdout"]("ok");
        const stderr = `warning: resume ${RESUME_UUID} after reconnect`;
        const result = mode === "sync" ? syncRun(entry, stdout, stderr) : await streamingRun(entry, stdout, stderr);
        assert.equal(result.ok, true);
        assert.equal(result.sessionId, null);
      });
    }
  });
}
