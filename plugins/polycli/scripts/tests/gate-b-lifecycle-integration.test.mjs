import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { COMMAND_DEFINITIONS } from "../lib/command-registry.mjs";
import { cancelJob } from "../lib/job-control.mjs";
import { appendRunLedgerEvent } from "../lib/run-ledger.mjs";
import {
  computeWorkspaceSlug,
  resolveJobConfigFile,
  resolveJobFile,
  resolveJobLogFile,
  upsertJob,
  writeJobConfigFile,
} from "../lib/state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const companion = path.resolve(here, "..", "polycli-companion.mjs");
const ORIGINAL_STATE_ROOT = process.env.POLYCLI_STATE_ROOT;

function createWorkspace(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const workspace = path.join(root, "workspace");
  const stateRoot = path.join(root, "state");
  fs.mkdirSync(workspace, { recursive: true });
  const cwd = fs.realpathSync(workspace);
  return { root, cwd, stateRoot };
}

function statePathFor(stateRoot, cwd, ...parts) {
  return path.join(stateRoot, computeWorkspaceSlug(cwd), ...parts);
}

function runCompanion(args, { cwd, stateRoot, env = {} }) {
  return spawnSync(process.execPath, [companion, ...args], {
    cwd,
    env: {
      ...process.env,
      POLYCLI_STATE_ROOT: stateRoot,
      POLYCLI_HOST_SURFACE: "terminal",
      ...env,
    },
    encoding: "utf8",
    timeout: 15_000,
  });
}

function createCompanionFaultInjector(root) {
  const file = path.join(root, "companion-fault-injector.mjs");
  fs.writeFileSync(file, `
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

if (process.argv[1]?.endsWith("polycli-companion.mjs")) {
  const originalAppendFileSync = fs.appendFileSync;
  fs.appendFileSync = function patchedAppendFileSync(file, data, ...args) {
    const phase = process.env.POLYCLI_TEST_FAIL_LEDGER_PHASE;
    if (phase && String(data).includes(\`"phase":"\${phase}"\`)) {
      throw Object.assign(new Error(\`injected \${phase} ledger failure\`), { code: "EIO" });
    }
    return originalAppendFileSync.call(this, file, data, ...args);
  };

  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function patchedSpawnSync(command, args, ...rest) {
    if (
      process.env.POLYCLI_TEST_THROW_QWEN_AVAILABILITY === "1"
      && String(command).endsWith("qwen")
      && Array.isArray(args)
      && args.includes("--version")
    ) {
      throw new Error("injected qwen availability failure");
    }
    return originalSpawnSync.call(this, command, args, ...rest);
  };

  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function patchedSpawn(command, args, ...rest) {
    if (
      process.env.POLYCLI_TEST_CANCEL_BEFORE_SPAWN_RETURN === "1"
      && Array.isArray(args)
      && args[0] === process.argv[1]
      && args[1] === "_job-worker"
    ) {
      const jobId = args[2].split(/[\\/]/).at(-1).replace(/\.config\.json$/, "");
      const cancel = originalSpawnSync(process.execPath, [process.argv[1], "cancel", "id:" + jobId, "--json"], {
        cwd: process.cwd(),
        env: { ...process.env, POLYCLI_TEST_CANCEL_BEFORE_SPAWN_RETURN: "0" },
        encoding: "utf8",
      });
      if (cancel.status !== 0) throw new Error("injected cancellation failed: " + (cancel.stderr || cancel.stdout));
    }
    return originalSpawn.call(this, command, args, ...rest);
  };

  syncBuiltinESMExports();
}
`, "utf8");
  return `--import=${pathToFileURL(file).href}`;
}

