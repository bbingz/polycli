import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildStatusSnapshot,
  cancelJob,
  refreshJob,
  resolveLatestActiveJob,
  resolveLatestTerminalJob,
} from "../lib/job-control.mjs";
import {
  ensureStateDir,
  listJobs,
  resolveJobFile,
  resolveJobLogFile,
  upsertJob,
  writeJobFile,
} from "../lib/state.mjs";

function withWorkspace(fn) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-job-control-"));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-job-state-"));
  try {
    ensureStateDir(workspaceRoot);
    return fn(workspaceRoot);
  } finally {
    const pluginData = process.env.CLAUDE_PLUGIN_DATA;
    if (previous == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previous;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
}

test("refreshJob finalizes dead jobs from stored result files", () => {
  withWorkspace((workspaceRoot) => {
    const logFile = resolveJobLogFile(workspaceRoot, "job-dead");
    fs.writeFileSync(logFile, "assistant progress\n");

    upsertJob(workspaceRoot, {
      jobId: "job-dead",
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: 999999,
      logFile,
    });

    writeJobFile(workspaceRoot, "job-dead", {
      job: {
        jobId: "job-dead",
        provider: "qwen",
        kind: "rescue",
        status: "completed",
        finishedAt: "2026-04-22T00:00:00.000Z",
      },
      result: {
        ok: true,
        response: "PONG",
      },
    });

    const job = listJobs(workspaceRoot)[0];
    const refreshed = refreshJob(workspaceRoot, job);
    assert.equal(refreshed.status, "completed");
    assert.equal(refreshed.result.response, "PONG");
  });
});

test("buildStatusSnapshot returns progress preview and recent jobs", () => {
  withWorkspace((workspaceRoot) => {
    const runningLog = resolveJobLogFile(workspaceRoot, "job-running");
    fs.writeFileSync(runningLog, "line 1\nline 2\nline 3\n");

    upsertJob(workspaceRoot, {
      jobId: "job-running",
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: process.pid,
      logFile: runningLog,
      promptPreview: "investigate flaky test",
    });
    upsertJob(workspaceRoot, {
      jobId: "job-done",
      provider: "qwen",
      kind: "review",
      status: "completed",
      promptPreview: "review staged diff",
      finishedAt: "2026-04-22T00:00:00.000Z",
    });

    const snapshot = buildStatusSnapshot(workspaceRoot);
    assert.equal(snapshot.running.length, 1);
    assert.equal(snapshot.recent.length, 1);
    assert.match(snapshot.running[0].progressPreview, /line 3/);
  });
});

test("resolveLatestActiveJob and resolveLatestTerminalJob prefer newest matching jobs", () => {
  withWorkspace((workspaceRoot) => {
    upsertJob(workspaceRoot, {
      jobId: "job-a",
      provider: "qwen",
      kind: "rescue",
      status: "running",
      updatedAt: "2026-04-22T00:00:00.000Z",
    });
    upsertJob(workspaceRoot, {
      jobId: "job-b",
      provider: "qwen",
      kind: "rescue",
      status: "completed",
      updatedAt: "2026-04-22T00:00:01.000Z",
    });

    assert.equal(resolveLatestActiveJob(workspaceRoot).jobId, "job-a");
    assert.equal(resolveLatestTerminalJob(workspaceRoot).jobId, "job-b");
  });
});

test("cancelJob rejects terminal jobs", async () => {
  await withWorkspace(async (workspaceRoot) => {
    upsertJob(workspaceRoot, {
      jobId: "job-done",
      provider: "qwen",
      kind: "rescue",
      status: "completed",
    });

    const report = await cancelJob(workspaceRoot, "job-done");
    assert.equal(report.cancelled, false);
    assert.equal(report.reason, "not_cancellable");
  });
});
