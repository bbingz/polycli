import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import {
  buildPiInvocation,
  extractPiText,
  getPiAuthStatus,
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

test("buildPiInvocation defaults pi to openai-codex/gpt-5.4", () => {
  const invocation = buildPiInvocation({
    prompt: "ping",
  });

  assert.deepEqual(invocation.args, [
    "--print",
    "--mode",
    "json",
    "--model",
    "openai-codex/gpt-5.4",
    "ping",
  ]);
});

test("buildPiInvocation defaults pi when model is explicitly null", () => {
  const invocation = buildPiInvocation({
    prompt: "ping",
    model: null,
  });

  assert.deepEqual(invocation.args, [
    "--print",
    "--mode",
    "json",
    "--model",
    "openai-codex/gpt-5.4",
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
  assert.equal(parsed.model, "pi-test");
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

test("parsePiStreamText ignores unrelated text fields", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"tool_result","text":"ignore me"}',
      '{"type":"agent_end","result":{"text":"done"}}',
    ].join("\n")
  );

  assert.equal(parsed.response, "done");
  assert.equal(extractPiText({ type: "tool_result", text: "ignore me" }), "");
});

test("parsePiStreamText does not duplicate repeated terminal assistant summaries", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"session","id":"pi-live-1","version":3}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"OK"}}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"OK"}]}}',
      '{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"OK"}]}}',
      '{"type":"agent_end","result":{"text":"OK"},"messages":[{"role":"assistant","content":[{"type":"text","text":"OK"}]}]}',
    ].join("\n")
  );

  assert.equal(parsed.response, "OK");
});

test("parsePiStreamText uses the latest terminal assistant text when there are no deltas", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"session","id":"pi-terminal-1","version":3}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"partial"}]}}',
      '{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"complete"}]}}',
      '{"type":"agent_end","result":{"text":"complete final"}}',
    ].join("\n")
  );

  assert.equal(parsed.response, "complete final");
});

test("parsePiStreamText prefers a longer terminal result when streaming is partial", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"session","id":"pi-terminal-2","version":3}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"part"}}',
      '{"type":"agent_end","result":{"text":"partial final"}}',
    ].join("\n")
  );

  assert.equal(parsed.response, "partial final");
});

test("parsePiStreamText treats terminal result as authoritative even when shorter than streamed deltas", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"session","id":"pi-terminal-3","version":3}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"draft answer with transient text"}}',
      '{"type":"agent_end","result":{"text":"final"}}',
    ].join("\n")
  );

  assert.equal(parsed.response, "final");
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

test("runPiPrompt falls back to stderr session ids when stdout has none", () => {
  withFakePiBin(
    `#!/usr/bin/env node
process.stderr.write("resume 123e4567-e89b-42d3-a456-426614174000\\n");
process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello world" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: { text: "hello world" } }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runPiPrompt({
        prompt: "ping",
        cwd: root,
        defaultModel: "pi-fallback",
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.sessionId, "123e4567-e89b-42d3-a456-426614174000");
      assert.equal(result.model, "pi-fallback");
    }
  );
});

test("runPiPrompt reports the default pi model when events omit model metadata", () => {
  withFakePiBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello world" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: { text: "hello world" } }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runPiPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.model, "openai-codex/gpt-5.4");
    }
  );
});

test("runPiPrompt does not leak stdout on non-zero exit", () => {
  withFakePiBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "agent_end", result: { text: "secret token" } }) + "\\n");
process.exit(2);
`,
    ({ root, bin }) => {
      const result = runPiPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "pi exited with code 2");
    }
  );
});

test("getPiAuthStatus keeps loggedIn=true for transient probe failures", () => {
  const auth = getPiAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "pi timed out after 30s" };
    },
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /timed out after 30s/i);
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

test("parsePiStreamText replays a captured real cli fixture", () => {
  const { stream, meta } = loadStreamFixture("pi", "stream-success");
  const parsed = parsePiStreamText(stream);

  assert.equal(parsed.response, meta.expected.response);
  assert.equal(parsed.sessionId, meta.expected.sessionId);
});
