import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPiInvocation,
  extractPiText,
  parsePiStreamText,
  runPiPrompt,
  runPiPromptStreaming,
} from "../src/index.js";

function withFakePiBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-pi-sync-"));
  const bin = path.join(root, "pi");
  fs.writeFileSync(bin, source, { mode: 0o755 });

  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

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

test("parsePiStreamText captures top-level session envelope ids", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"session","id":"pi-live-1","version":3}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"OK"}}',
      '{"type":"agent_end","result":{"text":"OK"}}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "pi-live-1");
  assert.equal(parsed.response, "OK");
});

test("runPiPrompt returns parsed success payloads", () => {
  withFakePiBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "session_header", sessionId: "pi-sync-1", model: "pi-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello " } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "world" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: { text: "hello world" } }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runPiPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.response, "hello world");
      assert.equal(result.sessionId, "pi-sync-1");
      assert.equal(result.model, "pi-test");
    }
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
