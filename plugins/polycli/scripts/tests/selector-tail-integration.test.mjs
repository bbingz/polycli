import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  getJob,
  resolveWorkspaceRoot,
  upsertJob,
  writeJobConfigFile,
  writeJobFile,
} from "../lib/state.mjs";
import { appendRunLedgerEvent } from "../lib/run-ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const companion = path.resolve(here, "..", "polycli-companion.mjs");

function run(args, { cwd, stateRoot }) {
  return spawnSync(process.execPath, [companion, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      POLYCLI_STATE_ROOT: stateRoot,
      POLYCLI_HOST_SURFACE: "terminal",
    },
    encoding: "utf8",
  });
}

function parseJson(result) {
  assert.equal(result.stderr, "", result.stderr);
  return JSON.parse(result.stdout);
}

async function withWorkspace(callback) {
  // macOS exposes the temporary directory through both /var and /private/var.
  // Canonicalize it so parent-process fixture writers and the child companion
  // compute the same workspace slug.
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-selector-tail-")));
  const stateRoot = path.join(cwd, ".state-root");
  const previousStateRoot = process.env.POLYCLI_STATE_ROOT;
  process.env.POLYCLI_STATE_ROOT = stateRoot;
  try {
    await callback({ cwd, stateRoot, workspaceRoot: resolveWorkspaceRoot(cwd) });
  } finally {
    if (previousStateRoot == null) delete process.env.POLYCLI_STATE_ROOT;
    else process.env.POLYCLI_STATE_ROOT = previousStateRoot;
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function addJob(workspaceRoot, {
  jobId,
  status,
  updatedAt,
  response = `${jobId}-response`,
}) {
  const job = upsertJob(workspaceRoot, {
    jobId,
    provider: "qwen",
    kind: "ask",
    status,
    createdAt: updatedAt,
    updatedAt,
    finishedAt: ["completed", "failed", "cancelled"].includes(status) ? updatedAt : null,
    pid: null,
  });
  if (["completed", "failed", "cancelled"].includes(status)) {
    writeJobFile(workspaceRoot, jobId, {
      job,
      result: {
        ok: status === "completed",
        provider: "qwen",
        kind: "ask",
        response,
      },
    });
  }
  return job;
}

test("source companion resolves typed and compatible job selectors within the current workspace", async () => {
  await withWorkspace(async (context) => {
    addJob(context.workspaceRoot, {
      jobId: "job-terminal-old",
      status: "completed",
      updatedAt: "2026-07-15T00:00:01.000Z",
    });
    addJob(context.workspaceRoot, {
      jobId: "job-active-old",
      status: "queued",
      updatedAt: "2026-07-15T00:00:02.000Z",
    });
    addJob(context.workspaceRoot, {
      jobId: "job-terminal-new",
      status: "completed",
      updatedAt: "2026-07-15T00:00:03.000Z",
    });
    addJob(context.workspaceRoot, {
      jobId: "job-active-new",
      status: "queued",
      updatedAt: "2026-07-15T00:00:04.000Z",
    });

    const cases = [
      [["status", "--job", "id:job-terminal-old", "--json"], "job-terminal-old"],
      [["status", "--job", "prefix:job-active-o", "--json"], "job-active-old"],
      [["status", "--job", "latest", "--json"], "job-active-new"],
      [["status", "--job", "latest-active", "--json"], "job-active-new"],
      [["status", "--job", "latest-terminal", "--json"], "job-terminal-new"],
      [["status", "job-terminal-n", "--json"], "job-terminal-new"],
    ];
    for (const [args, expectedJobId] of cases) {
      const result = run(args, context);
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.equal(parseJson(result).job.jobId, expectedJobId, args.join(" "));
    }

    const defaultResult = run(["result", "--json-v2"], context);
    assert.equal(defaultResult.status, 0, defaultResult.stderr);
    const envelope = parseJson(defaultResult);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.type, "job.result");
    assert.equal(envelope.result.job.jobId, "job-terminal-new");
  });
});

test("--job requires explicit selector grammar while positional selectors retain compatibility", async () => {
  await withWorkspace(async (context) => {
    addJob(context.workspaceRoot, {
      jobId: "job-terminal-exact",
      status: "completed",
      updatedAt: "2026-07-15T00:00:01.000Z",
    });
    addJob(context.workspaceRoot, {
      jobId: "job-active-exact",
      status: "queued",
      updatedAt: "2026-07-15T00:00:02.000Z",
    });

    const explicitCases = [
      ["status", "--job", "job-terminal-exact", "--json-v2"],
      ["result", "--job", "job-terminal", "--json-v2"],
      ["cancel", "--job", "job-active-exact", "--json-v2"],
    ];
    for (const args of explicitCases) {
      const result = run(args, context);
      assert.equal(result.status, 1, args.join(" "));
      const envelope = parseJson(result);
      assert.equal(envelope.ok, false, args.join(" "));
      assert.equal(envelope.error.code, "invalid_argument", args.join(" "));
    }

    assert.equal(getJob(context.workspaceRoot, "job-active-exact").status, "queued");

    const positionalExact = run(["status", "job-terminal-exact", "--json"], context);
    assert.equal(positionalExact.status, 0, positionalExact.stderr);
    assert.equal(parseJson(positionalExact).job.jobId, "job-terminal-exact");

    const positionalPrefix = run(["result", "job-terminal", "--json"], context);
    assert.equal(positionalPrefix.status, 0, positionalPrefix.stderr);
    assert.equal(parseJson(positionalPrefix).job.jobId, "job-terminal-exact");
  });
});

test("ambiguous prefixes return a typed bounded candidate list", async () => {
  await withWorkspace(async (context) => {
    for (let index = 0; index < 12; index += 1) {
      addJob(context.workspaceRoot, {
        jobId: `job-shared-${String(index).padStart(2, "0")}`,
        status: "completed",
        updatedAt: `2026-07-15T00:00:${String(index).padStart(2, "0")}.000Z`,
      });
    }

    const result = run(["status", "--job", "prefix:job-shared-", "--json-v2"], context);
    assert.equal(result.status, 1);
    const envelope = parseJson(result);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "ambiguous_selector");
    assert.equal(envelope.error.data.selector, "prefix:job-shared-");
    assert.equal(envelope.error.data.candidateIds.length, 8);
    assert.ok(envelope.error.data.candidateIds.every((jobId) => jobId.startsWith("job-shared-")));
  });
});