function createFakeQwen({ breakLedgerPath = null, breakTimingPath = null } = {}) {
  const binRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-gate-b-qwen-"));
  const executable = path.join(binRoot, "qwen");
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("qwen 0.0.0-gate-b-test\\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write("authenticated\\n");
  process.exit(0);
}
if (process.env.QWEN_BREAK_LEDGER_PATH) {
  fs.rmSync(process.env.QWEN_BREAK_LEDGER_PATH, { recursive: true, force: true });
  fs.mkdirSync(process.env.QWEN_BREAK_LEDGER_PATH, { recursive: true });
}
if (process.env.QWEN_BREAK_TIMING_PATH) {
  fs.rmSync(process.env.QWEN_BREAK_TIMING_PATH, { recursive: true, force: true });
  fs.symlinkSync(process.env.QWEN_BREAK_TIMING_PATH, process.env.QWEN_BREAK_TIMING_PATH);
}
if (process.env.QWEN_RESULT_GATE) {
  const deadline = Date.now() + 10000;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (fs.existsSync(process.env.QWEN_RESULT_GATE) && Date.now() < deadline) {
    Atomics.wait(signal, 0, 0, 10);
  }
}
process.stdout.write(JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "11111111-1111-4111-8111-111111111111",
  model: "qwen-test"
}) + "\\n");
process.stdout.write(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "GATE_B_OK" }] }
}) + "\\n");
process.stdout.write(JSON.stringify({
  type: "result",
  result: "GATE_B_OK",
  is_error: false,
  permission_denials: []
}) + "\\n");
`, { mode: 0o755 });
  return {
    env: {
      PATH: `${binRoot}${path.delimiter}${process.env.PATH || ""}`,
      ...(breakLedgerPath ? { QWEN_BREAK_LEDGER_PATH: breakLedgerPath } : {}),
      ...(breakTimingPath ? { QWEN_BREAK_TIMING_PATH: breakTimingPath } : {}),
    },
    cleanup() {
      fs.rmSync(binRoot, { recursive: true, force: true });
    },
  };
}

async function waitForTerminalEnvelope(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      if (["completed", "failed", "cancelled"].includes(envelope?.job?.status)) return envelope;
    } catch {
      // The detached worker publishes the atomic file shortly after its parent returns.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for terminal job envelope ${file}`);
}

