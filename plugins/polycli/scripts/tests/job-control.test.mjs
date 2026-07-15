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
  resolveJobSelector,
  resolveLatestActiveJob,
  resolveLatestTerminalJob,
  waitForJob,
} from "../lib/job-control.mjs";
import {
  ensureStateDir,
  listJobs,
  readJobFile,
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
  resolveRunLedgerFile,
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

test("refreshJob keeps a dead worker active until terminal ledger recovery succeeds", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-ledger-unavailable";
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    fs.writeFileSync(logFile, "assistant progress\n");
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: 999999,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "rescue" },
      runContext: {
        runId: "run-ledger-unavailable",
        command: "rescue",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "rescue",
        logFile,
      },
    });

    const ledgerFile = resolveRunLedgerFile(workspaceRoot);
    fs.mkdirSync(ledgerFile, { mode: 0o700 });
    const beforeRecovery = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(beforeRecovery.status, "running");
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, jobId)), true);

    fs.rmSync(ledgerFile, { recursive: true, force: true });
    const recovered = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(recovered.status, "failed");
    const events = (await readRunLedgerEvents(workspaceRoot)).filter((event) => event.runId === "run-ledger-unavailable");
    assert.deepEqual(
      events.map((event) => [event.phase, event.status, event.reason]),
      [
        ["attempt_result", "failed", "worker_exited"],
        ["provider_decision", "failed", "worker_exited"],
      ],
    );
  });
});

test("refreshJob completes a terminal intent when its legacy ledger prefix matches", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-partial-terminal-pair";
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    fs.writeFileSync(logFile, "assistant progress\n");
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: 999999,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "rescue" },
      runContext: {
        runId: "run-partial-terminal-pair",
        command: "rescue",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "rescue",
        logFile,
      },
    });
    writeJobFile(workspaceRoot, jobId, {
      job: {
        jobId,
        provider: "qwen",
        kind: "rescue",
        status: "completed",
        finishedAt: "2026-07-15T00:00:00.000Z",
      },
      result: { ok: true, response: "PONG" },
    });
    await appendRunLedgerEvent(workspaceRoot, {
      runId: "run-partial-terminal-pair",
      command: "rescue",
      commands: ["rescue"],
      kind: "rescue",
      provider: "qwen",
      phase: "attempt_result",
      status: "completed",
      attempt: { ordinal: 1 },
      jobId,
      hostSurface: "terminal",
      logFile,
    });

    const refreshed = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(refreshed.status, "completed");
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, jobId)), false);
    const events = (await readRunLedgerEvents(workspaceRoot))
      .filter((event) => event.runId === "run-partial-terminal-pair");
    assert.deepEqual(events.filter((event) => ["attempt_result", "provider_decision"].includes(event.phase)).map((event) => event.phase), ["attempt_result", "provider_decision"]);
  });
});

test("refreshJob recovers a terminal intent that has no recorded pid", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-no-pid-terminal-intent";
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    fs.writeFileSync(logFile, "assistant progress\n");
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: null,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "rescue" },
      runContext: {
        runId: "run-no-pid-terminal-intent",
        command: "rescue",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "rescue",
        logFile,
      },
    });
    writeJobFile(workspaceRoot, jobId, {
      job: { jobId, provider: "qwen", kind: "rescue", status: "completed" },
      result: { ok: true, response: "PONG" },
      terminalReason: null,
    });

    const refreshed = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(refreshed.status, "completed");
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, jobId)), false);
    const events = (await readRunLedgerEvents(workspaceRoot))
      .filter((event) => event.runId === "run-no-pid-terminal-intent");
    assert.deepEqual(events.map((event) => event.phase), ["attempt_result", "provider_decision"]);
  });
});

test("refreshJob reuses a persisted terminal reason instead of inferring it from provider text", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-persisted-terminal-reason";
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    fs.writeFileSync(logFile, "assistant progress\n");
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: 999999,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "rescue" },
      runContext: {
        runId: "run-persisted-terminal-reason",
        command: "rescue",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "rescue",
        logFile,
      },
    });
    const error = "worker exited before writing a result envelope";
    writeJobFile(workspaceRoot, jobId, {
      job: { jobId, provider: "qwen", kind: "rescue", status: "failed" },
      result: { ok: false, error },
      terminalReason: "rescue_failed",
    });
    for (const [phase, status] of [["attempt_result", "failed"], ["provider_decision", "failed"]]) {
      await appendRunLedgerEvent(workspaceRoot, {
        runId: "run-persisted-terminal-reason",
        command: "rescue",
        commands: ["rescue"],
        kind: "rescue",
        provider: "qwen",
        phase,
        status,
        reason: "rescue_failed",
        jobId,
        hostSurface: "terminal",
        logFile,
      });
    }

    const refreshed = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(refreshed.status, "failed");
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, jobId)), false);
  });
});