test("selector conflicts fail before creating workspace state", async () => {
  await withWorkspace(async (context) => {
    const cases = [
      ["status", "job-one", "--job", "id:job-two", "--json-v2"],
      ["status", "--all", "--job", "latest", "--json-v2"],
      ["result", "job-one", "--job", "latest-terminal", "--json-v2"],
    ];
    for (const args of cases) {
      const result = run(args, context);
      assert.equal(result.status, 1, args.join(" "));
      const envelope = parseJson(result);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, "invalid_argument");
      assert.equal(fs.existsSync(context.stateRoot), false, args.join(" "));
    }
  });
});

test("typed waits distinguish terminal mismatch from timeout", async () => {
  await withWorkspace(async (context) => {
    addJob(context.workspaceRoot, {
      jobId: "job-completed",
      status: "completed",
      updatedAt: "2026-07-15T00:00:01.000Z",
    });
    addJob(context.workspaceRoot, {
      jobId: "job-queued",
      status: "queued",
      updatedAt: "2026-07-15T00:00:02.000Z",
    });

    const mismatch = run([
      "status", "--job", "id:job-completed", "--wait", "--for", "failed", "--timeout-ms", "1000", "--json-v2",
    ], context);
    assert.equal(mismatch.status, 0, mismatch.stderr);
    const mismatchEnvelope = parseJson(mismatch);
    assert.deepEqual(mismatchEnvelope.result.wait, {
      for: "failed",
      satisfied: false,
      timedOut: false,
      terminalMismatch: true,
    });

    const timeout = run([
      "status", "--job", "id:job-queued", "--wait", "--for", "completed", "--timeout-ms", "1", "--json-v2",
    ], context);
    assert.equal(timeout.status, 2, timeout.stderr);
    const timeoutEnvelope = parseJson(timeout);
    assert.equal(timeoutEnvelope.ok, true);
    assert.equal(timeoutEnvelope.result.type, "job.status");
    assert.deepEqual(timeoutEnvelope.result.wait, {
      for: "completed",
      satisfied: false,
      timedOut: true,
      terminalMismatch: false,
    });
    assert.equal(timeoutEnvelope.result.job.status, "queued");
  });
});

