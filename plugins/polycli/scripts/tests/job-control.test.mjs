import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildStatusSnapshot,
  cancelJob,
  refreshJobsForLedgerRecovery,
  refreshJob,
  resolveLatestActiveJob,
  resolveLatestTerminalJob,
} from "../lib/job-control.mjs";
import {
  ensureStateDir,
  listJobs,
  resolveJobConfigFile,
  resolveJobFile,
  resolveJobLogFile,
  upsertJob,
  writeJobConfigFile,
  writeJobFile,
} from "../lib/state.mjs";
import {
  appendRunLedgerEvent,
  readRunLedgerEvents,
} from "../lib/run-ledger.mjs";

function withWorkspace(fn) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-job-control-"));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-job-state-"));
  const cleanup = () => {
    const pluginData = process.env.CLAUDE_PLUGIN_DATA;
    if (previous == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previous;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(pluginData, { recursive: true, force: true });
  };
  try {
    ensureStateDir(workspaceRoot);
    const result = fn(workspaceRoot);
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

test("refreshJob records terminal ledger events when a worker exits before writing an envelope", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const logFile = resolveJobLogFile(workspaceRoot, "job-missing-result");
    fs.writeFileSync(logFile, "assistant progress\n");

    upsertJob(workspaceRoot, {
      jobId: "job-missing-result",
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: 999999,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, "job-missing-result", {
      workspaceRoot,
      jobId: "job-missing-result",
      execution: {
        provider: "qwen",
        kind: "rescue",
        model: "qwen-test",
        defaultModel: "qwen-default",
      },
      runContext: {
        runId: "run-recover",
        command: "rescue",
        hostSurface: "terminal",
        rawArgs: ["rescue", "--provider", "qwen", "<prompt:redacted>"],
        jobId: "job-missing-result",
        provider: "qwen",
        kind: "rescue",
        model: "qwen-test",
        defaultModel: "qwen-default",
        logFile,
      },
    });
    await appendRunLedgerEvent(workspaceRoot, {
      runId: "run-recover",
      command: "rescue",
      commands: ["rescue"],
      kind: "rescue",
      provider: "qwen",
      phase: "attempt_started",
      status: "started",
      jobId: "job-missing-result",
      hostSurface: "terminal",
      logFile,
    });

    const refreshed = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(refreshed.status, "failed");
    assert.equal(refreshed.result.error, "worker exited before writing a result envelope");

    const events = (await readRunLedgerEvents(workspaceRoot)).filter((event) => event.runId === "run-recover");
    assert.equal(events.filter((event) => event.phase === "attempt_result").length, 1);
    assert.equal(events.filter((event) => event.phase === "provider_decision").length, 1);
    assert.deepEqual(
      events.map((event) => [event.phase, event.status, event.reason]).slice(-2),
      [
        ["attempt_result", "failed", "worker_exited"],
        ["provider_decision", "failed", "worker_exited"],
      ],
    );
    assert.equal(events.at(-1).logFile, logFile);

    refreshJob(workspaceRoot, refreshed);
    const afterSecondRefresh = (await readRunLedgerEvents(workspaceRoot)).filter((event) => event.runId === "run-recover");
    assert.equal(afterSecondRefresh.filter((event) => event.phase === "attempt_result").length, 1);
    assert.equal(afterSecondRefresh.filter((event) => event.phase === "provider_decision").length, 1);
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "job-missing-result")), false);
  });
});

test("refreshJobsForLedgerRecovery is idempotent across multiple jobs", async () => {
  await withWorkspace(async (workspaceRoot) => {
    for (const jobId of ["job-one", "job-two"]) {
      const logFile = resolveJobLogFile(workspaceRoot, jobId);
      fs.writeFileSync(logFile, `${jobId} progress\n`);
      upsertJob(workspaceRoot, {
        jobId,
        provider: "qwen",
        kind: "ask",
        status: "running",
        pid: 999999,
        logFile,
      });
      writeJobConfigFile(workspaceRoot, jobId, {
        workspaceRoot,
        jobId,
        execution: { provider: "qwen", kind: "ask" },
        runContext: {
          runId: "run-debug-recover",
          command: "ask",
          hostSurface: "terminal",
          rawArgs: ["ask", "--provider", "qwen", "<prompt:redacted>"],
          jobId,
          provider: "qwen",
          kind: "ask",
          logFile,
        },
      });
      await appendRunLedgerEvent(workspaceRoot, {
        runId: "run-debug-recover",
        command: "ask",
        commands: ["ask"],
        kind: "ask",
        provider: "qwen",
        phase: "attempt_started",
        status: "started",
        jobId,
        hostSurface: "terminal",
        logFile,
      });
    }

    refreshJobsForLedgerRecovery(workspaceRoot);
    refreshJobsForLedgerRecovery(workspaceRoot);

    const events = (await readRunLedgerEvents(workspaceRoot)).filter((event) => event.runId === "run-debug-recover");
    assert.equal(events.filter((event) => event.phase === "attempt_result").length, 2);
    assert.equal(events.filter((event) => event.phase === "provider_decision").length, 2);
    assert.equal(events.every((event) => event.hostSurface === "terminal"), true);
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