test("refreshJob recovers a terminal intent when its recorded pid was reused", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-pid-reused-recovery";
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    fs.writeFileSync(logFile, "assistant progress\n");
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      // The test process is alive but its command line is not a polycli _job-worker invocation.
      pid: process.pid,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "rescue" },
      runContext: {
        runId: "run-pid-reused-recovery",
        command: "rescue",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "rescue",
        logFile,
      },
    });
    writeJobFile(workspaceRoot, jobId, {
      job: { jobId, provider: "qwen", kind: "rescue", status: "completed" },
      result: { ok: true, response: "PONG" },
      terminalReason: null,
    });
    for (const [phase, status] of [["attempt_result", "completed"], ["provider_decision", "adopted"]]) {
      await appendRunLedgerEvent(workspaceRoot, {
        runId: "run-pid-reused-recovery",
        command: "rescue",
        commands: ["rescue"],
        kind: "rescue",
        provider: "qwen",
        phase,
        status,
        reason: null,
        jobId,
        hostSurface: "terminal",
        logFile,
      });
    }

    const refreshed = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(refreshed.status, "completed");
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, jobId)), false);
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

test("refreshJob recovery preserves host/provider identities and publishes one attempt-keyed terminal pair", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-v2-identities";
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    fs.writeFileSync(logFile, "progress\n");
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "ask",
      status: "running",
      pid: 999999,
      logFile,
      hostSessionId: "host-session",
      providerSessionId: null,
      invocationId: "inv_11111111111111111111",
      attemptId: "att_22222222222222222222",
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "ask", cwd: workspaceRoot },
      runContext: {
        runId: "run-v2-identities",
        invocationId: "inv_11111111111111111111",
        attemptId: "att_22222222222222222222",
        command: "ask",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "ask",
        logFile,
      },
    });
    writeJobFile(workspaceRoot, jobId, {
      job: {
        jobId,
        provider: "qwen",
        kind: "ask",
        status: "completed",
        hostSessionId: "host-session",
        providerSessionId: "provider-session",
      },
      result: { ok: true, providerSessionId: "provider-session", response: "PONG" },
    });

    const refreshed = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(refreshed.hostSessionId, "host-session");
    assert.equal(refreshed.providerSessionId, "provider-session");
    assert.equal(refreshed.sessionId, "provider-session");
    const terminal = (await readRunLedgerEvents(workspaceRoot))
      .filter((event) => ["attempt_result", "provider_decision"].includes(event.phase));
    assert.equal(terminal.length, 2);
    assert.equal(terminal.every((event) => event.invocationId === "inv_11111111111111111111"), true);
    assert.equal(terminal.every((event) => event.attemptId === "att_22222222222222222222"), true);
    assert.equal(terminal.every((event) => event.providerSessionId === "provider-session"), true);
    assert.equal(terminal.every((event) => Object.hasOwn(event, "hostSessionId") === false), true);
  });
});

test("refreshJob keeps a legacy active host identity when a legacy terminal envelope adds provider identity", () => {
  withWorkspace((workspaceRoot) => {
    const jobId = "job-legacy-two-sessions";
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "ask",
      status: "running",
      pid: 999999,
      sessionId: "legacy-host-session",
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "ask" },
      runContext: { runId: "run-legacy-two-sessions", command: "ask", jobId, provider: "qwen", kind: "ask" },
    });
    writeJobFile(workspaceRoot, jobId, {
      job: { jobId, provider: "qwen", kind: "ask", status: "completed", sessionId: "legacy-provider-session" },
      result: { ok: true, response: "PONG", sessionId: "legacy-provider-session" },
    });

    const refreshed = refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    assert.equal(refreshed.hostSessionId, "legacy-host-session");
    assert.equal(refreshed.providerSessionId, "legacy-provider-session");
    assert.equal(refreshed.sessionId, "legacy-provider-session");
  });
});