test("JSON v2 cancellation preserves authoritative exit 4 and exit 5 semantics", async () => {
  await withWorkspace(async (context) => {
    addJob(context.workspaceRoot, {
      jobId: "job-already-terminal",
      status: "completed",
      updatedAt: "2026-07-15T00:00:01.000Z",
    });
    const terminal = run([
      "cancel", "--job", "id:job-already-terminal", "--json-v2",
    ], context);
    assert.equal(terminal.status, 4, terminal.stderr);
    const terminalEnvelope = parseJson(terminal);
    assert.equal(terminalEnvelope.ok, true);
    assert.equal(terminalEnvelope.result.type, "job.cancel");
    assert.equal(terminalEnvelope.result.cancelled, false);
    assert.equal(terminalEnvelope.result.reason, "not_cancellable");
    assert.equal(terminalEnvelope._meta.jobId, "job-already-terminal");

    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      upsertJob(context.workspaceRoot, {
        jobId: "job-unverified-worker",
        provider: "qwen",
        kind: "ask",
        status: "running",
        pid: unrelated.pid,
        createdAt: "2026-07-15T00:00:02.000Z",
        updatedAt: "2026-07-15T00:00:02.000Z",
      });
      writeJobConfigFile(context.workspaceRoot, "job-unverified-worker", {
        workspaceRoot: context.workspaceRoot,
        jobId: "job-unverified-worker",
        execution: { provider: "qwen", kind: "ask" },
      });

      const unsafe = run([
        "cancel", "--job", "id:job-unverified-worker", "--json-v2",
      ], context);
      assert.equal(unsafe.status, 5, unsafe.stderr);
      const unsafeEnvelope = parseJson(unsafe);
      assert.equal(unsafeEnvelope.ok, false);
      assert.equal(unsafeEnvelope.error.code, "worker_identity_unverified");
      assert.equal(unsafeEnvelope.error.data.jobId, "job-unverified-worker");
      assert.equal(unsafeEnvelope._meta.jobId, "job-unverified-worker");
      assert.equal(unrelated.exitCode, null, "an unverified process must remain untouched");
    } finally {
      unrelated.kill("SIGKILL");
    }
  });
});

test("all-job JSON v2 waits preserve authoritative timeout evidence", async () => {
  await withWorkspace(async (context) => {
    addJob(context.workspaceRoot, {
      jobId: "job-all-wait-queued",
      status: "queued",
      updatedAt: "2026-07-15T00:00:01.000Z",
    });

    const result = run([
      "status", "--all", "--wait", "--timeout-ms", "1", "--json-v2",
    ], context);
    assert.equal(result.status, 2, result.stderr);
    const envelope = parseJson(result);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.type, "job.status-list");
    assert.deepEqual(envelope.result.wait, {
      for: "terminal",
      satisfied: false,
      timedOut: true,
      terminalMismatch: false,
    });
    assert.equal(envelope.result.running.some((job) => job.jobId === "job-all-wait-queued"), true);
  });
});

