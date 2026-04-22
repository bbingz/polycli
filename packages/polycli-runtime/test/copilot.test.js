import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCopilotInvocation,
  extractCopilotText,
  parseCopilotStreamText,
  runCopilotPrompt,
  runCopilotPromptStreaming,
} from "../src/index.js";

function withFakeCopilotBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-copilot-sync-"));
  const bin = path.join(root, "copilot");
  fs.writeFileSync(bin, source, { mode: 0o755 });

  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("buildCopilotInvocation enables programmatic json mode with permissions and resume", () => {
  const invocation = buildCopilotInvocation({
    prompt: "ping",
    model: "gpt-5.3-codex",
    resumeSessionId: "cop-123",
  });

  assert.deepEqual(invocation.args, [
    "-p",
    "ping",
    "--output-format",
    "json",
    "--stream",
    "off",
    "--allow-all-tools",
    "--allow-all-paths",
    "--allow-all-urls",
    "--no-ask-user",
    "--model",
    "gpt-5.3-codex",
    "--resume",
    "cop-123",
  ]);
});

test("parseCopilotStreamText collects session id and assistant text from jsonl", () => {
  const parsed = parseCopilotStreamText(
    [
      '{"type":"session_start","sessionId":"cop-1","model":"copilot-test"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello "}]}}',
      '{"type":"assistant","delta":"world"}',
      '{"type":"result","result":"hello world","sessionId":"cop-1"}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "cop-1");
  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.events.length, 4);
  assert.equal(
    extractCopilotText({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }),
    "ok"
  );
});

test("parseCopilotStreamText handles real assistant.message event shapes", () => {
  const parsed = parseCopilotStreamText(
    [
      '{"type":"session_start","sessionId":"cop-2","model":"copilot-test"}',
      '{"type":"assistant.message_delta","data":{"messageId":"m-1","deltaContent":"hello "}}',
      '{"type":"assistant.message","data":{"messageId":"m-1","content":"hello world","phase":"final_answer"}}',
      '{"type":"result","sessionId":"cop-2","exitCode":0}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "cop-2");
  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.resultEvent?.type, "result");
  assert.equal(
    extractCopilotText({ type: "assistant.message_delta", data: { deltaContent: "chunk" } }),
    "chunk"
  );
  assert.equal(
    extractCopilotText({ type: "assistant.message", data: { content: "final body", phase: "final_answer" } }),
    "final body"
  );
});

test("runCopilotPrompt returns parsed success payloads", () => {
  withFakeCopilotBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "session_start", sessionId: "cop-sync-1", model: "copilot-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "assistant.message_delta", data: { messageId: "m-1", deltaContent: "hello " } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "assistant.message", data: { messageId: "m-1", content: "hello world", phase: "final_answer" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", sessionId: "cop-sync-1", exitCode: 0 }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runCopilotPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.response, "hello world");
      assert.equal(result.sessionId, "cop-sync-1");
      assert.equal(result.model, "copilot-test");
    }
  );
});

test("runCopilotPromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runCopilotPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn copilot ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});
