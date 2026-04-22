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
  resolveStateFile,
  resolveJobFile,
  resolveStateDir,
  resolveWorkspaceRoot,
  updateJobAtomically,
  upsertJob,
  writeJobFile,
} from "../lib/state.mjs";

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
