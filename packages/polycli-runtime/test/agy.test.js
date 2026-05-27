import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TRANSIENT_PROBE_ERROR_PATTERNS as AGY_TRANSIENT_PROBE_ERROR_PATTERNS } from "../src/agy.js";
import {
  buildAgyInvocation,
  extractAgyText,
  getAgyAuthStatus,
  getAgyAvailability,
  parseAgyTextResult,
  runAgyPrompt,
  runAgyPromptStreaming,
  stripAgyBenignStderr,
} from "../src/index.js";

function withFakeAgyBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-agy-sync-"));
  const bin = path.join(root, "agy");
  fs.writeFileSync(bin, source, { mode: 0o755 });

  try {
    return fn({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("buildAgyInvocation targets print mode with yolo and print timeout by default", () => {
  const invocation = buildAgyInvocation({
    prompt: "ping",
    printTimeoutSeconds: 30,
  });

  assert.deepEqual(invocation.args, [
    "--dangerously-skip-permissions",
    "--print-timeout",
    "30s",
    "-p",
    "ping",
  ]);
});

test("buildAgyInvocation supports sandbox, add-dir, conversation resume, and extra args", () => {
  const invocation = buildAgyInvocation({
    prompt: "ping",
    sandbox: true,
    addDirs: ["/tmp/a", "/tmp/b"],
    resumeConversationId: "agy-conv-1",
    continueLast: true,
    extraArgs: ["--log-file", "/tmp/agy.log"],
    printTimeoutSeconds: 4.4,
  });

  assert.deepEqual(invocation.args, [
    "--dangerously-skip-permissions",
    "--sandbox",
    "--conversation",
    "agy-conv-1",
    "--add-dir",
    "/tmp/a",
    "--add-dir",
    "/tmp/b",
    "--print-timeout",
    "4s",
    "--log-file",
    "/tmp/agy.log",
    "-p",
    "ping",
  ]);
});

test("buildAgyInvocation can disable yolo and use continue-last", () => {
  const invocation = buildAgyInvocation({
    prompt: "ping",
    yolo: false,
    continueLast: true,
  });

  assert.deepEqual(invocation.args, ["--continue", "-p", "ping"]);
});

test("parseAgyTextResult treats plain stdout as text delta events", () => {
  const parsed = parseAgyTextResult("hello\n\nworld\n");

  assert.equal(parsed.response, "hello\n\nworld");
  assert.deepEqual(parsed.events, [
    { type: "text_delta", delta: "hello" },
    { type: "text_delta", delta: "world" },
  ]);
  assert.equal(extractAgyText(parsed.events[0]), "hello");
});

test("stripAgyBenignStderr removes cwd reset lines but preserves real errors", () => {
  assert.equal(
    stripAgyBenignStderr("Shell cwd was reset to /tmp\nUnauthorized\n"),
    "Unauthorized"
  );
});

test("getAgyAvailability probes --help because agy has no --version flag", () => {
  withFakeAgyBin(
    `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") === "--help") {
  process.stdout.write("Usage: agy [options]\\n");
  process.exit(0);
}
process.exit(7);
`,
    ({ root, bin }) => {
      const availability = getAgyAvailability(root, { bin });

      assert.equal(availability.available, true);
      assert.match(availability.detail, /Usage: agy/);
    }
  );
});

test("getAgyAuthStatus returns authenticated when the prompt runner succeeds", () => {
  const auth = getAgyAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: true, model: null };
    },
  });

  assert.equal(auth.loggedIn, true);
  assert.equal(auth.detail, "authenticated");
  assert.equal(auth.model, null);
});

test("getAgyAuthStatus returns logged out on explicit auth errors", () => {
  const auth = getAgyAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "401 Unauthorized: please sign in" };
    },
  });

  assert.equal(auth.loggedIn, false);
  assert.match(auth.detail, /sign in/i);
});

