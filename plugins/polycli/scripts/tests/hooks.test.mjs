import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ensureStateDir,
  listJobs,
  readJobFile,
  resolveJobConfigFile,
  resolveJobFile,
  resolveStateFile,
  writeJobConfigFile,
} from "../lib/state.mjs";
import { readRunLedgerEvents } from "../lib/run-ledger.mjs";
import {
  cleanupSessionJobs,
  handleLifecycleHook,
  SESSION_END_BUDGET_MS,
} from "../session-lifecycle-hook.mjs";
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
  assert.ok(
    SESSION_END_BUDGET_MS < hooks.hooks.SessionEnd[0].hooks[0].timeout * 1_000,
    "the in-process cancellation deadline must leave time for hook startup and exit",
  );
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

test("SessionEnd cancels only active jobs from the ended session and preserves terminal results", async () => {
  await withPluginData(async () => {
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

      await handleLifecycleHook("SessionEnd", { cwd: workspaceRoot, session_id: "cc-session-1" });

      const state = JSON.parse(fs.readFileSync(resolveStateFile(workspaceRoot), "utf8"));
      assert.deepEqual(
        state.jobs.map((job) => [job.jobId, job.status]).sort(),
        [["pa-done", "completed"], ["pa-other", "running"], ["pa-running", "cancelled"]],
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd matches explicit hostSessionId and never matches providerSessionId", async () => {
  await withPluginData(async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 2,
        jobs: [
          {
            jobId: "host-match",
            hostSessionId: "ended-host",
            providerSessionId: "upstream-a",
            sessionId: "upstream-a",
            status: "running",
            pid: null,
          },
          {
            jobId: "provider-only-match",
            hostSessionId: "other-host",
            providerSessionId: "ended-host",
            sessionId: "ended-host",
            status: "running",
            pid: null,
          },
        ],
      });

      await handleLifecycleHook("SessionEnd", { cwd: workspaceRoot, session_id: "ended-host" });

      const state = JSON.parse(fs.readFileSync(resolveStateFile(workspaceRoot), "utf8"));
      assert.deepEqual(
        state.jobs.map((job) => [job.jobId, job.status]).sort(),
        [["host-match", "cancelled"], ["provider-only-match", "running"]],
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd does not try to terminate unsafe pid values", async (t) => {
  await withPluginData(async () => {
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

      await handleLifecycleHook("SessionEnd", { cwd: workspaceRoot, session_id: "cc-session-1" });

      assert.equal(kill.mock.callCount(), 0);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd signals only a worker whose command line matches its retained config", async () => {
  await withPluginData(async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const terminated = [];
    const observedDeadlines = [];
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 2,
        jobs: [
          { jobId: "mismatched-worker", hostSessionId: "ended", status: "running", pid: 4242 },
          { jobId: "verified-worker", hostSessionId: "ended", status: "running", pid: 4343 },
        ],
      });
      const jobsDir = path.join(path.dirname(resolveStateFile(workspaceRoot)), "jobs");
      fs.mkdirSync(jobsDir, { recursive: true });
      fs.writeFileSync(path.join(jobsDir, "verified-worker.config.json"), "{}\n", "utf8");

      const alive = new Map([[4242, true], [4343, true]]);
      await cleanupSessionJobs(workspaceRoot, "ended", {
        isExpectedWorkerProcess(pid, _configFile, options) {
          observedDeadlines.push(options?.deadlineAt);
          return pid === 4343;
        },
        isWorkerAlive(pid) {
          return alive.get(pid) === true;
        },
        async terminateProcess(pid, options) {
          terminated.push(pid);
          observedDeadlines.push(options?.deadlineAt);
          alive.set(pid, false);
        },
      });

      assert.deepEqual(terminated, [4343]);
      assert.equal(observedDeadlines.length, 2);
      assert.ok(observedDeadlines.every((deadline) => Number.isFinite(deadline)));
      assert.equal(new Set(observedDeadlines).size, 1, "identity and termination must share one hook deadline");
      const state = JSON.parse(fs.readFileSync(resolveStateFile(workspaceRoot), "utf8"));
      assert.deepEqual(
        state.jobs.map((job) => [job.jobId, job.status]).sort(),
        [["mismatched-worker", "running"], ["verified-worker", "cancelled"]],
      );
      assert.equal(readJobFile(resolveJobFile(workspaceRoot, "mismatched-worker"))?.cancellationIntent?.status, "requested");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd delegates lifecycle ownership to cancelJob", () => {
  const source = fs.readFileSync(lifecycleHookPath, "utf8");

  assert.match(source, /\bcancelJob\b/);
  assert.doesNotMatch(source, /\bupdateState\b/);
  assert.doesNotMatch(source, /\bloadState\b/);
  assert.doesNotMatch(source, /\bsaveState\b/);
});

test("SessionEnd preserves unverifiable workers while cancelling other matching jobs", async () => {
  await withPluginData(async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const jobs = [
      { jobId: "identity-false", pid: 4201 },
      { jobId: "identity-null", pid: 4202 },
      { jobId: "missing-config", pid: 4203 },
      { jobId: "terminate-throws", pid: 4204 },
      { jobId: "verified-success", pid: 4205 },
    ];
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 2,
        jobs: [
          ...jobs.map((job) => ({ ...job, hostSessionId: "ended", provider: "qwen", kind: "rescue", status: "running" })),
          { jobId: "other-session", hostSessionId: "other", status: "running", pid: null },
          { jobId: "already-done", hostSessionId: "ended", status: "completed", pid: null },
        ],
      });
      for (const job of jobs.filter((entry) => entry.jobId !== "missing-config")) {
        writeJobConfigFile(workspaceRoot, job.jobId, {
          workspaceRoot,
          jobId: job.jobId,
          execution: { provider: "qwen", kind: "rescue" },
          runContext: {
            runId: `run-${job.jobId}`,
            command: "rescue",
            hostSurface: "terminal",
            jobId: job.jobId,
            provider: "qwen",
            kind: "rescue",
          },
        });
      }
      const alive = new Map(jobs.map((job) => [job.pid, true]));
      const terminated = [];

      await cleanupSessionJobs(workspaceRoot, "ended", {
        isWorkerAlive(pid) {
          return alive.get(pid) === true;
        },
        isExpectedWorkerProcess(pid) {
          if (pid === 4201) return false;
          if (pid === 4202) return null;
          return true;
        },
        async terminateProcess(pid) {
          terminated.push(pid);
          if (pid === 4204) throw new Error("injected terminate failure");
          alive.set(pid, false);
        },
      });

      assert.deepEqual(terminated.sort(), [4204, 4205]);
      const byId = new Map(listJobs(workspaceRoot).map((job) => [job.jobId, job]));
      for (const jobId of ["identity-false", "identity-null", "missing-config", "terminate-throws"]) {
        assert.equal(byId.get(jobId)?.status, "running", jobId);
        assert.equal(readJobFile(resolveJobFile(workspaceRoot, jobId))?.cancellationIntent?.status, "requested", jobId);
      }
      assert.equal(byId.get("verified-success")?.status, "cancelled");
      assert.equal(byId.get("other-session")?.status, "running");
      assert.equal(byId.get("already-done")?.status, "completed");
      assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "identity-false")), true);
      assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "identity-null")), true);
      assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "terminate-throws")), true);
      assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "verified-success")), false);

      const terminal = (await readRunLedgerEvents(workspaceRoot)).filter((event) =>
        ["attempt_result", "provider_decision"].includes(event.phase)
      );
      assert.deepEqual(terminal.map((event) => [event.runId, event.phase, event.status]), [
        ["run-verified-success", "attempt_result", "cancelled"],
        ["run-verified-success", "provider_decision", "cancelled"],
      ]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd CLI awaits authoritative cancellation before exiting", async () => {
  await withPluginData(async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 2,
        jobs: [
          { jobId: "cli-session-end", hostSessionId: "ended-cli", provider: "qwen", kind: "rescue", status: "queued", pid: null },
        ],
      });

      const result = await runNode(lifecycleHookPath, ["SessionEnd"], {
        cwd: workspaceRoot,
        input: JSON.stringify({ cwd: workspaceRoot, session_id: "ended-cli" }),
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(listJobs(workspaceRoot).find((job) => job.jobId === "cli-session-end")?.status, "cancelled");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd bounds state-lock contention by one shared deadline without publishing terminal state", async () => {
  await withPluginData(async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const lockFile = `${resolveStateFile(workspaceRoot)}.lock`;
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 2,
        jobs: [
          { jobId: "locked-one", hostSessionId: "ended", provider: "qwen", kind: "rescue", status: "queued", pid: null },
          { jobId: "locked-two", hostSessionId: "ended", provider: "qwen", kind: "rescue", status: "queued", pid: null },
        ],
      });
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { mode: 0o600 });

      const startedAt = Date.now();
      await cleanupSessionJobs(workspaceRoot, "ended", { budgetMs: 60 });
      const elapsedMs = Date.now() - startedAt;

      assert.ok(elapsedMs < 300, `cleanup exceeded its shared budget: ${elapsedMs}ms`);
      assert.deepEqual(listJobs(workspaceRoot).map((job) => [job.jobId, job.status]).sort(), [
        ["locked-one", "queued"],
        ["locked-two", "queued"],
      ]);
      assert.equal(readJobFile(resolveJobFile(workspaceRoot, "locked-one")), null);
      assert.equal(readJobFile(resolveJobFile(workspaceRoot, "locked-two")), null);
      assert.equal((await readRunLedgerEvents(workspaceRoot)).length, 0);
    } finally {
      fs.rmSync(lockFile, { force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd bounds ledger-lock contention and leaves cancellation retryable", async () => {
  await withPluginData(async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    try {
      writeWorkspaceState(workspaceRoot, {
        version: 2,
        jobs: [{
          jobId: "ledger-locked",
          hostSessionId: "ended",
          provider: "qwen",
          kind: "rescue",
          status: "queued",
          pid: null,
        }],
      });
      writeJobConfigFile(workspaceRoot, "ledger-locked", {
        workspaceRoot,
        jobId: "ledger-locked",
        execution: { provider: "qwen", kind: "rescue" },
        runContext: {
          runId: "run-ledger-locked",
          command: "rescue",
          hostSurface: "terminal",
          jobId: "ledger-locked",
          provider: "qwen",
          kind: "rescue",
        },
      });
      const ledgerFile = path.join(path.dirname(resolveStateFile(workspaceRoot)), "run-ledger.ndjson");
      const ledgerLock = `${ledgerFile}.lock`;
      fs.writeFileSync(ledgerLock, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { mode: 0o600 });

      const startedAt = Date.now();
      await cleanupSessionJobs(workspaceRoot, "ended", { budgetMs: 60 });
      assert.ok(Date.now() - startedAt < 300);
      assert.equal(listJobs(workspaceRoot)[0]?.status, "queued");
      assert.equal((await readRunLedgerEvents(workspaceRoot)).length, 0);
      assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "ledger-locked")), true);

      fs.rmSync(ledgerLock, { force: true });
      await cleanupSessionJobs(workspaceRoot, "ended", { budgetMs: 500 });
      assert.equal(listJobs(workspaceRoot)[0]?.status, "cancelled");
      const terminal = (await readRunLedgerEvents(workspaceRoot)).filter((event) =>
        ["attempt_result", "provider_decision"].includes(event.phase)
      );
      assert.deepEqual(terminal.map((event) => event.phase), ["attempt_result", "provider_decision"]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("SessionEnd applies one deadline to multiple slow terminations and keeps every job active", async () => {
  await withPluginData(async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const jobs = [4601, 4602, 4603].map((pid) => ({
      jobId: `slow-${pid}`,
      hostSessionId: "ended",
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid,
    }));
    try {
      writeWorkspaceState(workspaceRoot, { version: 2, jobs });
      for (const job of jobs) {
        writeJobConfigFile(workspaceRoot, job.jobId, {
          workspaceRoot,
          jobId: job.jobId,
          execution: { provider: "qwen", kind: "rescue" },
          runContext: { runId: `run-${job.jobId}`, command: "rescue", jobId: job.jobId },
        });
      }

      const startedAt = Date.now();
      await cleanupSessionJobs(workspaceRoot, "ended", {
        budgetMs: 500,
        isWorkerAlive: () => true,
        isExpectedWorkerProcess: () => true,
        terminateProcess: () => new Promise(() => {}),
      });
      const elapsedMs = Date.now() - startedAt;

      assert.ok(elapsedMs < 1_000, `multiple termination waits exceeded one budget: ${elapsedMs}ms`);
      for (const job of listJobs(workspaceRoot)) {
        assert.equal(job.status, "running", job.jobId);
        assert.equal(readJobFile(resolveJobFile(workspaceRoot, job.jobId))?.cancellationIntent?.status, "requested");
        assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, job.jobId)), true);
      }
      assert.equal((await readRunLedgerEvents(workspaceRoot)).length, 0);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
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

test("parseStopReviewOutput ignores echoed legacy sentinels when a nonce token is required", () => {
  const result = parseStopReviewOutput(
    [
      "The previous Claude response said:",
      "ALLOW: stale echoed verdict",
      "Here is my verdict:",
      "BLOCK POLYCLI_STOP_REVIEW_testnonce: tests were not run",
    ].join("\n"),
    { sentinelToken: "POLYCLI_STOP_REVIEW_testnonce" }
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /tests were not run/);
});

test("parseStopReviewOutput accepts token-bearing ALLOW verdicts", () => {
  const result = parseStopReviewOutput(
    "Here is my review:\nALLOW POLYCLI_STOP_REVIEW_testnonce: no blockers",
    { sentinelToken: "POLYCLI_STOP_REVIEW_testnonce" }
  );

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

test("runStopReview never invokes a provider without enforced stop-review safety", () => {
  const fake = createFakeCompanion(`
process.stderr.write("unsupported provider should not be invoked\\n");
process.exit(9);
`);
  try {
    for (const provider of ["agy", "kimi", "minimax"]) {
      const result = runStopReview({
        cwd: process.cwd(),
        companionPath: fake.script,
        provider,
        input: { last_assistant_message: "done" },
      });

      assert.equal(result.ok, true, provider);
      assert.equal(result.skipped, true, provider);
      assert.match(result.note, new RegExp(`provider '${provider}'.*cannot enforce`, "i"));
    }
  } finally {
    fake.cleanup();
  }
});

test("runStopReview requires the per-run sentinel token from the prompt", () => {
  const fake = createFakeCompanion(`
if (process.argv[2] !== "_stop-review-gate") {
  process.stdout.write(JSON.stringify({ error: "wrong stop-review command" }) + "\\n");
  process.exit(0);
}
const prompt = process.argv.at(-1) || "";
const match = prompt.match(/ALLOW (POLYCLI_STOP_REVIEW_[A-Za-z0-9_]+):/);
if (!match) {
  process.stdout.write(JSON.stringify({ error: "missing token" }) + "\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  response: [
    "ALLOW: stale echoed verdict",
    "BLOCK " + match[1] + ": tests were not run"
  ].join("\\n")
}) + "\\n");
`);
  try {
    const result = runStopReview({
      cwd: process.cwd(),
      companionPath: fake.script,
      provider: "qwen",
      input: { last_assistant_message: "ALLOW: stale echoed verdict" },
      timeoutMs: 5_000,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /tests were not run/);
  } finally {
    fake.cleanup();
  }
});

test("resolveReviewProvider skips cleanly when no last-used provider is recorded", () => {
  withPluginData(() => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    try {
      writeWorkspaceState(workspaceRoot, { version: 1, config: { stopReviewGate: true }, jobs: [] });

      const result = resolveReviewProvider({
        workspaceRoot,
        cwd: workspaceRoot,
      });

      assert.equal(result.provider, null);
      assert.equal(result.source, "none");
      assert.match(result.reason, /No last-used provider/i);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("resolveReviewProvider uses the recorded last-used enforced provider without a health probe", () => {
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

test("resolveReviewProvider skips prompt-only and unsupported last-used providers without probing health", () => {
  withPluginData(() => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
    const fake = createFakeCompanion(`
if (process.argv[2] === "health") {
  process.stdout.write(JSON.stringify({ anyHealthy: true, healthyProviders: ["agy"], results: [] }) + "\\n");
  process.exit(0);
}
process.exit(9);
`);
    try {
      for (const provider of ["agy", "kimi", "minimax"]) {
        writeWorkspaceState(workspaceRoot, {
          version: 1,
          config: { stopReviewGate: true, lastUsedProvider: provider },
          jobs: [],
        });

        const result = resolveReviewProvider({
          workspaceRoot,
          companionPath: fake.script,
          cwd: workspaceRoot,
        });

        assert.equal(result.provider, null, provider);
        assert.equal(result.source, "none", provider);
        assert.match(result.reason, new RegExp(`${provider}.*not safe`, "i"));
      }
    } finally {
      fake.cleanup();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("Stop hook skips without blocking when provider cannot be resolved", async () => {
  await withPluginData(async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-"));
      try {
        writeWorkspaceState(workspaceRoot, { version: 1, config: { stopReviewGate: true }, jobs: [] });
        const result = await runNode(stopHookPath, [], {
          cwd: workspaceRoot,
          input: JSON.stringify({ cwd: workspaceRoot, last_assistant_message: "done" }),
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /No last-used provider/);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
});
