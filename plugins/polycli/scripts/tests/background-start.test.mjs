import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  recordBackgroundStartFailure,
  startBackgroundWorker,
} from "../lib/background-start.mjs";
import { refreshJob } from "../lib/job-control.mjs";
import { readRunLedgerEvents } from "../lib/run-ledger.mjs";
import {
  ensureStateDir,
  getJob,
  readJobFile,
  resolveJobConfigFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveJobStartFailureFile,
  resolveStateDir,
  resolveStateFile,
  upsertJob,
  writeJobFile,
  writeJobStartFailureFile,
} from "../lib/state.mjs";

async function withBackgroundJob(name, callback) {
  const workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-bg-start-workspace-")));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-bg-start-state-"));
  const cleanupPath = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-bg-start-runtime-"));
  const previous = process.env.POLYCLI_STATE_ROOT;
  process.env.POLYCLI_STATE_ROOT = stateRoot;
  const jobId = `job-${name}`;
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const job = {
    jobId,
    provider: "qwen",
    kind: "rescue",
    status: "queued",
    pid: null,
    logFile,
  };
  const execution = {
    provider: "qwen",
    kind: "rescue",
    cwd: workspaceRoot,
    runtimeOptions: { cleanupPaths: [cleanupPath] },
    jobMeta: {},
  };
  const runContext = {
    runId: `run-${name}`,
    invocationId: `inv-${name}`,
    attemptId: `att-${name}`,
    command: "rescue",
    commands: ["rescue"],
    hostSurface: "terminal",
    argv: ["rescue", "<prompt:redacted>"],
    jobId,
    provider: "qwen",
    kind: "rescue",
    logFile,
  };
  const config = {
    workspaceRoot,
    jobId,
    execution: { ...execution, measurementScope: "job" },
    runContext,
  };
  ensureStateDir(workspaceRoot);
  upsertJob(workspaceRoot, job);
  try {
    return await callback({ workspaceRoot, jobId, job, execution, runContext, config, logFile, cleanupPath });
  } finally {
    if (previous == null) delete process.env.POLYCLI_STATE_ROOT;
    else process.env.POLYCLI_STATE_ROOT = previous;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
}

for (const fault of ["config", "log-write", "log-open", "spawn"]) {
  test(`background start finalizes a synchronous ${fault} failure`, async () => {
    await withBackgroundJob(fault, async (fixture) => {
      let spawnCalls = 0;
      let closeCalls = 0;
      const injected = new Error(`injected ${fault} failure at /private/owned/runtime`);
      const dependencies = {
        ...(fault === "config" ? { writeConfigFile() { throw injected; } } : {}),
        ...(fault === "log-write" ? { writeLogFile() { throw injected; } } : {}),
        ...(fault === "log-open" ? { openLogFile() { throw injected; } } : {}),
        closeLogFile(fd) {
          closeCalls += 1;
          fs.closeSync(fd);
        },
        spawnWorker() {
          spawnCalls += 1;
          if (fault === "spawn") throw injected;
          throw new Error(`spawn should not be reached for ${fault}`);
        },
      };

      await assert.rejects(
        () => startBackgroundWorker({
          workspaceRoot: fixture.workspaceRoot,
          job: fixture.job,
          execution: fixture.execution,
          runContext: fixture.runContext,
          config: fixture.config,
          companionPath: "/tmp/polycli-companion.mjs",
          env: {},
        }, dependencies),
        (error) => error === injected,
      );

      assert.equal(spawnCalls, fault === "spawn" ? 1 : 0);
      assert.equal(closeCalls, fault === "spawn" ? 1 : 0);
      assert.equal(getJob(fixture.workspaceRoot, fixture.jobId)?.status, "failed");
      const envelope = readJobFile(resolveJobFile(fixture.workspaceRoot, fixture.jobId));
      assert.equal(envelope?.job?.status, "failed");
      assert.equal(envelope?.result?.ok, false);
      assert.match(envelope?.result?.error || "", /<path:redacted>/);
      assert.doesNotMatch(envelope?.result?.error || "", /private\/owned/);
      assert.equal(fs.existsSync(resolveJobConfigFile(fixture.workspaceRoot, fixture.jobId)), false);
      assert.equal(fs.existsSync(fixture.cleanupPath), false);
      const terminal = (await readRunLedgerEvents(fixture.workspaceRoot)).filter((event) =>
        ["attempt_result", "provider_decision"].includes(event.phase)
      );
      assert.deepEqual(terminal.map((event) => [event.phase, event.status, event.reason]), [
        ["attempt_result", "failed", "rescue_failed"],
        ["provider_decision", "failed", "rescue_failed"],
      ]);
    });
  });
}

