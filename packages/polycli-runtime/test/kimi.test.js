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
  resolveKimiResumeSession,
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

test("buildKimiInvocation omits -p in stdin mode, defaults to yolo, and enables input-format text", () => {
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
    "--yolo",
    "-m",
    "kimi-k2",
    "-r",
    "123e4567-e89b-12d3-a456-426614174000",
  ]);
});

test("buildKimiInvocation omits --yolo when caller opts out", () => {
  const invocation = buildKimiInvocation({
    prompt: "ping",
    yolo: false,
  });

  assert.equal(invocation.args.includes("--yolo"), false);
});

test("resolveKimiResumeSession resolves and validates the last cwd session before spawn", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-cwd-"));
  const sessionId = "123e4567-e89b-42d3-a456-426614174000";
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;

  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    fs.mkdirSync(path.join(home, ".kimi"), { recursive: true });
    const realCwd = fs.realpathSync(cwd);
    fs.writeFileSync(
      path.join(home, ".kimi", "kimi.json"),
      `${JSON.stringify({ work_dirs: [{ path: realCwd, kaos: "local", last_session_id: sessionId }] })}\n`
    );

    const first = resolveKimiResumeSession({ cwd, resumeLast: true });
    assert.equal(first.ok, false);
    assert.match(first.error, /not found/i);

    fs.mkdirSync(path.join(home, ".kimi", "sessions", first.cwdHash, sessionId), { recursive: true });
    fs.writeFileSync(path.join(home, ".kimi", "sessions", first.cwdHash, sessionId, "context.jsonl"), "{}\n");

    const second = resolveKimiResumeSession({ cwd, resumeLast: true });
    assert.equal(second.ok, true);
    assert.equal(second.sessionId, sessionId);
  } finally {
    if (oldHome == null) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile == null) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("runKimiPromptStreaming rejects invalid explicit resume ids before spawn", async () => {
  const result = await runKimiPromptStreaming({
    prompt: "ping",
    cwd: process.cwd(),
    resumeSessionId: "not-a-uuid",
    spawnImpl() {
      throw new Error("spawn should not be called");
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /invalid sessionId format/i);
});

test("runKimiPromptStreaming warns when requested resume id differs from returned session", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-cwd-"));
  const requested = "123e4567-e89b-42d3-a456-426614174000";
  const returned = "223e4567-e89b-42d3-a456-426614174001";
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const resolved = resolveKimiResumeSession({ cwd, resumeSessionId: requested });
    fs.mkdirSync(path.join(home, ".kimi", "sessions", resolved.cwdHash, requested), { recursive: true });
    fs.writeFileSync(path.join(home, ".kimi", "sessions", resolved.cwdHash, requested, "context.jsonl"), "{}\n");

    const result = await runKimiPromptStreaming({
      prompt: "ping",
      cwd,
      resumeSessionId: requested,
      spawnImpl() {
        queueMicrotask(() => {
          child.stderr.emit("data", `To resume: kimi -r ${returned}\n`);
          child.stdout.emit("data", '{"role":"assistant","content":[{"type":"text","text":"hello"}]}\n');
          child.emit("close", 0, null);
        });
        return child;
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.resumeMismatched, true);
    assert.deepEqual(result.warnings, [
      `Warning: requested --resume ${requested} did not match returned session ${returned}`,
    ]);
  } finally {
    if (oldHome == null) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile == null) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
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
