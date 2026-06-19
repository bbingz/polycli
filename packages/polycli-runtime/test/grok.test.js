import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildGrokInvocation,
  extractGrokText,
  getGrokAuthStatus,
  parseGrokJsonResult,
  parseGrokStreamText,
  runGrokPrompt,
  runGrokPromptStreaming,
} from "../src/index.js";

function withFakeGrokBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-grok-sync-"));
  const bin = path.join(root, "grok");
  fs.writeFileSync(bin, source, { mode: 0o755 });
  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("buildGrokInvocation builds the -p one-shot with model/effort/permission/approve/resume", () => {
  assert.deepEqual(
    buildGrokInvocation({ prompt: "hello", model: "grok-build", effort: "high", alwaysApprove: true }).args,
    ["-p", "hello", "--output-format", "json", "-m", "grok-build", "--effort", "high", "--always-approve"]
  );
  assert.deepEqual(
    buildGrokInvocation({ prompt: "rev", outputFormat: "streaming-json", permissionMode: "plan" }).args,
    ["-p", "rev", "--output-format", "streaming-json", "--permission-mode", "plan"]
  );
  assert.deepEqual(
    buildGrokInvocation({ prompt: "x", resumeSessionId: "019e8685-1031-70a0-9ac4-37dcbcefc163" }).args,
    ["-p", "x", "--output-format", "json", "-r", "019e8685-1031-70a0-9ac4-37dcbcefc163"]
  );
  assert.deepEqual(
    buildGrokInvocation({ prompt: "x", continueLast: true }).args,
    ["-p", "x", "--output-format", "json", "-c"]
  );
});

test("parseGrokJsonResult reads text + structured sessionId, never scanning prose", () => {
  const parsed = parseGrokJsonResult(
    JSON.stringify({ text: "answer with a uuid 123e4567-e89b-42d3-a456-426614174000", stopReason: "EndTurn", sessionId: "019e8685-1031-70a0-9ac4-37dcbcefc163", requestId: "r1" }),
    "",
    0
  );
  assert.equal(parsed.ok, true);
  assert.match(parsed.response, /123e4567/);
  assert.equal(parsed.sessionId, "019e8685-1031-70a0-9ac4-37dcbcefc163");
});

test("parseGrokJsonResult fails on a non-zero exit even with valid JSON", () => {
  const parsed = parseGrokJsonResult(JSON.stringify({ text: "partial" }), "boom", 2);
  assert.equal(parsed.ok, false);
});

test("parseGrokJsonResult fails on terminal error metadata even with visible text", () => {
  const parsed = parseGrokJsonResult(
    JSON.stringify({ text: "partial", stopReason: "error", error: "permission denied" }),
    "",
    0
  );

  assert.equal(parsed.ok, false);
  assert.equal(parsed.response, "partial");
  assert.equal(parsed.error, "permission denied");
});

test("parseGrokJsonResult fails on a NESTED error object whose payload is only a message", () => {
  // Regression: a nested error object ({error:{message:...}}) carries no type/is_error marker, so
  // the old recursion returned null and a visible-text response was wrongly reported ok:true.
  const parsed = parseGrokJsonResult(
    JSON.stringify({ text: "partial", error: { message: "permission denied" } }),
    "",
    0
  );

  assert.equal(parsed.ok, false);
  assert.equal(parsed.response, "partial");
  assert.equal(parsed.error, "permission denied");
});

test("parseGrokJsonResult does not flag an empty error object as a failure", () => {
  const parsed = parseGrokJsonResult(
    JSON.stringify({ text: "all good", error: {} }),
    "",
    0
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.error, null);
});

test("parseGrokJsonResult fails on a non-success stopReason alone (no error metadata) and keeps partial text", () => {
  // stopReason-only failure: no error field/event, so providerError is null and the failure must be
  // driven solely by isNonSuccessStopReason. Reverting that branch would flip ok back to true.
  const parsed = parseGrokJsonResult(
    JSON.stringify({ text: "partial answer", stopReason: "Cancelled", sessionId: "019e8685-1031-70a0-9ac4-37dcbcefc163" }),
    "",
    0
  );

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "grok stopped with Cancelled");
  assert.equal(parsed.response, "partial answer");
});

test("parseGrokJsonResult treats a MaxTokens truncation stopReason as success", () => {
  // grok emits MaxTokens when the answer is truncated at the output-token cap — a complete, visible
  // answer from the user's perspective, so it must stay ok=true rather than being marked failed.
  const parsed = parseGrokJsonResult(
    JSON.stringify({ text: "a long but truncated answer", stopReason: "MaxTokens", sessionId: "019e8685-1031-70a0-9ac4-37dcbcefc163" }),
    "",
    0
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.error, null);
  assert.equal(parsed.response, "a long but truncated answer");
});

test("parseGrokStreamText concatenates text deltas and reads sessionId from the end event", () => {
  const parsed = parseGrokStreamText(
    [
      '{"type":"thought","data":"thinking"}',
      '{"type":"text","data":"OK"}',
      '{"type":"text","data":"!"}',
      '{"type":"end","stopReason":"EndTurn","sessionId":"019e862e-63fd-7333-8f4c-4add60220323","requestId":"r2"}',
    ].join("\n")
  );
  assert.equal(parsed.response, "OK!");
  assert.equal(parsed.sessionId, "019e862e-63fd-7333-8f4c-4add60220323");
  assert.equal(extractGrokText({ type: "text", data: "z" }), "z");
  assert.equal(extractGrokText({ type: "thought", data: "z" }), "");
});