test("refreshJob never treats an active host session id as an upstream provider session", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-host-only";
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "ask",
      status: "running",
      pid: 999999,
      hostSessionId: "host-only",
      providerSessionId: null,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "ask" },
      runContext: {
        runId: "run-host-only",
        invocationId: "inv_11111111111111111111",
        attemptId: "att_22222222222222222222",
        command: "ask",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "ask",
      },
    });

    refreshJob(workspaceRoot, listJobs(workspaceRoot)[0]);
    const terminal = (await readRunLedgerEvents(workspaceRoot))
      .filter((event) => ["attempt_result", "provider_decision"].includes(event.phase));
    assert.equal(terminal.length, 2);
    assert.equal(terminal.every((event) => event.providerSessionId === null), true);
    assert.equal(terminal.every((event) => event.sessionId === null), true);
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

test("buildStatusSnapshot retains every active job while bounding terminal history", () => {
  withWorkspace((workspaceRoot) => {
    upsertJob(workspaceRoot, {
      jobId: "job-active-oldest",
      provider: "qwen",
      kind: "review",
      status: "queued",
      updatedAt: "2026-04-22T00:00:00.000Z",
    });
    for (let index = 0; index < 9; index += 1) {
      upsertJob(workspaceRoot, {
        jobId: `job-terminal-${index}`,
        provider: "qwen",
        kind: "review",
        status: "completed",
        updatedAt: `2026-04-22T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
        finishedAt: `2026-04-22T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
      });
    }

    const snapshot = buildStatusSnapshot(workspaceRoot);
    assert.equal(snapshot.totalJobs, 10);
    assert.deepEqual(snapshot.running.map((job) => job.jobId), ["job-active-oldest"]);
    assert.equal(snapshot.recent.length, 8);
    assert.equal(snapshot.recent.some((job) => job.jobId === "job-terminal-0"), false);
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

test("resolveJobSelector supports exact, unique-prefix, latest, active, terminal, and legacy selectors", () => {
  withWorkspace((workspaceRoot) => {
    for (const job of [
      {
        jobId: "job-exact",
        provider: "qwen",
        status: "completed",
        updatedAt: "2026-07-15T00:00:01.000Z",
      },
      {
        jobId: "job-active-old",
        provider: "qwen",
        status: "queued",
        updatedAt: "2026-07-15T00:00:02.000Z",
      },
      {
        jobId: "job-active-new",
        provider: "claude",
        status: "running",
        updatedAt: "2026-07-15T00:00:04.000Z",
      },
      {
        jobId: "job-terminal-new",
        provider: "qwen",
        status: "failed",
        updatedAt: "2026-07-15T00:00:03.000Z",
      },
    ]) {
      upsertJob(workspaceRoot, { kind: "ask", ...job });
    }

    assert.equal(resolveJobSelector(workspaceRoot, "id:job-exact").jobId, "job-exact");
    assert.equal(resolveJobSelector(workspaceRoot, "prefix:job-terminal").jobId, "job-terminal-new");
    assert.equal(resolveJobSelector(workspaceRoot, "latest").jobId, "job-active-new");
    assert.equal(resolveJobSelector(workspaceRoot, "latest-active").jobId, "job-active-new");
    assert.equal(resolveJobSelector(workspaceRoot, "latest-terminal").jobId, "job-terminal-new");
    assert.equal(resolveJobSelector(workspaceRoot, "job-active-o").jobId, "job-active-old");

    const exactBeatsPrefix = resolveJobSelector(workspaceRoot, "job-exact");
    assert.equal(exactBeatsPrefix.jobId, "job-exact");
    assert.equal(
      resolveJobSelector(workspaceRoot, "latest", { predicate: (job) => job.provider === "qwen" }).jobId,
      "job-terminal-new",
    );
  });
});

test("resolveJobSelector reports bounded ambiguity and distinguishes missing selector classes", () => {
  withWorkspace((workspaceRoot) => {
    for (let index = 0; index < 12; index += 1) {
      upsertJob(workspaceRoot, {
        jobId: `shared-prefix-${String(index).padStart(2, "0")}`,
        provider: "qwen",
        kind: "ask",
        status: "running",
        updatedAt: new Date(Date.UTC(2026, 6, 15, 0, 0, index)).toISOString(),
      });
    }

    assert.throws(
      () => resolveJobSelector(workspaceRoot, "prefix:shared-prefix-"),
      (error) => {
        assert.equal(error.code, "ambiguous_selector");
        assert.equal(error.data.selector, "prefix:shared-prefix-");
        assert.equal(error.data.candidateIds.length, 8);
        assert.deepEqual(error.data.candidateIds.slice(0, 2), ["shared-prefix-11", "shared-prefix-10"]);
        return true;
      },
    );
    assert.throws(
      () => resolveJobSelector(workspaceRoot, "shared-prefix-"),
      (error) => error.code === "ambiguous_selector" && error.data.candidateIds.length === 8,
    );
    assert.throws(
      () => resolveJobSelector(workspaceRoot, "id:shared-prefix"),
      (error) => error.code === "job_not_found",
    );
    assert.throws(
      () => resolveJobSelector(workspaceRoot, "prefix:no-match"),
      (error) => error.code === "job_not_found",
    );
  });

  withWorkspace((workspaceRoot) => {
    assert.throws(
      () => resolveJobSelector(workspaceRoot, "latest-active"),
      (error) => error.code === "no_active_job",
    );
    assert.throws(
      () => resolveJobSelector(workspaceRoot, "latest-terminal"),
      (error) => error.code === "no_completed_job",
    );
    assert.throws(
      () => resolveJobSelector(workspaceRoot, "latest"),
      (error) => error.code === "job_not_found",
    );
  });
});

test("resolveJobSelector explicit grammar rejects bare job references without weakening typed selectors", () => {
  withWorkspace((workspaceRoot) => {
    for (const job of [
      { jobId: "job-exact", status: "completed", updatedAt: "2026-07-15T00:00:01.000Z" },
      { jobId: "job-active", status: "running", updatedAt: "2026-07-15T00:00:03.000Z" },
      { jobId: "job-terminal", status: "failed", updatedAt: "2026-07-15T00:00:02.000Z" },
    ]) {
      upsertJob(workspaceRoot, { provider: "qwen", kind: "ask", ...job });
    }

    const explicit = { grammar: "explicit" };
    assert.equal(resolveJobSelector(workspaceRoot, "id:job-exact", explicit).jobId, "job-exact");
    assert.equal(resolveJobSelector(workspaceRoot, "prefix:job-act", explicit).jobId, "job-active");
    assert.equal(resolveJobSelector(workspaceRoot, "latest", explicit).jobId, "job-active");
    assert.equal(resolveJobSelector(workspaceRoot, "latest-active", explicit).jobId, "job-active");
    assert.equal(resolveJobSelector(workspaceRoot, "latest-terminal", explicit).jobId, "job-terminal");
    assert.throws(
      () => resolveJobSelector(workspaceRoot, "job-exact", explicit),
      (error) => (
        error.code === "invalid_argument"
        && error.data.selector === "job-exact"
        && error.data.grammar === "explicit"
      ),
    );

    // The default remains the legacy positional grammar for existing callers.
    assert.equal(resolveJobSelector(workspaceRoot, "job-exact").jobId, "job-exact");
    assert.equal(resolveJobSelector(workspaceRoot, "job-act").jobId, "job-active");
  });
});

test("resolveJobSelector reads only the selected workspace state", () => {
  withWorkspace((firstWorkspace) => {
    upsertJob(firstWorkspace, {
      jobId: "workspace-local-job",
      provider: "qwen",
      kind: "ask",
      status: "completed",
    });

    const secondWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-other-workspace-"));
    try {
      ensureStateDir(secondWorkspace);
      assert.throws(
        () => resolveJobSelector(secondWorkspace, "id:workspace-local-job"),
        (error) => error.code === "job_not_found",
      );
    } finally {
      fs.rmSync(secondWorkspace, { recursive: true, force: true });
    }
  });
});

test("waitForJob returns typed satisfied and terminal mismatch results", async () => {
  await withWorkspace(async (workspaceRoot) => {
    upsertJob(workspaceRoot, {
      jobId: "job-completed",
      provider: "qwen",
      kind: "ask",
      status: "completed",
    });
    upsertJob(workspaceRoot, {
      jobId: "job-failed",
      provider: "qwen",
      kind: "ask",
      status: "failed",
    });

    const completed = await waitForJob(workspaceRoot, "job-completed", { for: "completed" });
    assert.equal(completed.job.status, "completed");
    assert.equal(completed.waitTimedOut, false);
    assert.deepEqual(completed.wait, {
      for: "completed",
      satisfied: true,
      timedOut: false,
      terminalMismatch: false,
    });

    const defaultTerminal = await waitForJob(workspaceRoot, "job-failed");
    assert.equal(defaultTerminal.wait.satisfied, true);
    assert.equal(defaultTerminal.wait.for, "terminal");

    const mismatch = await waitForJob(workspaceRoot, "job-failed", { for: "completed" });
    assert.equal(mismatch.job.status, "failed");
    assert.deepEqual(mismatch.wait, {
      for: "completed",
      satisfied: false,
      timedOut: false,
      terminalMismatch: true,
    });
  });
});

test("waitForJob timeout preserves the latest authoritative job and legacy fields", async () => {
  await withWorkspace(async (workspaceRoot) => {
    upsertJob(workspaceRoot, {
      jobId: "job-still-running",
      provider: "qwen",
      kind: "ask",
      status: "running",
      pid: null,
      promptPreview: "authoritative state",
    });

    const timedOut = await waitForJob(workspaceRoot, "job-still-running", {
      for: "completed",
      timeoutMs: 0,
      pollIntervalMs: 1,
    });
    assert.equal(timedOut.job.status, "running");
    assert.equal(timedOut.job.promptPreview, "authoritative state");
    assert.equal(timedOut.waitTimedOut, true);
    assert.deepEqual(timedOut.wait, {
      for: "completed",
      satisfied: false,
      timedOut: true,
      terminalMismatch: false,
    });
  });
});

test("waitForJob validates the target and reports a missing job compatibly", async () => {
  await withWorkspace(async (workspaceRoot) => {
    await assert.rejects(
      () => waitForJob(workspaceRoot, "missing-job", { for: "tui-idle" }),
      (error) => error.code === "invalid_argument",
    );

    const missing = await waitForJob(workspaceRoot, "missing-job", { for: "terminal" });
    assert.equal(missing.error, "job_not_found");
    assert.equal(missing.job, null);
    assert.equal(missing.waitTimedOut, false);
    assert.deepEqual(missing.wait, {
      for: "terminal",
      satisfied: false,
      timedOut: false,
      terminalMismatch: false,
    });
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

test("cancelJob keeps state active when an older terminal ledger prefix conflicts", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-cancel-partial-pair";
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    fs.writeFileSync(logFile, "assistant progress\n");
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: null,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "rescue" },
      runContext: {
        runId: "run-cancel-partial-pair",
        command: "rescue",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "rescue",
        logFile,
      },
    });
    await appendRunLedgerEvent(workspaceRoot, {
      runId: "run-cancel-partial-pair",
      command: "rescue",
      commands: ["rescue"],
      kind: "rescue",
      provider: "wrong-provider",
      phase: "attempt_result",
      status: "cancelled",
      reason: "cancelled",
      jobId,
      hostSurface: "terminal",
      logFile,
    });

    await assert.rejects(
      () => cancelJob(workspaceRoot, jobId),
      /Incomplete or conflicting terminal ledger pair/,
    );
    assert.equal(listJobs(workspaceRoot).find((job) => job.jobId === jobId)?.status, "running");
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, jobId)), true);
  });
});

