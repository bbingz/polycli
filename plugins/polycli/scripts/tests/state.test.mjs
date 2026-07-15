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
  readJobConfigFile,
  readLastUsedProvider,
  resolveJobsDir,
  resolveStateFile,
  resolveJobFile,
  resolveJobConfigFile,
  resolveJobLogFile,
  resolveJobStartFailureFile,
  resolveStateDir,
  resolveWorkspaceRoot,
  saveState,
  setConfig,
  recordLastUsedProvider,
  updateJobAtomically,
  upsertJob,
  writeJobConfigFile,
  writeJobFile,
  writeJobStartFailureFile,
} from "../lib/state.mjs";
import { readStateWithPreGateBReader } from "./fixtures/pre-gate-b-readers.mjs";

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

test("saveState reclaims on-disk artifacts for terminal jobs pruned past MAX_JOBS", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-prune-reclaim";
    const terminalJobs = Array.from({ length: 105 }, (_, index) => ({
      jobId: `terminal-${index}`,
      status: "completed",
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    const activeJob = { jobId: "queued-keep", status: "queued", updatedAt: "2025-12-31T00:00:00.000Z" };

    // terminal-0 is the oldest -> pruned past MAX_JOBS; terminal-104 is newest -> kept; the active
    // job is always kept. Write every artifact kind for each so we can prove reclamation.
    for (const jobId of ["terminal-0", "terminal-104", "queued-keep"]) {
      writeJobFile(workspaceRoot, jobId, { job: { jobId, status: "completed" }, result: { ok: true, response: "x" } });
      writeJobConfigFile(workspaceRoot, jobId, { execution: { prompt: "p" } });
      writeJobStartFailureFile(workspaceRoot, jobId, { version: 1, jobId, error: "safe" });
      fs.writeFileSync(resolveJobLogFile(workspaceRoot, jobId), "log line\n");
    }

    saveState(workspaceRoot, { jobs: [...terminalJobs, activeJob], config: {} });

    // Dropped terminal job: all artifacts reclaimed.
    assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, "terminal-0")), false);
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "terminal-0")), false);
    assert.equal(fs.existsSync(resolveJobStartFailureFile(workspaceRoot, "terminal-0")), false);
    assert.equal(fs.existsSync(resolveJobLogFile(workspaceRoot, "terminal-0")), false);
    // Kept terminal job + active job: artifacts retained.
    assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, "terminal-104")), true);
    assert.equal(fs.existsSync(resolveJobStartFailureFile(workspaceRoot, "terminal-104")), true);
    assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, "queued-keep")), true);
    assert.equal(fs.existsSync(resolveJobLogFile(workspaceRoot, "queued-keep")), true);
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

