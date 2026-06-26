import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import {
  buildCopilotInvocation,
  extractCopilotText,
  getCopilotAuthStatus,
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
    "--session-id",
    "cop-123",
  ]);
});

test("buildCopilotInvocation can keep programmatic mode while downgrading tool permissions", () => {
  const invocation = buildCopilotInvocation({
    prompt: "ping",
    allowAllTools: false,
    allowAllPaths: false,
    allowAllUrls: false,
    noAskUser: true,
    extraArgs: ["--excluded-tools", "bash,apply_patch"],
  });

  assert.deepEqual(invocation.args, [
    "-p",
    "ping",
    "--output-format",
    "json",
    "--stream",
    "off",
    "--no-ask-user",
    "--excluded-tools",
    "bash,apply_patch",
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

test("parseCopilotStreamText does not overwrite prior deltas with unrelated assistant.message content", () => {
  const parsed = parseCopilotStreamText(
    [
      '{"type":"session_start","sessionId":"cop-3","model":"copilot-test"}',
      '{"type":"assistant.message_delta","data":{"messageId":"m-1","deltaContent":"first"}}',
      '{"type":"assistant.message","data":{"messageId":"m-2","content":"second","phase":"final_answer"}}',
      '{"type":"result","sessionId":"cop-3","exitCode":0}',
    ].join("\n")
  );

  assert.equal(parsed.response, "first\nsecond");
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

test("runCopilotPrompt falls back to stderr session ids when stdout has none", () => {
  withFakeCopilotBin(
    `#!/usr/bin/env node
process.stderr.write("resume 123e4567-e89b-42d3-a456-426614174000\\n");
process.stdout.write(JSON.stringify({ type: "assistant.message", data: { messageId: "m-1", content: "hello world", phase: "final_answer" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", exitCode: 0 }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runCopilotPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.sessionId, "123e4567-e89b-42d3-a456-426614174000");
    }
  );
});

test("runCopilotPrompt does not leak stdout on non-zero exit", () => {
  withFakeCopilotBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "assistant.message", data: { content: "secret token", phase: "final_answer" } }) + "\\n");
process.exit(2);
`,
    ({ root, bin }) => {
      const result = runCopilotPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "copilot exited with code 2");
    }
  );
});

test("runCopilotPrompt maps special exit codes to semantic errors", () => {
  withFakeCopilotBin(
    `#!/usr/bin/env node
process.exit(130);
`,
    ({ root, bin }) => {
      const result = runCopilotPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "copilot interrupted");
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

test("runCopilotPromptStreaming captures standalone error events as terminal failures", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runCopilotPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"assistant.message_delta","data":{"messageId":"m-1","deltaContent":"partial"}}\n');
        child.stdout.emit("data", '{"type":"error","error":{"message":"permission denied"},"status":1}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response, "partial");
  assert.equal(result.error, "permission denied");
});

test("parseCopilotStreamText replays a captured real cli fixture", () => {
  const { stream, meta } = loadStreamFixture("copilot", "stream-success");
  const parsed = parseCopilotStreamText(stream);

  assert.equal(parsed.response, meta.expected.response);
  assert.equal(parsed.sessionId, meta.expected.sessionId);
});

test("getCopilotAuthStatus keeps loggedIn=true for a transient/timeout probe failure", () => {
  const auth = getCopilotAuthStatus(process.cwd(), {
    promptRunner: () => ({ ok: false, error: "copilot timed out after 30s" }),
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /inconclusive/i);
});

test("getCopilotAuthStatus reports loggedIn=false only on an explicit auth error", () => {
  const auth = getCopilotAuthStatus(process.cwd(), {
    promptRunner: () => ({ ok: false, error: "Not authenticated: please sign in" }),
  });

  assert.equal(auth.loggedIn, false);
  assert.match(auth.detail, /sign in/i);
});