test("cancelJob resumes a persisted cancellation intent after a transient ledger failure", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-cancel-resume";
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    fs.writeFileSync(logFile, "assistant progress\n");
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: null,
      logFile,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "rescue" },
      runContext: {
        runId: "run-cancel-resume",
        command: "rescue",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "rescue",
        logFile,
      },
    });

    const ledgerFile = resolveRunLedgerFile(workspaceRoot);
    fs.mkdirSync(ledgerFile, { mode: 0o700 });
    await assert.rejects(() => cancelJob(workspaceRoot, jobId), /EISDIR|illegal operation|operation on a directory/i);
    assert.equal(listJobs(workspaceRoot).find((job) => job.jobId === jobId)?.status, "running");
    assert.equal(readJobFile(resolveJobFile(workspaceRoot, jobId))?.job?.status, "cancelled");

    fs.rmSync(ledgerFile, { recursive: true, force: true });
    const resumed = await cancelJob(workspaceRoot, jobId);
    assert.equal(resumed.cancelled, true);
    assert.equal(listJobs(workspaceRoot).find((job) => job.jobId === jobId)?.status, "cancelled");
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, jobId)), false);
    const events = (await readRunLedgerEvents(workspaceRoot)).filter((event) => event.runId === "run-cancel-resume");
    assert.deepEqual(events.map((event) => [event.phase, event.status, event.reason]), [
      ["attempt_result", "cancelled", "cancelled"],
      ["provider_decision", "cancelled", "cancelled"],
    ]);
  });
});

