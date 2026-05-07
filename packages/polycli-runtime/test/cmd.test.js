import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCmdInvocation,
  extractCmdText,
  getCmdAuthStatus,
  parseCmdTextResult,
  runCmdPrompt,
  runCmdPromptStreaming,
} from "../src/index.js";

function withFakeCmdBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-cmd-sync-"));
  const bin = path.join(root, "cmd");
  fs.writeFileSync(bin, source, { mode: 0o755 });

  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("buildCmdInvocation targets documented Command Code headless print mode with yolo by default", () => {
  const invocation = buildCmdInvocation({
    prompt: "ping",
    yolo: false,
    extraArgs: ["--permission-mode", "plan"],
  });

  assert.deepEqual(invocation.args, [
    "--skip-onboarding",
    "--permission-mode",
    "plan",
    "-p",
    "ping",
  ]);
});

test("buildCmdInvocation pushes --yolo by default", () => {
  const invocation = buildCmdInvocation({
    prompt: "ping",
  });

  assert.deepEqual(invocation.args, [
    "--skip-onboarding",
    "--yolo",
    "-p",
    "ping",
  ]);
});

test("buildCmdInvocation ignores resume flags because Command Code headless runs are standalone", () => {
  const invocation = buildCmdInvocation({
    prompt: "ping",
    yolo: false,
    resumeSessionId: "cmd-session",
    continueLast: true,
  });

  assert.deepEqual(invocation.args, [
    "--skip-onboarding",
    "-p",
    "ping",
  ]);
});

test("parseCmdTextResult treats plain stdout as the visible answer", () => {
  const parsed = parseCmdTextResult("hello world\n");

  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.events.length, 1);
  assert.deepEqual(parsed.events[0], { type: "text_delta", delta: "hello world" });
  assert.equal(extractCmdText(parsed.events[0]), "hello world");
});

test("runCmdPrompt returns parsed success payloads with deepseek as the default model", () => {
  withFakeCmdBin(
    `#!/usr/bin/env node
process.stdout.write("hello world\\n");
`,
    ({ root, bin }) => {
      const result = runCmdPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.response, "hello world");
      assert.equal(result.model, "deepseek");
    }
  );
});

test("runCmdPrompt reports empty successful output as unhealthy", () => {
  withFakeCmdBin(
    `#!/usr/bin/env node
process.exit(0);
`,
    ({ root, bin }) => {
      const result = runCmdPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "cmd produced no visible text");
    }
  );
});

test("getCmdAuthStatus reads authenticated status output without spending a model call", () => {
  withFakeCmdBin(
    `#!/usr/bin/env node
process.stdout.write("✔ Authenticated as tester\\n  Provider: Command Code\\n");
`,
    ({ root, bin }) => {
      const auth = getCmdAuthStatus(root, { bin });

      assert.equal(auth.loggedIn, true);
      assert.equal(auth.detail, "authenticated");
      assert.equal(auth.model, "deepseek");
    }
  );
});

test("runCmdPromptStreaming emits text events for plain stdout lines", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};
  const events = [];

  const result = await runCmdPromptStreaming({
    prompt: "ping",
    cwd: process.cwd(),
    timeout: 5_000,
    onEvent(event) {
      events.push(event);
    },
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", "hello\n");
        child.stdout.emit("data", "world\n");
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.response, "hello\nworld");
  assert.deepEqual(events, [
    { type: "text_delta", delta: "hello" },
    { type: "text_delta", delta: "world" },
  ]);
});
