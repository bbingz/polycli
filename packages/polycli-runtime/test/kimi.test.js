import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import { TRANSIENT_PROBE_ERROR_PATTERNS as KIMI_TRANSIENT_PROBE_ERROR_PATTERNS } from "../src/kimi.js";
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

const RESUME_HINT = (id) =>
  JSON.stringify({ role: "meta", type: "session.resume_hint", session_id: id, command: `kimi --session ${id}` });

test("buildKimiInvocation targets kimi-code one-shot -p + stream-json (no --yolo/--print/--input-format)", () => {
  const invocation = buildKimiInvocation({
    prompt: "review this",
    model: "kimi-for-coding",
    resumeSessionId: "session_123e4567-e89b-42d3-a456-426614174000",
  });

  assert.deepEqual(invocation.args, [
    "-p",
    "review this",
    "--output-format",
    "stream-json",
    "-m",
    "kimi-for-coding",
    "--session",
    "session_123e4567-e89b-42d3-a456-426614174000",
  ]);
});

test("buildKimiInvocation uses -C for resume-last and omits resume flags for a fresh run", () => {
  assert.deepEqual(
    buildKimiInvocation({ prompt: "ping", resumeLast: true }).args,
    ["-p", "ping", "--output-format", "stream-json", "-C"]
  );
  assert.deepEqual(
    buildKimiInvocation({ prompt: "ping" }).args,
    ["-p", "ping", "--output-format", "stream-json"]
  );
});

test("parseKimiStreamText keeps assistant text, tool events, and reads the structured session id", () => {
  const parsed = parseKimiStreamText(
    [
      '{"role":"assistant","content":[{"type":"text","text":"hello"},{"type":"think","text":"hidden"}]}',
      '{"role":"tool","name":"bash","content":[{"type":"text","text":"ran"}]}',
      '{"role":"assistant","content":" world","model":"kimi-for-coding"}',
      RESUME_HINT("session_a3e525ea-0ad2-49b0-9feb-477ebd05a9ac"),
    ].join("\n")
  );

  assert.equal(parsed.response, "hello world");
  assert.equal(parsed.model, "kimi-for-coding");
  assert.equal(parsed.events.length, 4);
  assert.equal(parsed.toolEvents.length, 1);
  // The full `session_<uuid>` id is preserved (not the bare UUID a prose scan would yield).
  assert.equal(parsed.sessionId, "session_a3e525ea-0ad2-49b0-9feb-477ebd05a9ac");
});

test("parseKimiStreamText only adopts session_id from a session.resume_hint meta event", () => {
  // A meta event of a different type that happens to carry a session_id must NOT be promoted —
  // sessionId comes solely from the documented session.resume_hint event.
  const parsed = parseKimiStreamText(
    [
      '{"role":"meta","type":"session.start","session_id":"session_should-not-be-used"}',
      '{"role":"assistant","content":"hi"}',
    ].join("\n")
  );

  assert.equal(parsed.response, "hi");
  assert.equal(parsed.sessionId, null);
});

test("extractKimiText supports both string and array assistant content", () => {
  assert.equal(extractKimiText({ role: "assistant", content: "final body" }), "final body");
  assert.equal(
    extractKimiText({ role: "assistant", content: [{ type: "text", text: "ok" }] }),
    "ok"
  );
});

test("runKimiPrompt reads the structured session_<uuid> id and never fabricates from prose", () => {
  withFakeKimiBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ role: "assistant", content: "here is a uuid 123e4567-e89b-42d3-a456-426614174000" }) + "\\n");
process.stdout.write(${JSON.stringify(RESUME_HINT("session_a3e525ea-0ad2-49b0-9feb-477ebd05a9ac"))} + "\\n");
`,
    ({ root, bin }) => {
      const result = runKimiPrompt({ prompt: "give me a uuid", cwd: root, bin });

      assert.equal(result.ok, true);
      // The prose UUID is in the answer but is NEVER promoted to a sessionId; the structured
      // session.resume_hint id (with its `session_` prefix) is used instead.
      assert.match(result.response, /123e4567-e89b-42d3-a456-426614174000/);
      assert.equal(result.sessionId, "session_a3e525ea-0ad2-49b0-9feb-477ebd05a9ac");
    }
  );
});

test("runKimiPrompt leaves sessionId null when no resume_hint event is emitted (no fabrication)", () => {
  withFakeKimiBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ role: "assistant", content: "uuid 123e4567-e89b-42d3-a456-426614174000 in the answer" }) + "\\n");
`,
    ({ root, bin }) => {
      const result = runKimiPrompt({ prompt: "give me a uuid", cwd: root, bin });

      assert.equal(result.ok, true);
      assert.match(result.response, /123e4567/);
      assert.equal(result.sessionId, null);
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
      const result = runKimiPrompt({ prompt: "ping", cwd: root, bin });

      assert.equal(result.ok, false);
      assert.equal(result.error, "kimi exited with code 2");
    }
  );
});

test("runKimiPrompt normalizes a real spawn timeout so the auth probe stays inconclusive", () => {
  withFakeKimiBin(
    `#!/usr/bin/env node
setTimeout(() => {}, 5000);
`,
    ({ root, bin }) => {
      const result = runKimiPrompt({ prompt: "ping", cwd: root, bin, timeout: 200 });

      assert.equal(result.ok, false);
      assert.match(result.error, /kimi timed out after/i);

      const auth = getKimiAuthStatus(root, { promptRunner: () => result });
      assert.equal(auth.loggedIn, true);
      assert.match(auth.detail, /inconclusive/i);
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

test("getKimiAuthStatus routes named transient probe patterns to inconclusive auth", () => {
  assert.ok(KIMI_TRANSIENT_PROBE_ERROR_PATTERNS.length > 0);

  for (const pattern of KIMI_TRANSIENT_PROBE_ERROR_PATTERNS) {
    const error = "synthetic probe timed out";
    assert.match(error, pattern);
    const auth = getKimiAuthStatus(process.cwd(), {
      promptRunner() {
        return { ok: false, error };
      },
    });

    assert.equal(auth.loggedIn, true);
    assert.match(auth.detail, /inconclusive/i);
  }

  const auth = getKimiAuthStatus(process.cwd(), {
    promptRunner() {
      return { ok: false, error: "401 Unauthorized: bad token" };
    },
  });
  assert.equal(auth.loggedIn, false);
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
  assert.equal(result.errorCode, "binary_missing");
});

test("runKimiPromptStreaming captures the structured session id and emits events", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  const events = [];

  const result = await runKimiPromptStreaming({
    prompt: "ping",
    onEvent(event) {
      events.push(event);
    },
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"role":"assistant","content":"hello"}\n');
        child.stdout.emit("data", RESUME_HINT("session_a3e525ea-0ad2-49b0-9feb-477ebd05a9ac") + "\n");
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.response, "hello");
  assert.equal(result.sessionId, "session_a3e525ea-0ad2-49b0-9feb-477ebd05a9ac");
  assert.equal(events.length, 2);
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
        child.stdout.emit("data", '{"role":"assistant","content":[{"type":"think","text":"hidden"}]}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "kimi produced no visible text");
  assert.equal(result.errorCode, "no_visible_text");
});

test("parseKimiStreamText replays a captured real cli fixture", () => {
  const { stream, meta } = loadStreamFixture("kimi", "stream-success");
  const parsed = parseKimiStreamText(stream);

  assert.equal(parsed.response, meta.expected.response);
  assert.equal(parsed.events.length > 0, true);
});