test("debug tail without a cursor pins the latest run and preserves legacy/v2 result boundaries", async () => {
  await withWorkspace(async (context) => {
    await appendRunLedgerEvent(context.workspaceRoot, { runId: "run-old", phase: "run_started" });
    const latest = [];
    for (const phase of ["run_started", "attempt_started", "attempt_result"]) {
      latest.push(await appendRunLedgerEvent(context.workspaceRoot, { runId: "run-latest", phase }));
    }

    const legacy = run(["debug", "tail", "--limit", "2", "--json"], context);
    assert.equal(legacy.status, 0, legacy.stderr);
    const legacyPayload = parseJson(legacy);
    assert.equal(legacyPayload.schemaVersion, undefined);
    assert.equal(legacyPayload.type, "ledger.tail");
    assert.equal(legacyPayload.runId, "run-latest");
    assert.deepEqual(legacyPayload.events.map((event) => event.eventId), latest.slice(1).map((event) => event.eventId));

    const v2 = run(["debug", "tail", "--limit", "2", "--json-v2"], context);
    assert.equal(v2.status, 0, v2.stderr);
    const envelope = parseJson(v2);
    assert.equal(envelope.schemaVersion, 2);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.type, "ledger.tail");
    assert.equal(envelope.result.runId, "run-latest");
    assert.deepEqual(envelope.result.events.map((event) => event.eventId), latest.slice(1).map((event) => event.eventId));
  });
});

test("debug tail follows a valid opaque cursor and reports cursor expiration anchors", async () => {
  await withWorkspace(async (context) => {
    const anchor = await appendRunLedgerEvent(context.workspaceRoot, { runId: "run-follow", phase: "run_started" });
    const first = await appendRunLedgerEvent(context.workspaceRoot, { runId: "run-follow", phase: "attempt_started" });
    const second = await appendRunLedgerEvent(context.workspaceRoot, { runId: "run-follow", phase: "attempt_result" });

    const followed = run(["debug", "tail", "--after", anchor.eventId, "--limit", "1", "--json-v2"], context);
    assert.equal(followed.status, 0, followed.stderr);
    const followedEnvelope = parseJson(followed);
    assert.deepEqual(followedEnvelope.result.events.map((event) => event.eventId), [first.eventId]);
    assert.equal(followedEnvelope.result.cursor.requested, anchor.eventId);
    assert.equal(followedEnvelope.result.cursor.next, first.eventId);
    assert.equal(followedEnvelope.result.cursor.latest, second.eventId);
    assert.equal(followedEnvelope.result.limited, true);

    const expired = run([
      "debug", "tail", "run-follow", "--after", "evt_not_retained", "--json-v2",
    ], context);
    assert.equal(expired.status, 1);
    const expiredEnvelope = parseJson(expired);
    assert.equal(expiredEnvelope.ok, false);
    assert.equal(expiredEnvelope.error.code, "cursor_expired");
    assert.deepEqual(expiredEnvelope.error.data, {
      reason: "not_retained",
      runId: "run-follow",
      requested: "evt_not_retained",
      oldest: anchor.eventId,
      latest: second.eventId,
    });
  });
});

test("debug tail wait timeout is an authoritative successful v2 result with exit 2", async () => {
  await withWorkspace(async (context) => {
    const anchor = await appendRunLedgerEvent(context.workspaceRoot, { runId: "run-timeout", phase: "run_started" });

    const result = run([
      "debug", "tail", "run-timeout", "--after", anchor.eventId,
      "--wait", "--timeout-ms", "1", "--json-v2",
    ], context);
    assert.equal(result.status, 2, result.stderr);
    const envelope = parseJson(result);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.type, "ledger.tail");
    assert.deepEqual(envelope.result.events, []);
    assert.equal(envelope.result.waitTimedOut, true);
    assert.deepEqual(envelope.result.cursor, {
      requested: anchor.eventId,
      oldest: anchor.eventId,
      latest: anchor.eventId,
      next: anchor.eventId,
    });
  });
});