test("background start does not publish failed when close throws after spawn succeeds", async () => {
  await withBackgroundJob("close-after-spawn", async (fixture) => {
    let errorHandler = null;
    const child = {
      pid: 4242,
      once(event, handler) {
        if (event === "error") errorHandler = handler;
      },
      unref() {},
    };

    const started = await startBackgroundWorker({
      workspaceRoot: fixture.workspaceRoot,
      job: fixture.job,
      execution: fixture.execution,
      runContext: fixture.runContext,
      config: fixture.config,
      companionPath: "/tmp/polycli-companion.mjs",
      env: {},
    }, {
      openLogFile: () => 99,
      spawnWorker: () => child,
      closeLogFile() {
        throw new Error("injected close failure");
      },
    });

    assert.equal(started.child, child);
    assert.match(started.closeWarning?.message || "", /close failure/);
    assert.equal(typeof errorHandler, "function");
    assert.equal(getJob(fixture.workspaceRoot, fixture.jobId)?.status, "queued");
    assert.equal(readJobFile(resolveJobFile(fixture.workspaceRoot, fixture.jobId)), null);
    assert.equal((await readRunLedgerEvents(fixture.workspaceRoot)).filter((event) =>
      ["attempt_result", "provider_decision"].includes(event.phase)
    ).length, 0);
    assert.equal(fs.existsSync(fixture.cleanupPath), true);
  });
});

test("background child async error uses the same terminal finalizer", async () => {
  await withBackgroundJob("async-error", async (fixture) => {
    let errorHandler = null;
    const child = {
      pid: 4242,
      once(event, handler) {
        if (event === "error") errorHandler = handler;
      },
      unref() {},
    };
    await startBackgroundWorker({
      workspaceRoot: fixture.workspaceRoot,
      job: fixture.job,
      execution: fixture.execution,
      runContext: fixture.runContext,
      config: fixture.config,
      companionPath: "/tmp/polycli-companion.mjs",
      env: {},
    }, {
      openLogFile: () => 99,
      closeLogFile() {},
      spawnWorker: () => child,
    });

    errorHandler(new Error("async spawn error"));

    assert.equal(getJob(fixture.workspaceRoot, fixture.jobId)?.status, "failed");
    const terminal = (await readRunLedgerEvents(fixture.workspaceRoot)).filter((event) =>
      ["attempt_result", "provider_decision"].includes(event.phase)
    );
    assert.equal(terminal.length, 2);
    assert.equal(fs.existsSync(resolveJobConfigFile(fixture.workspaceRoot, fixture.jobId)), false);
    assert.equal(fs.existsSync(fixture.cleanupPath), false);
  });
});

test("config failure remains recoverable when terminal ledger persistence is transiently unavailable", async () => {
  await withBackgroundJob("config-ledger-retry", async (fixture) => {
    const injected = new Error("original config failure");
    const ledgerFile = path.join(resolveStateDir(fixture.workspaceRoot), "run-ledger.ndjson");
    fs.mkdirSync(ledgerFile, { mode: 0o700 });

    await assert.rejects(
      () => startBackgroundWorker({
        workspaceRoot: fixture.workspaceRoot,
        job: fixture.job,
        execution: fixture.execution,
        runContext: fixture.runContext,
        config: fixture.config,
        companionPath: "/tmp/polycli-companion.mjs",
        env: {},
      }, {
        writeConfigFile() {
          throw injected;
        },
      }),
      (error) => error === injected,
    );

    assert.equal(getJob(fixture.workspaceRoot, fixture.jobId)?.status, "queued");
    assert.equal(readJobFile(resolveJobFile(fixture.workspaceRoot, fixture.jobId))?.job?.status, "failed");
    assert.equal(fs.existsSync(resolveJobConfigFile(fixture.workspaceRoot, fixture.jobId)), false);
    assert.equal(fs.existsSync(fixture.cleanupPath), false, "owned runtime path is safe to clean because spawn was never reached");

    fs.rmSync(ledgerFile, { recursive: true, force: true });
    const recovered = refreshJob(fixture.workspaceRoot, getJob(fixture.workspaceRoot, fixture.jobId));
    assert.equal(recovered.status, "failed");
    const terminal = (await readRunLedgerEvents(fixture.workspaceRoot)).filter((event) =>
      ["attempt_result", "provider_decision"].includes(event.phase)
    );
    assert.deepEqual(terminal.map((event) => event.phase), ["attempt_result", "provider_decision"]);
  });
});