test("parseGrokStreamText records terminal error events and non-success stop reasons", () => {
  const parsed = parseGrokStreamText(
    [
      '{"type":"text","data":"partial"}',
      '{"type":"error","error":"permission denied"}',
      '{"type":"end","stopReason":"Cancelled","sessionId":"019e862e-63fd-7333-8f4c-4add60220323"}',
    ].join("\n")
  );

  assert.equal(parsed.response, "partial");
  assert.equal(parsed.stopReason, "Cancelled");
  assert.equal(parsed.providerError, "permission denied");
});

test("parseGrokStreamText captures a nested error object payload (message-only)", () => {
  const parsed = parseGrokStreamText(
    [
      '{"type":"text","data":"partial"}',
      '{"type":"error","error":{"message":"permission denied"}}',
      '{"type":"end","stopReason":"EndTurn"}',
    ].join("\n")
  );

  assert.equal(parsed.response, "partial");
  assert.equal(parsed.providerError, "permission denied");
});

test("runGrokPrompt parses json output and ignores transient stderr worker noise on success", () => {
  withFakeGrokBin(
    `#!/usr/bin/env node
process.stderr.write("ERROR worker quit with fatal: Transport channel closed\\n");
process.stdout.write(JSON.stringify({ text: "OK", stopReason: "EndTurn", sessionId: "019e8685-1031-70a0-9ac4-37dcbcefc163" }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runGrokPrompt({ prompt: "ping", cwd: root, bin });
      assert.equal(result.ok, true);
      assert.equal(result.response, "OK");
      assert.equal(result.sessionId, "019e8685-1031-70a0-9ac4-37dcbcefc163");
    }
  );
});

test("runGrokPrompt does not leak stdout on a non-zero exit", () => {
  withFakeGrokBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ text: "secret" }) + "\\n");
process.exit(2);
`,
    ({ root, bin }) => {
      const result = runGrokPrompt({ prompt: "ping", cwd: root, bin });
      assert.equal(result.ok, false);
      assert.match(result.error, /exited with code 2/i);
    }
  );
});

test("getGrokAuthStatus infers login state from `grok models` without spending a model call", () => {
  const authed = getGrokAuthStatus(process.cwd(), {
    runner: () => ({ error: null, status: 0, stdout: "You are logged in with grok.com.\n\nDefault model: grok-build\n", stderr: "" }),
  });
  assert.equal(authed.loggedIn, true);
  assert.equal(authed.model, "grok-build");

  const loggedOut = getGrokAuthStatus(process.cwd(), {
    runner: () => ({ error: null, status: 1, stdout: "", stderr: "Please log in with `grok login`." }),
  });
  assert.equal(loggedOut.loggedIn, false);
});

test("getGrokAuthStatus reads `not logged in` as logged out (banner substring must not win)", () => {
  // "not logged in" contains the substring "logged in"; the explicit auth-error check must run
  // before the generic "logged in" banner test, or this logged-out state flips to loggedIn:true.
  const auth = getGrokAuthStatus(process.cwd(), {
    runner: () => ({ error: null, status: 1, stdout: "You are not logged in. Run `grok login`.\n", stderr: "" }),
  });
  assert.equal(auth.loggedIn, false);
});

test("getGrokAuthStatus keeps loggedIn=true for a transient probe timeout", () => {
  const auth = getGrokAuthStatus(process.cwd(), {
    runner: () => ({ error: { code: "ETIMEDOUT", message: "spawnSync grok ETIMEDOUT" }, status: null, stdout: "", stderr: "" }),
  });
  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /inconclusive/i);
});

test("runGrokPromptStreaming emits events and reads the structured session id from end", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  const events = [];

  const result = await runGrokPromptStreaming({
    prompt: "ping",
    onEvent(event) {
      events.push(event);
    },
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"text","data":"OK"}\n');
        child.stdout.emit("data", '{"type":"end","stopReason":"EndTurn","sessionId":"019e862e-63fd-7333-8f4c-4add60220323"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.response, "OK");
  assert.equal(result.sessionId, "019e862e-63fd-7333-8f4c-4add60220323");
  assert.equal(events.length, 2);
});

test("runGrokPromptStreaming fails when partial text is followed by a terminal error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runGrokPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"text","data":"partial"}\n');
        child.stdout.emit("data", '{"type":"error","error":"permission denied"}\n');
        child.stdout.emit("data", '{"type":"end","stopReason":"Cancelled","sessionId":"019e862e-63fd-7333-8f4c-4add60220323"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response, "partial");
  assert.equal(result.error, "permission denied");
  assert.equal(result.stopReason, "Cancelled");
});

test("runGrokPromptStreaming fails on a non-success stopReason alone (no error event) and keeps partial text", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  // No error event — only a Cancelled stopReason. providerError is null so the failure must come
  // solely from isNonSuccessStopReason; this is the streaming mirror of the json stopReason-only path.
  const result = await runGrokPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"text","data":"partial"}\n');
        child.stdout.emit("data", '{"type":"end","stopReason":"Cancelled","sessionId":"019e862e-63fd-7333-8f4c-4add60220323"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response, "partial");
  assert.equal(result.error, "grok stopped with Cancelled");
  assert.equal(result.stopReason, "Cancelled");
});
