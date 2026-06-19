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

test("refreshJob records sessionArtifactPath on recovery when the claude artifact exists on disk", async () => {
  const realHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-home-")));
  const prevHome = process.env.HOME;
  process.env.HOME = realHome;
  try {
    await withWorkspace(async (workspaceRoot) => {
      const sessionId = "44444444-4444-4444-8444-444444444444";
      // The artifact the claude run "created"; recovery must discover + record it.
      const projDir = path.join(realHome, ".claude", "projects", workspaceRoot.replaceAll("/", "-"));
      fs.mkdirSync(projDir, { recursive: true });
      const artifact = path.join(projDir, `${sessionId}.jsonl`);
      fs.writeFileSync(artifact, "{}\n");

      const logFile = resolveJobLogFile(workspaceRoot, "job-artifact");
      fs.writeFileSync(logFile, "progress\n");
      upsertJob(workspaceRoot, {
        jobId: "job-artifact",
        provider: "claude",
        kind: "ask",
        status: "running",
        pid: 999999,
        logFile,
      });
      writeJobConfigFile(workspaceRoot, "job-artifact", {
        workspaceRoot,
        jobId: "job-artifact",
        execution: { provider: "claude", kind: "ask", cwd: workspaceRoot },
        runContext: {
          runId: "run-artifact",
          command: "ask",
          hostSurface: "terminal",
          jobId: "job-artifact",
          provider: "claude",
          kind: "ask",
          logFile,
        },
      });
      // Stored envelope carries the captured sessionId (reliable recovery path).
      writeJobFile(workspaceRoot, "job-artifact", {
        job: { jobId: "job-artifact", provider: "claude", kind: "ask", status: "completed" },
        result: { ok: true, sessionId, response: "PONG" },
      });

      refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
      const events = (await readRunLedgerEvents(workspaceRoot)).filter((e) => e.runId === "run-artifact");
      const attempt = events.find((e) => e.phase === "attempt_result");
      assert.ok(attempt, "recovery wrote an attempt_result event");
      assert.equal(attempt.sessionArtifactPath, fs.realpathSync(artifact));
      const decision = events.find((e) => e.phase === "provider_decision");
      assert.equal(decision.sessionArtifactPath, fs.realpathSync(artifact));
    });
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(realHome, { recursive: true, force: true });
  }
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

test("cancelJob records cancelled ledger events, removes config, and cleans runtime paths", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-cancel-cleanup-"));
    fs.writeFileSync(path.join(cleanupDir, "review.diff"), "private diff\n", "utf8");
    const logFile = resolveJobLogFile(workspaceRoot, "job-cancel");

    upsertJob(workspaceRoot, {
      jobId: "job-cancel",
      provider: "gemini",
      kind: "review",
      status: "running",
      pid: null,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, "job-cancel", {
      workspaceRoot,
      jobId: "job-cancel",
      execution: {
        provider: "gemini",
        kind: "review",
        model: "gemini-test",
        runtimeOptions: {
          cleanupPaths: [cleanupDir],
        },
      },
      runContext: {
        runId: "run-cancel",
        command: "review",
        hostSurface: "terminal",
        rawArgs: ["review", "--provider", "gemini", "<prompt:redacted>"],
        jobId: "job-cancel",
        provider: "gemini",
        kind: "review",
        model: "gemini-test",
        logFile,
      },
    });
    await appendRunLedgerEvent(workspaceRoot, {
      runId: "run-cancel",
      command: "review",
      commands: ["review"],
      kind: "review",
      provider: "gemini",
      phase: "attempt_started",
      status: "started",
      jobId: "job-cancel",
      hostSurface: "terminal",
      logFile,
    });

    const report = await cancelJob(workspaceRoot, "job-cancel");

    assert.equal(report.cancelled, true);
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "job-cancel")), false);
    assert.equal(fs.existsSync(cleanupDir), false);

    const events = (await readRunLedgerEvents(workspaceRoot)).filter((event) => event.runId === "run-cancel");
    assert.deepEqual(
      events.map((event) => [event.phase, event.status, event.reason]).slice(-2),
      [
        ["attempt_result", "cancelled", "cancelled"],
        ["provider_decision", "cancelled", "cancelled"],
      ],
    );
  });
});

test("cancelJob kills the worker before deleting its runtime paths", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-cancel-order-"));
    upsertJob(workspaceRoot, {
      jobId: "job-order",
      provider: "gemini",
      kind: "review",
      status: "running",
      pid: 4242,
    });
    writeJobConfigFile(workspaceRoot, "job-order", {
      workspaceRoot,
      jobId: "job-order",
      execution: {
        provider: "gemini",
        kind: "review",
        runtimeOptions: { cleanupPaths: [cleanupDir] },
      },
      runContext: { runId: "run-order", command: "review", hostSurface: "terminal", jobId: "job-order", provider: "gemini", kind: "review" },
    });

    let dirExistedAtKill = null;
    const report = await cancelJob(workspaceRoot, "job-order", {
      terminate: async () => {
        // The cleanup path (a review's live cwd) must still exist when the kill runs.
        dirExistedAtKill = fs.existsSync(cleanupDir);
      },
    });

    assert.equal(report.cancelled, true);
    assert.equal(dirExistedAtKill, true);
    assert.equal(fs.existsSync(cleanupDir), false);
  });
});

test("cancelJob preserves runtime paths when the kill fails (worker may be alive)", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-cancel-killfail-"));
    upsertJob(workspaceRoot, {
      jobId: "job-killfail",
      provider: "gemini",
      kind: "review",
      status: "running",
      pid: 4242,
    });
    writeJobConfigFile(workspaceRoot, "job-killfail", {
      workspaceRoot,
      jobId: "job-killfail",
      execution: {
        provider: "gemini",
        kind: "review",
        runtimeOptions: { cleanupPaths: [cleanupDir] },
      },
      runContext: { runId: "run-killfail", command: "review", hostSurface: "terminal", jobId: "job-killfail", provider: "gemini", kind: "review" },
    });

    const report = await cancelJob(workspaceRoot, "job-killfail", {
      terminate: async () => {
        throw new Error("kill failed");
      },
    });

    assert.equal(report.cancelled, true);
    assert.equal(report.killWarning, "kill failed");
    // Worker may still be alive, so its runtime paths must NOT be deleted.
    assert.equal(fs.existsSync(cleanupDir), true);
    fs.rmSync(cleanupDir, { recursive: true, force: true });
  });
});
