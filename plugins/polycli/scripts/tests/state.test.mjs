import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureStateDir,
  listJobs,
  loadState,
  readJobFile,
  readLastUsedProvider,
  resolveJobsDir,
  resolveStateFile,
  resolveJobFile,
  resolveStateDir,
  resolveWorkspaceRoot,
  saveState,
  setConfig,
  recordLastUsedProvider,
  updateJobAtomically,
  upsertJob,
  writeJobConfigFile,
  writeJobFile,
} from "../lib/state.mjs";

function fileMode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

function withPluginData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-state-test-"));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dir;
  try {
    return fn(dir);
  } finally {
    if (previous == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveWorkspaceRoot falls back to cwd outside git", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-root-"));
  try {
    assert.equal(resolveWorkspaceRoot(temp), temp);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("resolveStateDir is stable for the same workspace", () => {
  withPluginData(() => {
    const first = resolveStateDir("/tmp/polycli-a");
    const second = resolveStateDir("/tmp/polycli-a");
    assert.equal(first, second);
  });
});

test("upsertJob stores jobs and writeJobFile persists envelopes", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-jobs";
    ensureStateDir(workspaceRoot);

    upsertJob(workspaceRoot, {
      jobId: "job-1",
      provider: "qwen",
      kind: "rescue",
      status: "running",
      promptPreview: "reply with pong",
    });

    const jobs = listJobs(workspaceRoot);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].jobId, "job-1");
    assert.equal(jobs[0].provider, "qwen");

    writeJobFile(workspaceRoot, "job-1", {
      job: { ...jobs[0], status: "completed" },
      result: { ok: true, response: "PONG" },
    });

    const envelope = readJobFile(resolveJobFile(workspaceRoot, "job-1"));
    assert.equal(envelope.job.status, "completed");
    assert.equal(envelope.result.response, "PONG");
  });
});

test("state directories and sensitive state files use private permissions", () => {
  withPluginData((pluginData) => {
    const workspaceRoot = "/tmp/polycli-private-state";
    ensureStateDir(workspaceRoot);

    assert.equal(fileMode(path.join(pluginData, "state")), 0o700);
    assert.equal(fileMode(resolveStateDir(workspaceRoot)), 0o700);
    assert.equal(fileMode(resolveJobsDir(workspaceRoot)), 0o700);

    setConfig(workspaceRoot, "stopReviewGate", true);
    writeJobFile(workspaceRoot, "job-private", {
      job: { jobId: "job-private", status: "completed" },
      result: { ok: true, response: "private output" },
    });
    writeJobConfigFile(workspaceRoot, "job-private", {
      execution: { prompt: "private prompt" },
      runContext: { runId: "run-private" },
    });

    assert.equal(fileMode(resolveStateFile(workspaceRoot)), 0o600);
    assert.equal(fileMode(resolveJobFile(workspaceRoot, "job-private")), 0o600);
    assert.equal(fileMode(path.join(resolveJobsDir(workspaceRoot), "job-private.config.json")), 0o600);
  });
});

test("ensureStateDir tightens pre-existing world-readable state directories to 0700", () => {
  withPluginData((pluginData) => {
    const workspaceRoot = "/tmp/polycli-loose-state";
    const stateRoot = path.join(pluginData, "state");
    const stateDir = resolveStateDir(workspaceRoot);
    const jobsDir = resolveJobsDir(workspaceRoot);

    // Simulate a host-managed / permissive-umask layout where the dirs already exist at 0755 before
    // polycli runs (e.g. ~/.polycli created by another tool). Only the force-chmod in
    // chmodPrivateDir can tighten an EXISTING directory — recursive mkdir is a no-op on its mode —
    // so this is the case that proves the security-relevant part of the hardening.
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.chmodSync(stateRoot, 0o755);
    fs.chmodSync(stateDir, 0o755);
    fs.chmodSync(jobsDir, 0o755);

    ensureStateDir(workspaceRoot);

    assert.equal(fileMode(stateRoot), 0o700);
    assert.equal(fileMode(stateDir), 0o700);
    assert.equal(fileMode(jobsDir), 0o700);
  });
});