test("updateJobAtomically preserves a terminal envelope when its pre-state hook fails", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-atomic-pre-state-hook";
    ensureStateDir(workspaceRoot);
    upsertJob(workspaceRoot, {
      jobId: "job-recoverable",
      provider: "qwen",
      kind: "review",
      status: "running",
    });

    assert.throws(() => {
      updateJobAtomically(workspaceRoot, "job-recoverable", (current, currentEnvelope) => {
        assert.equal(current?.status, "running");
        assert.equal(currentEnvelope ?? null, null);
        const job = { ...current, status: "completed" };
        const envelope = {
          job,
          result: { ok: true, response: "durable terminal intent" },
        };
        return {
          job,
          envelope,
          beforeStateCommit({ current: hookCurrent, job: hookJob, envelope: hookEnvelope }) {
            assert.equal(hookCurrent?.status, "running");
            assert.equal(hookJob.status, "completed");
            assert.deepEqual(hookEnvelope, envelope);
            const persistedEnvelope = readJobFile(resolveJobFile(workspaceRoot, "job-recoverable"));
            assert.equal(persistedEnvelope.job.status, "completed");
            assert.equal(persistedEnvelope.job.hostSessionId, null);
            assert.equal(persistedEnvelope.job.providerSessionId, null);
            assert.equal(persistedEnvelope.result.response, "durable terminal intent");
            assert.equal(persistedEnvelope.result.providerSessionId, null);
            assert.equal(loadState(workspaceRoot).jobs[0].status, "running");
            throw new Error("terminal ledger unavailable");
          },
        };
      });
    }, /terminal ledger unavailable/);

    assert.equal(listJobs(workspaceRoot)[0].status, "running");
    const envelope = readJobFile(resolveJobFile(workspaceRoot, "job-recoverable"));
    assert.equal(envelope.job.status, "completed");
    assert.equal(envelope.result.response, "durable terminal intent");

    let recoveredEnvelope = null;
    const retry = updateJobAtomically(workspaceRoot, "job-recoverable", (current, currentEnvelope) => {
      assert.equal(current?.status, "running");
      recoveredEnvelope = currentEnvelope;
      return null;
    });
    assert.equal(retry.written, false);
    assert.equal(recoveredEnvelope.job.status, "completed");
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

test("state v2 writes explicit host/provider identities while legacy jobs normalize conservatively", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-state-v2-identities";
    ensureStateDir(workspaceRoot);
    fs.writeFileSync(resolveStateFile(workspaceRoot), `${JSON.stringify({
      version: 1,
      config: {},
      jobs: [
        { jobId: "legacy-active", status: "running", sessionId: "host-legacy" },
        { jobId: "legacy-terminal", status: "completed", sessionId: "provider-legacy" },
        {
          jobId: "explicit-active",
          status: "running",
          sessionId: "stale-ambiguous-value",
          hostSessionId: "host-explicit",
          providerSessionId: "provider-explicit",
          invocationId: "inv_11111111111111111111",
          attemptId: "att_22222222222222222222",
        },
      ],
    }, null, 2)}\n`, "utf8");

    const loaded = loadState(workspaceRoot);
    assert.equal(loaded.version, 1);
    assert.deepEqual(
      loaded.jobs.map((job) => ({
        jobId: job.jobId,
        hostSessionId: job.hostSessionId,
        providerSessionId: job.providerSessionId,
        sessionId: job.sessionId,
        invocationId: job.invocationId,
        attemptId: job.attemptId,
      })),
      [
        {
          jobId: "legacy-active",
          hostSessionId: "host-legacy",
          providerSessionId: null,
          sessionId: "host-legacy",
          invocationId: null,
          attemptId: null,
        },
        {
          jobId: "legacy-terminal",
          hostSessionId: null,
          providerSessionId: "provider-legacy",
          sessionId: "provider-legacy",
          invocationId: null,
          attemptId: null,
        },
        {
          jobId: "explicit-active",
          hostSessionId: "host-explicit",
          providerSessionId: "provider-explicit",
          sessionId: "host-explicit",
          invocationId: "inv_11111111111111111111",
          attemptId: "att_22222222222222222222",
        },
      ],
    );

    const saved = saveState(workspaceRoot, loaded);
    assert.equal(saved.version, 2);
    assert.equal(JSON.parse(fs.readFileSync(resolveStateFile(workspaceRoot), "utf8")).version, 2);
  });
});

test("the pre-Gate-B state reader tolerates additive v2 job identity fields", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-pre-gate-b-state-reader";
    saveState(workspaceRoot, {
      version: 2,
      config: {},
      jobs: [{
        jobId: "job-v2-additive",
        status: "running",
        hostSessionId: "host-v2",
        providerSessionId: null,
        invocationId: "inv_11111111111111111111",
        attemptId: "att_22222222222222222222",
      }],
    });

    const rolledBack = readStateWithPreGateBReader(resolveStateFile(workspaceRoot));
    assert.equal(rolledBack.version, 2);
    assert.equal(rolledBack.jobs[0].hostSessionId, "host-v2");
    assert.equal(rolledBack.jobs[0].attemptId, "att_22222222222222222222");
  });
});

test("upsertJob returns the same normalized v2 identity shape that it persists", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-state-v2-upsert-return";
    const saved = upsertJob(workspaceRoot, {
      jobId: "job-upsert-v2",
      status: "queued",
      sessionId: "legacy-host-input",
    });

    assert.equal(saved.hostSessionId, "legacy-host-input");
    assert.equal(saved.providerSessionId, null);
    assert.equal(saved.invocationId, null);
    assert.deepEqual(saved, listJobs(workspaceRoot)[0]);
  });
});

test("job envelope and config readers tolerate missing v2 identity fields without inventing them", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-state-v2-job-readers";
    writeJobFile(workspaceRoot, "legacy-result", {
      job: { jobId: "legacy-result", status: "completed", sessionId: "provider-from-job" },
      result: { ok: true, sessionId: "provider-from-result" },
    });
    writeJobConfigFile(workspaceRoot, "legacy-result", {
      runContext: { runId: "run-legacy" },
    });

    const envelope = readJobFile(resolveJobFile(workspaceRoot, "legacy-result"));
    assert.equal(envelope.job.hostSessionId, null);
    assert.equal(envelope.job.providerSessionId, "provider-from-job");
    assert.equal(envelope.result.providerSessionId, "provider-from-result");
    assert.equal(envelope.result.sessionId, "provider-from-result");

    const config = readJobConfigFile(resolveJobConfigFile(workspaceRoot, "legacy-result"));
    assert.equal(config.runContext.invocationId, null);
    assert.equal(config.runContext.attemptId, null);
  });
});
