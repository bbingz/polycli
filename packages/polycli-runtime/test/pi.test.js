import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import { TRANSIENT_PROBE_ERROR_PATTERNS as PI_TRANSIENT_PROBE_ERROR_PATTERNS } from "../src/pi.js";
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

test("buildPiInvocation does not inject --model when no model is passed", () => {
  const invocation = buildPiInvocation({
    prompt: "ping",
  });

  assert.deepEqual(invocation.args, [
    "--print",
    "--mode",
    "json",
    "ping",
  ]);
});

test("buildPiInvocation does not inject --model when model is explicitly null", () => {
  const invocation = buildPiInvocation({
    prompt: "ping",
    model: null,
  });

  assert.deepEqual(invocation.args, [
    "--print",
    "--mode",
    "json",
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

test("runPiPrompt never fabricates a sessionId from a UUID in the answer prose", () => {
  withFakePiBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "your uuid is 123e4567-e89b-42d3-a456-426614174000" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: { text: "your uuid is 123e4567-e89b-42d3-a456-426614174000" } }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runPiPrompt({ prompt: "give me a uuid", cwd: root, bin });

      assert.equal(result.ok, true);
      assert.match(result.response, /123e4567-e89b-42d3-a456-426614174000/);
      assert.equal(result.sessionId, null);
    }
  );
});

test("runPiPrompt leaves model null when neither caller nor pi reports a model", () => {
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
      assert.equal(result.model, null);
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

test("getPiAuthStatus routes named transient probe patterns to inconclusive auth", () => {
  assert.ok(PI_TRANSIENT_PROBE_ERROR_PATTERNS.length > 0);

  for (const pattern of PI_TRANSIENT_PROBE_ERROR_PATTERNS) {
    const error = "synthetic probe timed out";
    assert.match(error, pattern);
    const auth = getPiAuthStatus(process.cwd(), {
      promptRunner() {
        return { ok: false, error };
      },
    });

    assert.equal(auth.loggedIn, true);
    assert.match(auth.detail, /inconclusive/i);
  }

  const auth = getPiAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "401 Unauthorized: bad token" };
    },
  });
  assert.equal(auth.loggedIn, false);
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

test("parsePiStreamText extracts model from event.message.model when pi auto-routes", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"session","id":"pi-route-1","version":3}',
      '{"type":"message_start","message":{"role":"assistant","content":[],"provider":"xiaomi","model":"mimo-v2.5-pro"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"OK"}}',
      '{"type":"agent_end","result":{"text":"OK"}}',
    ].join("\n")
  );

  assert.equal(parsed.model, "mimo-v2.5-pro");
  assert.equal(parsed.providerError, null);
  assert.equal(parsed.response, "OK");
});

test("parsePiStreamText surfaces assistant errorMessage as providerError", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"session","id":"pi-err-1","version":3}',
      '{"type":"message_start","message":{"role":"assistant","content":[],"model":"gpt-5.4","stopReason":"error","errorMessage":"Your authentication token has been invalidated. Please try signing in again."}}',
      '{"type":"message_end","message":{"role":"assistant","content":[],"model":"gpt-5.4","stopReason":"error","errorMessage":"Your authentication token has been invalidated. Please try signing in again."}}',
      '{"type":"agent_end","messages":[]}',
    ].join("\n")
  );

  assert.equal(parsed.response, "");
  assert.match(parsed.providerError, /authentication token has been invalidated/);
});

test("parsePiStreamText falls back to stopReason=error when no errorMessage is set", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error"}}',
      '{"type":"agent_end","messages":[]}',
    ].join("\n")
  );

  assert.equal(parsed.providerError, "pi reported stopReason=error with no errorMessage");
});

test("parsePiStreamText does not flag providerError on a normal stop", () => {
  const parsed = parsePiStreamText(
    [
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hi"}],"stopReason":"stop"}}',
      '{"type":"agent_end","result":{"text":"hi"}}',
    ].join("\n")
  );

  assert.equal(parsed.providerError, null);
});

test("runPiPrompt reports providerError instead of 'no visible text' when pi returns an auth failure", () => {
  withFakePiBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Your authentication token has been invalidated. Please try signing in again." } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", messages: [] }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runPiPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /authentication token has been invalidated/);
      assert.doesNotMatch(result.error, /no visible text/);
    }
  );
});

test("parsePiStreamText replays a captured real cli fixture", () => {
  const { stream, meta } = loadStreamFixture("pi", "stream-success");
  const parsed = parsePiStreamText(stream);

  assert.equal(parsed.response, meta.expected.response);
  assert.equal(parsed.sessionId, meta.expected.sessionId);
});
