import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import {
  buildKimiInvocation,
  extractKimiText,
  getKimiAuthStatus,
  parseKimiStreamText,
  runKimiPrompt,
  runKimiPromptStreaming,
} from "../src/index.js";

function withFakeKimiBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-sync-"));
  const bin = path.join(root, "kimi");
  fs.writeFileSync(bin, source, { mode: 0o755 });

  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("buildKimiInvocation omits -p in stdin mode and enables input-format text", () => {
  const invocation = buildKimiInvocation({
    prompt: "x".repeat(100_000),
    model: "kimi-k2",
    resumeSessionId: "123e4567-e89b-12d3-a456-426614174000",
  });

  assert.equal(invocation.useStdin, true);
  assert.equal(invocation.input.length, 100_000);
  assert.deepEqual(invocation.args, [
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "-m",
    "kimi-k2",
    "-r",
    "123e4567-e89b-12d3-a456-426614174000",
  ]);
});

test("parseKimiStreamText keeps assistant text and tool events separate", () => {
  const parsed = parseKimiStreamText(
    [
      '{"role":"assistant","content":[{"type":"text","text":"hello"},{"type":"think","text":"hidden"}]}',
      '{"role":"tool","name":"bash","content":[{"type":"text","text":"ran"}]}',
      '{"role":"assistant","content":[{"type":"text","text":" world"}],"model":"kimi-k2"}',
    ].join("\n")
  );

  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.model, "kimi-k2");
  assert.equal(parsed.events.length, 3);
  assert.equal(parsed.toolEvents.length, 1);
  assert.equal(extractKimiText({ role: "assistant", content: [{ type: "text", text: "ok" }] }), "ok");
});

test("extractKimiText supports string assistant content", () => {
  assert.equal(
    extractKimiText({ role: "assistant", content: "final review body" }),
    "final review body"
  );
});

test("runKimiPrompt prefers stdout session ids before stderr fallback", () => {
  withFakeKimiBin(
    `#!/usr/bin/env node
process.stdout.write("stdout session 123e4567-e89b-42d3-a456-426614174000\\n");
process.stderr.write("stderr session 223e4567-e89b-42d3-a456-426614174000\\n");
process.stdout.write(JSON.stringify({ role: "assistant", content: [{ type: "text", text: "hello world" }] }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runKimiPrompt({
        prompt: "ping",
        cwd: root,
        defaultModel: "kimi-fallback",
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.sessionId, "123e4567-e89b-42d3-a456-426614174000");
      assert.equal(result.model, "kimi-fallback");
    }
  );
});

test("runKimiPrompt does not leak stdout on non-zero exit", () => {
  withFakeKimiBin(
    `#!/usr/bin/env node
process.stdout.write("secret token\\n");
process.exit(2);
`,
    ({ root, bin }) => {
      const result = runKimiPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "kimi exited with code 2");
    }
  );
});

test("getKimiAuthStatus keeps loggedIn=true for transient probe failures", () => {
  const auth = getKimiAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "kimi timed out after 30s" };
    },
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /timed out after 30s/i);
});

test("runKimiPromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runKimiPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn kimi ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test("runKimiPromptStreaming returns an explicit error when no visible assistant text is emitted", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runKimiPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stderr.emit("data", "To resume: kimi -r 123\n");
        child.stdout.emit("data", '{"role":"assistant","content":[{"type":"think","text":"hidden"}]}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "kimi produced no visible text");
});

test("parseKimiStreamText replays a captured real cli fixture", () => {
  const { stream, meta } = loadStreamFixture("kimi", "stream-success");
  const parsed = parseKimiStreamText(stream);

  assert.equal(parsed.response, meta.expected.response);
  assert.equal(parsed.events.length > 0, true);
});