test("pre-envelope state-lock failure leaves a private safe sidecar that refresh finalizes exactly once", async () => {
  await withBackgroundJob("state-lock-retry", async (fixture) => {
    const injected = new Error("original spawn failure at /private/owned/runtime");
    const stateLock = `${resolveStateFile(fixture.workspaceRoot)}.lock`;
    fs.writeFileSync(stateLock, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { mode: 0o600 });

    await assert.rejects(
      () => startBackgroundWorker({
        workspaceRoot: fixture.workspaceRoot,
        job: fixture.job,
        execution: fixture.execution,
        runContext: fixture.runContext,
        config: fixture.config,
        companionPath: "/tmp/polycli-companion.mjs",
        env: {},
        failureFinalizationOptions: { lockOptions: { timeoutMs: 25, pollMs: 1 } },
      }, {
        spawnWorker() {
          throw injected;
        },
      }),
      (error) => error === injected,
    );

    const sidecarFile = resolveJobStartFailureFile(fixture.workspaceRoot, fixture.jobId);
    const sidecarText = fs.readFileSync(sidecarFile, "utf8");
    const sidecar = JSON.parse(sidecarText);
    assert.equal(fs.statSync(sidecarFile).mode & 0o777, 0o600);
    assert.equal(sidecar.error, "original spawn failure at <path:redacted>");
    assert.equal(sidecar.jobId, fixture.jobId);
    assert.equal(sidecar.terminalDescriptor.jobId, fixture.jobId);
    assert.doesNotMatch(sidecarText, /prompt:redacted|\"argv\"|\"env\"/);
    assert.equal(getJob(fixture.workspaceRoot, fixture.jobId)?.status, "queued");
    assert.equal(readJobFile(resolveJobFile(fixture.workspaceRoot, fixture.jobId)), null);
    assert.equal((await readRunLedgerEvents(fixture.workspaceRoot)).length, 0);

    fs.rmSync(stateLock, { force: true });
    const recovered = refreshJob(fixture.workspaceRoot, getJob(fixture.workspaceRoot, fixture.jobId));
    assert.equal(recovered.status, "failed");
    assert.equal(fs.existsSync(sidecarFile), false);
    assert.equal(fs.existsSync(resolveJobConfigFile(fixture.workspaceRoot, fixture.jobId)), false);
    assert.equal(fs.existsSync(fixture.cleanupPath), false);
    refreshJob(fixture.workspaceRoot, recovered);
    const terminal = (await readRunLedgerEvents(fixture.workspaceRoot)).filter((event) =>
      ["attempt_result", "provider_decision"].includes(event.phase)
    );
    assert.deepEqual(terminal.map((event) => event.phase), ["attempt_result", "provider_decision"]);
  });
});

test("a late start-failure finalizer removes its sidecar without overwriting a terminal winner", async () => {
  await withBackgroundJob("terminal-winner", async (fixture) => {
    const finishedJob = {
      ...getJob(fixture.workspaceRoot, fixture.jobId),
      status: "completed",
      pid: null,
      finishedAt: new Date().toISOString(),
    };
    upsertJob(fixture.workspaceRoot, finishedJob);
    writeJobFile(fixture.workspaceRoot, fixture.jobId, {
      job: finishedJob,
      result: { ok: true, response: "winner" },
    });
    writeJobStartFailureFile(fixture.workspaceRoot, fixture.jobId, {
      version: 1,
      jobId: fixture.jobId,
      error: "stale failure",
    });

    const report = recordBackgroundStartFailure(
      fixture.workspaceRoot,
      fixture.jobId,
      fixture.execution,
      fixture.runContext,
      new Error("late async child error"),
    );

    assert.equal(report.written, false);
    assert.equal(fs.existsSync(resolveJobStartFailureFile(fixture.workspaceRoot, fixture.jobId)), false);
    const winner = readJobFile(resolveJobFile(fixture.workspaceRoot, fixture.jobId));
    assert.equal(winner.job.status, "completed");
    assert.equal(winner.result.response, "winner");
  });
});