test("cancelJob refreshes updatedAt so a newly terminal job survives history pruning", async () => {
  await withWorkspace(async (workspaceRoot) => {
    for (let index = 0; index < 100; index += 1) {
      upsertJob(workspaceRoot, {
        jobId: `historical-${index}`,
        provider: "qwen",
        kind: "rescue",
        status: "completed",
        updatedAt: new Date(Date.UTC(2099, 0, 1, 0, 0, index)).toISOString(),
      });
    }
    const jobId = "job-newly-terminal";
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: null,
      updatedAt: "2000-01-01T00:00:00.000Z",
    });

    const report = await cancelJob(workspaceRoot, jobId);
    assert.equal(report.cancelled, true);
    const saved = listJobs(workspaceRoot).find((job) => job.jobId === jobId);
    assert.equal(saved?.status, "cancelled");
    assert.ok(saved.updatedAt > "2026-01-01T00:00:00.000Z");
    assert.equal(readJobFile(resolveJobFile(workspaceRoot, jobId))?.job?.status, "cancelled");
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
    let statusAtKill = null;
    let workerAlive = true;
    const report = await cancelJob(workspaceRoot, "job-order", {
      terminate: async () => {
        // The cleanup path (a review's live cwd) must still exist when the kill runs.
        dirExistedAtKill = fs.existsSync(cleanupDir);
        statusAtKill = listJobs(workspaceRoot).find((job) => job.jobId === "job-order")?.status;
        workerAlive = false;
      },
      isWorkerAlive: () => workerAlive,
      isExpectedWorker: () => true,
    });

    assert.equal(report.cancelled, true);
    assert.equal(dirExistedAtKill, true);
    assert.equal(statusAtKill, "running");
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
      isWorkerAlive: () => true,
      isExpectedWorker: () => true,
    });

    assert.equal(report.cancelled, false);
    assert.equal(report.reason, "kill_failed");
    assert.equal(report.killWarning, "kill failed");
    // Worker may still be alive, so its runtime paths must NOT be deleted.
    assert.equal(fs.existsSync(cleanupDir), true);
    assert.equal(listJobs(workspaceRoot).find((job) => job.jobId === "job-killfail")?.status, "running");
    assert.equal(fs.existsSync(resolveJobConfigFile(workspaceRoot, "job-killfail")), true);
    fs.rmSync(cleanupDir, { recursive: true, force: true });
  });
});

test("cancelJob refuses to signal a reused pid that no longer identifies its worker", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const jobId = "job-pid-reused";
    upsertJob(workspaceRoot, {
      jobId,
      provider: "qwen",
      kind: "rescue",
      status: "running",
      pid: 4242,
    });
    writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      execution: { provider: "qwen", kind: "rescue" },
      runContext: {
        runId: "run-pid-reused",
        command: "rescue",
        hostSurface: "terminal",
        jobId,
        provider: "qwen",
        kind: "rescue",
      },
    });

    let signalled = false;
    const report = await cancelJob(workspaceRoot, jobId, {
      terminate: async () => {
        signalled = true;
      },
      isWorkerAlive: () => true,
      isExpectedWorker: () => false,
    });

    assert.equal(report.cancelled, false);
    assert.equal(report.reason, "worker_identity_unverified");
    assert.equal(signalled, false);
    assert.equal(listJobs(workspaceRoot).find((job) => job.jobId === jobId)?.status, "running");
    assert.equal(readJobFile(resolveJobFile(workspaceRoot, jobId))?.job?.status, "cancelled");
  });
});