async function waitForPathAbsent(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for path removal ${file}`);
}

function withStateRoot(stateRoot, callback) {
  process.env.POLYCLI_STATE_ROOT = stateRoot;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (ORIGINAL_STATE_ROOT == null) delete process.env.POLYCLI_STATE_ROOT;
      else process.env.POLYCLI_STATE_ROOT = ORIGINAL_STATE_ROOT;
    });
}

test("background spawn and worker persist provider session as the legacy terminal alias", async () => {
  const fixture = createWorkspace("polycli-gate-b-worker-");
  const qwen = createFakeQwen();
  const resultGate = path.join(fixture.root, "hold-result");
  fs.writeFileSync(resultGate, "hold\n", { mode: 0o600 });
  try {
    const started = runCompanion(
      ["ask", "--provider", "qwen", "--background", "--json", "--run-id", "run_gate_b_worker", "hello"],
      {
        cwd: fixture.cwd,
        stateRoot: fixture.stateRoot,
        env: {
          ...qwen.env,
          POLYCLI_COMPANION_SESSION_ID: "host-session-gate-b",
          QWEN_RESULT_GATE: resultGate,
        },
      },
    );
    assert.equal(started.status, 0, started.stderr);
    const jobId = JSON.parse(started.stdout).job.jobId;
    const configFile = statePathFor(fixture.stateRoot, fixture.cwd, "jobs", `${jobId}.config.json`);
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    assert.equal(config.hostSessionId, "host-session-gate-b");
    fs.rmSync(resultGate, { force: true });
    const envelopeFile = statePathFor(fixture.stateRoot, fixture.cwd, "jobs", `${jobId}.json`);
    const raw = await waitForTerminalEnvelope(envelopeFile);

    assert.equal(raw.job.status, "completed");
    assert.equal(raw.job.hostSessionId, "host-session-gate-b");
    assert.equal(raw.job.providerSessionId, "11111111-1111-4111-8111-111111111111");
    assert.equal(raw.job.sessionId, raw.job.providerSessionId);
    assert.notEqual(raw.job.sessionId, raw.job.hostSessionId);
    assert.equal(raw.result.providerSessionId, "11111111-1111-4111-8111-111111111111");
    assert.equal(raw.result.sessionId, raw.result.providerSessionId);
    await waitForPathAbsent(statePathFor(fixture.stateRoot, fixture.cwd, "jobs", `${jobId}.config.json`));
  } finally {
    fs.rmSync(resultGate, { force: true });
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("setup provider probes persist one attempt-keyed terminal pair", async () => {
  const fixture = createWorkspace("polycli-gate-b-setup-attempt-");
  const qwen = createFakeQwen();
  try {
    const result = runCompanion(
      ["setup", "--provider", "qwen", "--probe-auth", "--json-v2", "--run-id", "run_gate_b_setup_probe"],
      { cwd: fixture.cwd, stateRoot: fixture.stateRoot, env: qwen.env },
    );
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.result.type, "provider.setup");
    assert.equal(payload._meta.runId, "run_gate_b_setup_probe");

    const events = fs.readFileSync(
      statePathFor(fixture.stateRoot, fixture.cwd, "run-ledger.ndjson"),
      "utf8",
    ).trim().split("\n").map((line) => JSON.parse(line));
    const terminal = events.filter((event) => ["attempt_result", "provider_decision"].includes(event.phase));
    assert.equal(events.filter((event) => event.phase === "attempt_started").length, 1);
    assert.equal(terminal.length, 2);
    assert.match(terminal[0].attemptId, /^att_[a-f0-9]{20}$/);
    assert.equal(terminal[0].attemptId, terminal[1].attemptId);
    assert.equal(terminal[0].invocationId, terminal[1].invocationId);
  } finally {
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("background JSON v2 remains job.started when cancellation wins the parent race", () => {
  const fixture = createWorkspace("polycli-gate-c-background-race-");
  const marker = path.join(fixture.root, "provider-must-not-run");
  const qwen = createFakeQwen();
  const nodeOptions = createCompanionFaultInjector(fixture.root);
  try {
    const result = runCompanion(
      ["ask", "--provider", "qwen", "--background", "--json-v2", "--run-id", "run_gate_c_background_race", "hello"],
      {
        cwd: fixture.cwd,
        stateRoot: fixture.stateRoot,
        env: {
          ...qwen.env,
          NODE_OPTIONS: nodeOptions,
          POLYCLI_TEST_CANCEL_BEFORE_SPAWN_RETURN: "1",
          QWEN_EVENT_LOG: marker,
        },
      },
    );
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.result.type, "job.started");
    assert.equal(payload.result.job.status, "cancelled");
    assert.equal(payload._meta.jobId, payload.result.job.jobId);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("cancelled terminal envelopes never copy host identity into the legacy provider alias", async () => {
  const fixture = createWorkspace("polycli-gate-b-cancel-");
  try {
    await withStateRoot(fixture.stateRoot, async () => {
      const workspaceRoot = fixture.cwd;
      const jobId = "job-gate-b-cancel";
      const logFile = resolveJobLogFile(workspaceRoot, jobId);
      upsertJob(workspaceRoot, {
        jobId,
        provider: "qwen",
        kind: "ask",
        status: "running",
        pid: null,
        logFile,
        invocationId: "inv_gate_b_cancel",
        attemptId: "att_gate_b_cancel",
        hostSessionId: "host-session-cancel",
        providerSessionId: "provider-session-before-cancel",
      });
      writeJobConfigFile(workspaceRoot, jobId, {
        workspaceRoot,
        jobId,
        execution: { provider: "qwen", kind: "ask", runtimeOptions: {} },
        runContext: {
          version: 2,
          runId: "run_gate_b_cancel",
          invocationId: "inv_gate_b_cancel",
          attemptId: "att_gate_b_cancel",
          command: "ask",
          hostSurface: "terminal",
          jobId,
          provider: "qwen",
          kind: "ask",
        },
      });
      await appendRunLedgerEvent(workspaceRoot, {
        runId: "run_gate_b_cancel",
        invocationId: "inv_gate_b_cancel",
        attemptId: "att_gate_b_cancel",
        command: "ask",
        kind: "ask",
        provider: "qwen",
        phase: "attempt_started",
        status: "started",
        jobId,
        hostSurface: "terminal",
      });

      const report = await cancelJob(workspaceRoot, jobId);
      assert.equal(report.cancelled, true);
      const raw = JSON.parse(fs.readFileSync(resolveJobFile(workspaceRoot, jobId), "utf8"));
      assert.equal(raw.job.status, "cancelled");
      assert.equal(raw.job.hostSessionId, "host-session-cancel");
      assert.equal(raw.job.providerSessionId, "provider-session-before-cancel");
      assert.equal(raw.job.sessionId, raw.job.providerSessionId);
      assert.notEqual(raw.job.sessionId, raw.job.hostSessionId);
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("legacy debug show preserves v1 raw identity while --json-v2 normalizes it", () => {
  const fixture = createWorkspace("polycli-gate-b-debug-");
  const legacyEvent = {
    version: 1,
    eventId: "evt_gate_b_v1",
    runId: "run_gate_b_v1",
    command: "ask",
    provider: "qwen",
    phase: "attempt_result",
    status: "completed",
    sessionId: "provider-session-v1",
  };
  try {
    const ledgerFile = statePathFor(fixture.stateRoot, fixture.cwd, "run-ledger.ndjson");
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    fs.writeFileSync(ledgerFile, `${JSON.stringify(legacyEvent)}\n`, "utf8");

    const legacy = runCompanion(["debug", "show", legacyEvent.runId, "--json"], fixture);
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.deepEqual(JSON.parse(legacy.stdout).events, [legacyEvent]);

    const v2 = runCompanion(["debug", "show", legacyEvent.runId, "--json-v2"], fixture);
    assert.equal(v2.status, 0, v2.stderr);
    const v2Event = JSON.parse(v2.stdout).result.events[0];
    assert.equal(v2Event.providerSessionId, legacyEvent.sessionId);
    assert.equal("sessionId" in v2Event, false);
    assert.equal(v2Event.invocationId, null);
    assert.equal(v2Event.attemptId, null);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the internal stop-review gate is registered as a run-tracked provider invocation", () => {
  const command = COMMAND_DEFINITIONS.find((entry) => entry.id === "_stop-review-gate");
  assert.ok(command);
  assert.equal(command.runTracked, true);
  assert.equal(command.effects.providerInvocation, true);
});

test("health provider probes persist one explicit invocation and attempt identity", () => {
  const fixture = createWorkspace("polycli-gate-b-health-");
  const qwen = createFakeQwen();
  try {
    const result = runCompanion(
      ["health", "--provider", "qwen", "--json-v2", "--run-id", "run_gate_b_health"],
      { cwd: fixture.cwd, stateRoot: fixture.stateRoot, env: qwen.env },
    );
    assert.equal(result.status, 2, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    const events = fs.readFileSync(
      statePathFor(fixture.stateRoot, fixture.cwd, "run-ledger.ndjson"),
      "utf8",
    ).trim().split("\n").map((line) => JSON.parse(line));
    const attemptEvents = events.filter((event) => [
      "attempt_started",
      "attempt_result",
      "provider_decision",
      "health_result",
    ].includes(event.phase));
    assert.equal(attemptEvents.length, 4, JSON.stringify(events, null, 2));
    assert.ok(attemptEvents[0].invocationId);
    assert.ok(attemptEvents[0].attemptId);
    for (const event of attemptEvents) {
      assert.equal(event.invocationId, attemptEvents[0].invocationId);
      assert.equal(event.attemptId, attemptEvents[0].attemptId);
    }
    const terminal = attemptEvents.filter((event) => ["attempt_result", "provider_decision"].includes(event.phase));
    assert.equal(terminal.length, 2);
    assert.equal(terminal[0].providerSessionId, "11111111-1111-4111-8111-111111111111");
    assert.equal(terminal[1].providerSessionId, terminal[0].providerSessionId);
  } finally {
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("repeated foreground provider calls in one run receive distinct attempt identities", () => {
  const fixture = createWorkspace("polycli-gate-b-distinct-attempts-");
  const qwen = createFakeQwen();
  try {
    for (const prompt of ["first", "second"]) {
      const result = runCompanion(
        ["ask", "--provider", "qwen", "--json", "--run-id", "run_distinct_attempts", prompt],
        { cwd: fixture.cwd, stateRoot: fixture.stateRoot, env: qwen.env },
      );
      assert.equal(result.status, 0, result.stderr);
    }

    const ledgerFile = statePathFor(fixture.stateRoot, fixture.cwd, "run-ledger.ndjson");
    const starts = fs.readFileSync(ledgerFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((event) => event.phase === "attempt_started" && event.provider === "qwen");
    assert.equal(starts.length, 2);
    assert.match(starts[0].attemptId, /^att_[a-f0-9]{20}$/);
    assert.match(starts[1].attemptId, /^att_[a-f0-9]{20}$/);
    assert.notEqual(starts[0].attemptId, starts[1].attemptId);
  } finally {
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("health availability exceptions still publish the atomic terminal pair", () => {
  const fixture = createWorkspace("polycli-gate-b-health-availability-failed-");
  const qwen = createFakeQwen();
  const nodeOptions = createCompanionFaultInjector(fixture.root);
  try {
    const result = runCompanion(
      ["health", "--provider", "qwen", "--json-v2", "--run-id", "run_gate_b_health_availability_failed"],
      {
        cwd: fixture.cwd,
        stateRoot: fixture.stateRoot,
        env: {
          ...qwen.env,
          NODE_OPTIONS: nodeOptions,
          POLYCLI_TEST_THROW_QWEN_AVAILABILITY: "1",
        },
      },
    );
    assert.equal(result.status, 2, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);

    const events = fs.readFileSync(
      statePathFor(fixture.stateRoot, fixture.cwd, "run-ledger.ndjson"),
      "utf8",
    ).trim().split("\n").map((line) => JSON.parse(line));
    const started = events.find((event) => event.phase === "attempt_started");
    const terminal = events.filter((event) => ["attempt_result", "provider_decision"].includes(event.phase));
    assert.ok(started);
    assert.equal(terminal.length, 2, JSON.stringify(events, null, 2));
    assert.equal(terminal[0].status, "failed");
    assert.equal(terminal[0].attemptId, started.attemptId);
    assert.equal(terminal[1].attemptId, started.attemptId);
  } finally {
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("health_result compatibility event failure does not invalidate a committed terminal pair", () => {
  const fixture = createWorkspace("polycli-gate-b-health-result-failed-");
  const qwen = createFakeQwen();
  const nodeOptions = createCompanionFaultInjector(fixture.root);
  try {
    const result = runCompanion(
      ["health", "--provider", "qwen", "--json-v2", "--run-id", "run_gate_b_health_result_failed"],
      {
        cwd: fixture.cwd,
        stateRoot: fixture.stateRoot,
        env: {
          ...qwen.env,
          NODE_OPTIONS: nodeOptions,
          POLYCLI_TEST_FAIL_LEDGER_PHASE: "health_result",
        },
      },
    );
    assert.equal(result.status, 2, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);

    const events = fs.readFileSync(
      statePathFor(fixture.stateRoot, fixture.cwd, "run-ledger.ndjson"),
      "utf8",
    ).trim().split("\n").map((line) => JSON.parse(line));
    const terminal = events.filter((event) => ["attempt_result", "provider_decision"].includes(event.phase));
    assert.equal(terminal.length, 2, JSON.stringify(events, null, 2));
    assert.equal(events.some((event) => event.phase === "health_result"), false);
  } finally {
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

for (const jsonMode of ["--json", "--json-v2"]) {
  test(`foreground ${jsonMode} remains a single authoritative envelope when run_summary persistence fails`, () => {
    const fixture = createWorkspace("polycli-gate-b-summary-failed-");
    const qwen = createFakeQwen();
    const nodeOptions = createCompanionFaultInjector(fixture.root);
    try {
      const result = runCompanion(
        ["ask", "--provider", "qwen", jsonMode, "--run-id", `run_gate_b_summary_failed_${jsonMode.slice(2)}`, "hello"],
        {
          cwd: fixture.cwd,
          stateRoot: fixture.stateRoot,
          env: {
            ...qwen.env,
            NODE_OPTIONS: nodeOptions,
            POLYCLI_TEST_FAIL_LEDGER_PHASE: "run_summary",
          },
        },
      );
      assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
      assert.equal(result.stderr, "");
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
    } finally {
      qwen.cleanup();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("foreground provider throws publish an explicit provider_failed terminal event", async () => {
  const fixture = createWorkspace("polycli-gate-b-provider-failed-");
  const timingFile = statePathFor(fixture.stateRoot, fixture.cwd, "timings.ndjson");
  const qwen = createFakeQwen({ breakTimingPath: timingFile });
  try {
    const result = runCompanion(
      ["ask", "--provider", "qwen", "--json-v2", "--run-id", "run_gate_b_provider_failed", "hello"],
      { cwd: fixture.cwd, stateRoot: fixture.stateRoot, env: qwen.env },
    );
    assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "provider_failed");
    assert.doesNotMatch(JSON.stringify(payload), new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(JSON.stringify(payload), /timings\.ndjson/);
    assert.match(payload.error.message, /<path:redacted>/);

    const legacy = runCompanion(
      ["ask", "--provider", "qwen", "--json", "--run-id", "run_gate_b_provider_failed_legacy", "hello"],
      { cwd: fixture.cwd, stateRoot: fixture.stateRoot, env: qwen.env },
    );
    assert.equal(legacy.status, 1, `stdout=${legacy.stdout}\nstderr=${legacy.stderr}`);
    const legacyPayload = JSON.parse(legacy.stdout);
    assert.equal(legacyPayload.code, "error");
    assert.doesNotMatch(JSON.stringify(legacyPayload), new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(legacyPayload.error, /<path:redacted>/);

    const ledger = fs.readFileSync(
      statePathFor(fixture.stateRoot, fixture.cwd, "run-ledger.ndjson"),
      "utf8",
    ).trim().split("\n").map((line) => JSON.parse(line));
    const attemptResult = ledger.find((event) => event.phase === "attempt_result");
    assert.equal(attemptResult.status, "failed");
    assert.equal(attemptResult.errorCode, "provider_failed");
    assert.equal(attemptResult.failureClass, "provider_failed");
  } finally {
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ledger_persist_failed remains authoritative when run_summary persistence also fails", () => {
  const fixture = createWorkspace("polycli-gate-b-ledger-failed-");
  const ledgerFile = statePathFor(fixture.stateRoot, fixture.cwd, "run-ledger.ndjson");
  const qwen = createFakeQwen({ breakLedgerPath: ledgerFile });
  try {
    const result = runCompanion(
      ["ask", "--provider", "qwen", "--json-v2", "--run-id", "run_gate_b_ledger_failed", "hello"],
      { cwd: fixture.cwd, stateRoot: fixture.stateRoot, env: qwen.env },
    );
    assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "ledger_persist_failed");
    assert.match(payload.error.message, /persist terminal ledger events/i);
    assert.equal(fs.statSync(ledgerFile).isDirectory(), true);
  } finally {
    qwen.cleanup();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