test("getAgyAuthStatus treats transient probe errors as inconclusive authenticated", () => {
  assert.ok(AGY_TRANSIENT_PROBE_ERROR_PATTERNS.length > 0);

  const auth = getAgyAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "agy timed out after 30s" };
    },
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /inconclusive/i);
});

test("runAgyPrompt returns parsed success payloads without fabricating model or session", () => {
  withFakeAgyBin(
    `#!/usr/bin/env node
process.stdout.write("hello world\\n");
`,
    ({ root, bin }) => {
      const result = runAgyPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, true);
      assert.equal(result.response, "hello world");
      assert.deepEqual(result.events, [{ type: "text_delta", delta: "hello world" }]);
      assert.equal(result.status, 0);
      assert.equal(result.sessionId, null);
      assert.equal(result.model, null);
    }
  );
});

test("runAgyPrompt never fabricates a session id from a UUID in the answer text", () => {
  withFakeAgyBin(
    `#!/usr/bin/env node
process.stdout.write("Here is a sample id 123e4567-e89b-42d3-a456-426614174000 for you\\n");
`,
    ({ root, bin }) => {
      const result = runAgyPrompt({ prompt: "give me a uuid", cwd: root, bin });

      assert.equal(result.ok, true);
      assert.match(result.response, /123e4567-e89b-42d3-a456-426614174000/);
      assert.equal(result.sessionId, null);
    }
  );
});

test("runAgyPrompt reports no-visible-text on a clean exit with empty stdout", () => {
  withFakeAgyBin(
    `#!/usr/bin/env node
process.exit(0);
`,
    ({ root, bin }) => {
      const result = runAgyPrompt({ prompt: "ping", cwd: root, bin });

      assert.equal(result.ok, false);
      assert.equal(result.error, "agy produced no visible text");
      assert.equal(result.errorCode, "no_visible_text");
    }
  );
});

test("getAgyAuthStatus reports authenticated when an authed agy returns empty output", () => {
  const auth = getAgyAuthStatus(process.cwd(), {
    promptRunner() {
      // exit 0 with no visible text -> runAgyPrompt sets ok:false, status:0
      return { ok: false, status: 0, response: "", error: "agy produced no visible text" };
    },
  });

  assert.equal(auth.loggedIn, true);
  assert.equal(auth.detail, "authenticated");
});

test("getAgyAuthStatus detects a logged-out agy that prints sign-in guidance and exits 0", () => {
  const auth = getAgyAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: true, status: 0, response: "Please sign in at https://example.invalid to continue" };
    },
  });

  assert.equal(auth.loggedIn, false);
  assert.match(auth.detail, /sign in/i);
});

test("runAgyPromptStreaming reports failure and classifies auth errors on non-zero exit", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runAgyPromptStreaming({
    prompt: "ping",
    cwd: process.cwd(),
    timeout: 5_000,
    spawnImpl() {
      queueMicrotask(() => {
        child.stderr.emit("data", "login required\n");
        child.emit("close", 1, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "login required");
  assert.equal(result.errorCode, "auth");
  assert.equal(result.sessionId, null);
});

test("runAgyPrompt reports stderr text and classifies auth failures on non-zero exit", () => {
  withFakeAgyBin(
    `#!/usr/bin/env node
process.stderr.write("login required\\n");
process.exit(1);
`,
    ({ root, bin }) => {
      const result = runAgyPrompt({
        prompt: "ping",
        cwd: root,
        bin,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "login required");
      assert.equal(result.errorCode, "auth");
    }
  );
});

test("runAgyPromptStreaming emits text events for non-empty stdout lines", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};
  const events = [];

  const result = await runAgyPromptStreaming({
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

test("runAgyPromptStreaming ignores benign cwd reset stderr on successful output", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runAgyPromptStreaming({
    prompt: "ping",
    cwd: process.cwd(),
    timeout: 5_000,
    spawnImpl() {
      queueMicrotask(() => {
        child.stderr.emit("data", "Shell cwd was reset to /tmp\n");
        child.stdout.emit("data", "hello\n");
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
});