test("saveState preserves active jobs while pruning terminal history", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-active-prune";
    const terminalJobs = Array.from({ length: 105 }, (_, index) => ({
      jobId: `terminal-${index}`,
      status: "completed",
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    const activeJobs = [
      { jobId: "queued-old", status: "queued", updatedAt: "2025-12-31T00:00:00.000Z" },
      { jobId: "running-old", status: "running", updatedAt: "2025-12-31T00:00:01.000Z" },
    ];

    const saved = saveState(workspaceRoot, { jobs: [...terminalJobs, ...activeJobs], config: {} });
    const savedIds = saved.jobs.map((job) => job.jobId);

    assert.equal(saved.jobs.filter((job) => job.status === "completed").length, 100);
    assert.equal(saved.jobs.filter((job) => job.status === "queued" || job.status === "running").length, 2);
    assert.equal(savedIds.includes("queued-old"), true);
    assert.equal(savedIds.includes("running-old"), true);
    assert.equal(savedIds.includes("terminal-0"), false);
  });
});

test("config and last-used provider share the workspace state file", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-config-state";

    setConfig(workspaceRoot, "stopReviewGate", true);
    recordLastUsedProvider(workspaceRoot, "qwen");

    const state = loadState(workspaceRoot);
    assert.equal(state.config.stopReviewGate, true);
    assert.equal(readLastUsedProvider(workspaceRoot), "qwen");
  });
});

test("loadState preserves a backup when state.json is corrupt", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-corrupt-state";
    ensureStateDir(workspaceRoot);
    const stateFile = resolveStateFile(workspaceRoot);
    fs.writeFileSync(stateFile, "{not valid json\n", "utf8");

    const state = loadState(workspaceRoot);
    assert.deepEqual(state.jobs, []);

    const backupDir = path.dirname(stateFile);
    const backups = fs.readdirSync(backupDir).filter((entry) => entry.startsWith("state.json.corrupt-"));
    assert.equal(backups.length, 1);
    assert.match(fs.readFileSync(path.join(backupDir, backups[0]), "utf8"), /not valid json/);
    assert.equal(fs.existsSync(stateFile), false);
  });
});

test("updateJobAtomically can skip stale worker writes after cancellation", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-atomic-job";
    ensureStateDir(workspaceRoot);

    upsertJob(workspaceRoot, {
      jobId: "job-1",
      provider: "qwen",
      kind: "review",
      status: "running",
    });

    updateJobAtomically(workspaceRoot, "job-1", (current) => ({
      job: {
        ...current,
        status: "cancelled",
      },
      envelope: {
        job: { ...current, status: "cancelled" },
        result: { ok: false, error: "cancelled" },
      },
    }));

    const staleWrite = updateJobAtomically(workspaceRoot, "job-1", (current) => {
      if (current?.status === "cancelled") {
        return null;
      }
      return {
        job: {
          ...current,
          status: "completed",
        },
        envelope: {
          job: { ...current, status: "completed" },
          result: { ok: true, response: "late result" },
        },
      };
    });

    assert.equal(staleWrite.written, false);
    assert.equal(listJobs(workspaceRoot)[0].status, "cancelled");
    const envelope = readJobFile(resolveJobFile(workspaceRoot, "job-1"));
    assert.equal(envelope.job.status, "cancelled");
    assert.equal(envelope.result.error, "cancelled");
  });
});

test("updateJobAtomically can skip queued-to-running writes after terminal completion", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-queued-running-cas";
    ensureStateDir(workspaceRoot);
    upsertJob(workspaceRoot, {
      jobId: "job-fast",
      provider: "qwen",
      kind: "ask",
      status: "queued",
    });

    updateJobAtomically(workspaceRoot, "job-fast", (current) => ({
      job: {
        ...current,
        status: "completed",
        pid: null,
      },
      envelope: {
        job: { ...current, status: "completed", pid: null },
        result: { ok: true, response: "done" },
      },
    }));

    const staleRunningWrite = updateJobAtomically(workspaceRoot, "job-fast", (current) => {
      if (current?.status !== "queued") return null;
      return {
        job: {
          ...current,
          status: "running",
          pid: 12345,
        },
      };
    });

    assert.equal(staleRunningWrite.written, false);
    assert.equal(listJobs(workspaceRoot)[0].status, "completed");
  });
});
