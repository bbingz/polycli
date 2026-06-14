import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ensureStateDir, resolveStateFile } from "../lib/state.mjs";
import { handleLifecycleHook } from "../session-lifecycle-hook.mjs";
import {
  parseStopReviewOutput,
  resolveReviewProvider,
  runStopReview,
} from "../stop-review-gate-hook.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "../..");
const lifecycleHookPath = path.resolve(__dirname, "../session-lifecycle-hook.mjs");
const stopHookPath = path.resolve(__dirname, "../stop-review-gate-hook.mjs");

function withPluginData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-hooks-test-"));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dir;
  const cleanup = () => {
    if (previous == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn(dir);
    if (result && typeof result.then === "function") {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function writeWorkspaceState(workspaceRoot, state) {
  ensureStateDir(workspaceRoot);
  fs.writeFileSync(resolveStateFile(workspaceRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function runNode(script, args = [], { input = "", cwd = process.cwd(), env = {}, timeout = 3_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout after ${timeout}ms`));
    }, timeout);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function createFakeCompanion(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-companion-"));
  const script = path.join(root, "polycli-companion.bundle.mjs");
  fs.writeFileSync(script, `#!/usr/bin/env node\n${source}\n`, { mode: 0o755 });
  return {
    script,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("hooks.json registers SessionStart, SessionEnd, and Stop hooks with legacy command shape", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));

  assert.equal(hooks.description, "Session lifecycle and optional stop-time review gate for Polycli Companion.");
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].type, "command");
  assert.equal(
    hooks.hooks.SessionStart[0].hooks[0].command,
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs" SessionStart'
  );
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].timeout, 15);
  assert.equal(
    hooks.hooks.SessionEnd[0].hooks[0].command,
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs" SessionEnd'
  );
  assert.equal(hooks.hooks.SessionEnd[0].hooks[0].timeout, 5);
  assert.equal(
    hooks.hooks.Stop[0].hooks[0].command,
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/stop-review-gate-hook.mjs"'
  );
  assert.equal(hooks.hooks.Stop[0].hooks[0].timeout, 900);
});

test("SessionStart exports the Claude session id for later companion jobs", async () => {
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-env-")), "env.sh");
  try {
    const result = await runNode(lifecycleHookPath, ["SessionStart"], {
      input: JSON.stringify({ session_id: "cc-session-1" }),
      env: { CLAUDE_ENV_FILE: envFile },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(fs.readFileSync(envFile, "utf8"), /export POLYCLI_COMPANION_SESSION_ID='cc-session-1'/);
  } finally {
    fs.rmSync(path.dirname(envFile), { recursive: true, force: true });
  }
});

test("SessionEnd removes only running jobs from the ended session and preserves terminal results", () => {
  withPluginData(() => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 1,
        jobs: [
          { jobId: "pa-running", sessionId: "cc-session-1", status: "running", pid: null },
          { jobId: "pa-done", sessionId: "cc-session-1", status: "completed", pid: null },
          { jobId: "pa-other", sessionId: "cc-session-2", status: "running", pid: null },
        ],
      });

      handleLifecycleHook("SessionEnd", { cwd: workspaceRoot, session_id: "cc-session-1" });

      const state = JSON.parse(fs.readFileSync(resolveStateFile(workspaceRoot), "utf8"));
      assert.deepEqual(state.jobs.map((job) => job.jobId).sort(), ["pa-done", "pa-other"]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd does not try to terminate unsafe pid values", (t) => {
  withPluginData(() => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const kill = t.mock.method(process, "kill", () => {
      throw new Error("process.kill should not be called for unsafe pid values");
    });
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 1,
        jobs: [
          { jobId: "pa-one", sessionId: "cc-session-1", status: "running", pid: 1 },
          { jobId: "pa-zero", sessionId: "cc-session-1", status: "running", pid: 0 },
          { jobId: "pa-negative", sessionId: "cc-session-1", status: "running", pid: -42 },
          { jobId: "pa-float", sessionId: "cc-session-1", status: "running", pid: 42.5 },
        ],
      });

      handleLifecycleHook("SessionEnd", { cwd: workspaceRoot, session_id: "cc-session-1" });

      assert.equal(kill.mock.callCount(), 0);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd state cleanup uses the locked state updater", () => {
  const source = fs.readFileSync(lifecycleHookPath, "utf8");

  assert.match(source, /\bupdateState\b/);
  assert.doesNotMatch(source, /\bloadState\b/);
  assert.doesNotMatch(source, /\bsaveState\b/);
});

test("parseStopReviewOutput scans all lines for a prose-prefixed BLOCK sentinel", () => {
  const result = parseStopReviewOutput("好的，这是审查：\nThe work is not done yet.\nBLOCK: tests were not run");

  assert.equal(result.ok, false);
  assert.match(result.error, /tests were not run/);
});

test("parseStopReviewOutput allows prose-prefixed ALLOW sentinel", () => {
  const result = parseStopReviewOutput("Here is my review:\nALLOW: no blockers");

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
});

test("runStopReview timeout returns a clean non-blocking skip result", () => {
  const fake = createFakeCompanion(`
await new Promise((resolve) => setTimeout(resolve, 100));
`);
  try {
    const result = runStopReview({
      cwd: process.cwd(),
      companionPath: fake.script,
      provider: "qwen",
      input: { last_assistant_message: "done" },
      timeoutMs: 5,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.note, /timed out after 15 minutes/);
  } finally {
    fake.cleanup();
  }
});

test("resolveReviewProvider skips cleanly when no last-used provider and health finds none", () => {
  withPluginData(() => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const fake = createFakeCompanion(`
if (process.argv[2] === "health") {
  process.stdout.write(JSON.stringify({ anyHealthy: false, healthyProviders: [], results: [] }) + "\\n");
  process.exit(2);
}
process.exit(9);
`);
    try {
      writeWorkspaceState(workspaceRoot, { version: 1, config: { stopReviewGate: true }, jobs: [] });

      const result = resolveReviewProvider({
        workspaceRoot,
        companionPath: fake.script,
        cwd: workspaceRoot,
      });

      assert.equal(result.provider, null);
      assert.match(result.reason, /No current provider/);
    } finally {
      fake.cleanup();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("resolveReviewProvider prefers the recorded last-used provider over health fallback", () => {
  withPluginData(() => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const fake = createFakeCompanion(`
if (process.argv[2] === "health") {
  process.stdout.write(JSON.stringify({ anyHealthy: true, healthyProviders: ["gemini"], results: [] }) + "\\n");
  process.exit(0);
}
process.exit(9);
`);
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 1,
        config: { stopReviewGate: true, lastUsedProvider: "qwen" },
        jobs: [],
      });

      const result = resolveReviewProvider({
        workspaceRoot,
        companionPath: fake.script,
        cwd: workspaceRoot,
      });

      assert.equal(result.provider, "qwen");
      assert.equal(result.source, "last-used");
    } finally {
      fake.cleanup();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("resolveReviewProvider uses the first healthy provider when no last-used provider is recorded", () => {
  withPluginData(() => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const fake = createFakeCompanion(`
if (process.argv[2] === "health") {
  process.stdout.write(JSON.stringify({ anyHealthy: true, healthyProviders: ["gemini", "qwen"], results: [] }) + "\\n");
  process.exit(0);
}
process.exit(9);
`);
    try {
      writeWorkspaceState(workspaceRoot, { version: 1, config: { stopReviewGate: true }, jobs: [] });

      const result = resolveReviewProvider({
        workspaceRoot,
        companionPath: fake.script,
        cwd: workspaceRoot,
      });

      assert.equal(result.provider, "gemini");
      assert.equal(result.source, "health");
    } finally {
      fake.cleanup();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("Stop hook skips without blocking when provider cannot be resolved", async () => {
  const fake = createFakeCompanion(`
if (process.argv[2] === "health") {
  process.stdout.write(JSON.stringify({ anyHealthy: false, healthyProviders: [], results: [] }) + "\\n");
  process.exit(2);
}
process.exit(9);
`);
  try {
    await withPluginData(async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
      try {
        writeWorkspaceState(workspaceRoot, { version: 1, config: { stopReviewGate: true }, jobs: [] });
        const result = await runNode(stopHookPath, [], {
          cwd: workspaceRoot,
          input: JSON.stringify({ cwd: workspaceRoot, last_assistant_message: "done" }),
          env: {
            POLYCLI_COMPANION_PATH: fake.script,
          },
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /No current provider/);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  } finally {
    fake.cleanup();
  }
});
