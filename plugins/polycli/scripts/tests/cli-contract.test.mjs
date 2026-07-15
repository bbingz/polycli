import test from "node:test";
import assert from "node:assert/strict";

import {
  PolycliCliError,
  createV2ErrorEnvelope,
  createV2SuccessEnvelope,
  normalizeV2Job,
  serializeV2Result,
} from "../lib/cli-contract.mjs";

const INVOCATION_ID = "inv_0123456789abcdefabcd";

const activeJob = {
  jobId: "review-active123",
  provider: "qwen",
  kind: "review",
  status: "running",
  model: null,
  defaultModel: "qwen-default",
  promptPreview: "review staged changes",
  sessionId: "host-session-legacy",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:01.000Z",
  finishedAt: null,
  logFile: "/bounded/workspace-state/jobs/review-active123.log",
  error: null,
  pid: 4321,
  workerPid: 4321,
  workspaceRoot: "/private/workspace",
  configFile: "/private/job.json",
};

const terminalJob = {
  ...activeJob,
  jobId: "review-terminal123",
  status: "completed",
  sessionId: "provider-session-legacy",
  finishedAt: "2026-07-15T00:00:02.000Z",
};

test("PolycliCliError exposes only bounded catalog fields", () => {
  const error = new PolycliCliError({
    code: "invalid_argument",
    message: `Unknown option ${"x".repeat(800)}`,
    exitCode: 1,
    data: {
      argument: `--${"x".repeat(800)}`,
      suggestions: Array.from({ length: 40 }, (_, index) => `--flag-${index}`),
      stack: "private stack",
      environment: { TOKEN: "secret" },
      configFile: "/private/job.config.json",
      workerPid: 1234,
      workerCommandLine: "node _job-worker /private/job.config.json",
    },
    nextSteps: Array.from({ length: 20 }, (_, index) => `Step ${index} ${"y".repeat(500)}`),
  });

  assert.equal(error.code, "invalid_argument");
  assert.equal(error.exitCode, 1);
  assert.ok(error.message.length <= 500);
  assert.ok(error.data.argument.length <= 512);
  assert.equal(error.data.suggestions.length, 20);
  assert.equal(error.data.stack, undefined);
  assert.equal(error.data.environment, undefined);
  assert.equal(error.data.configFile, undefined);
  assert.equal(error.data.workerPid, undefined);
  assert.equal(error.data.workerCommandLine, undefined);
  assert.equal(error.nextSteps.length, 8);
  assert.ok(error.nextSteps.every((step) => step.length <= 300));
  assert.deepEqual(Object.keys(error), ["code", "exitCode", "data", "nextSteps"]);
  assert.deepEqual(error.toJSON(), {
    code: "invalid_argument",
    message: error.message,
    exitCode: 1,
    data: error.data,
    nextSteps: error.nextSteps,
  });
});

test("PolycliCliError wraps unknown throws without exposing their message or stack", () => {
  const original = new Error("TOKEN=top-secret /Users/private/config.json");
  original.stack = "PRIVATE STACK";
  const wrapped = PolycliCliError.from(original);

  assert.equal(wrapped.code, "internal_error");
  assert.equal(wrapped.exitCode, 1);
  assert.equal(wrapped.message, "An internal Polycli error occurred.");
  assert.deepEqual(wrapped.data, {});
  assert.deepEqual(wrapped.nextSteps, []);
  assert.doesNotMatch(JSON.stringify(wrapped), /top-secret|PRIVATE STACK|Users\/private/);
});

test("PolycliCliError sanitizes typed message, data strings, and next steps", () => {
  const error = new PolycliCliError({
    code: "provider_failed",
    message: "spawn /Users/private/bin/qwen failed with TOKEN=top-secret",
    data: {
      detail: "path:/Users/private/a failure [/Users/private/b] failure {/Users/private/c} C:\\Users\\private\\qwen.json and API_KEY=private-key",
      nested: {
        token: "top-secret-token",
        apiKey: "private-api-key",
        password: "private-password-value",
        credential: "private-credential",
      },
    },
    nextSteps: ["Inspect /Users/private/config.json with PASSWORD=private-password"],
  });
  const serialized = JSON.stringify(createV2ErrorEnvelope(error, {
    invocationId: INVOCATION_ID,
    command: ["ask"],
    hostSurface: "terminal",
  }));

  assert.doesNotMatch(serialized, /Users.private|top-secret|private-key|private-password|private-credential/);
  assert.match(serialized, /<path:redacted>/);
  assert.match(serialized, /<secret:redacted>/);
});

test("normalizeV2Job separates legacy session identity by lifecycle and strips runtime identity", () => {
  assert.deepEqual(normalizeV2Job(activeJob), {
    jobId: "review-active123",
    provider: "qwen",
    kind: "review",
    status: "running",
    model: null,
    defaultModel: "qwen-default",
    promptPreview: "review staged changes",
    hostSessionId: "host-session-legacy",
    providerSessionId: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:01.000Z",
    finishedAt: null,
    logFile: "/bounded/workspace-state/jobs/review-active123.log",
    error: null,
  });

  const normalizedTerminal = normalizeV2Job(terminalJob);
  assert.equal(normalizedTerminal.hostSessionId, null);
  assert.equal(normalizedTerminal.providerSessionId, "provider-session-legacy");
  assert.equal("sessionId" in normalizedTerminal, false);
  assert.equal("pid" in normalizedTerminal, false);
  assert.equal("workerPid" in normalizedTerminal, false);
  assert.equal("workspaceRoot" in normalizedTerminal, false);
  assert.equal("configFile" in normalizedTerminal, false);

  const explicit = normalizeV2Job({
    ...terminalJob,
    hostSessionId: "host-explicit",
    providerSessionId: "provider-explicit",
  });
  assert.equal(explicit.hostSessionId, "host-explicit");
  assert.equal(explicit.providerSessionId, "provider-explicit");
});

test("serializeV2Result covers provider setup, health, execution, and background jobs", () => {
  assert.deepEqual(serializeV2Result("setup", [{ provider: "qwen" }]), {
    type: "provider.setup",
    providers: [{ provider: "qwen" }],
  });

  assert.deepEqual(serializeV2Result("health", {
    ok: false,
    results: [{ provider: "qwen", ok: false }],
    healthyProviders: [],
    unhealthyProviders: ["qwen"],
    allHealthy: false,
    anyHealthy: false,
  }), {
    type: "provider.health",
    results: [{ provider: "qwen", ok: false }],
    healthyProviders: [],
    unhealthyProviders: ["qwen"],
    allHealthy: false,
    anyHealthy: false,
  });

  const executionPayload = {
    provider: "qwen",
    kind: "ask",
    model: "qwen3",
    prompt: "full prompt must never enter JSON v2",
    promptPreview: "hello",
    meta: { internal: true },
    ok: false,
    response: "normal provider failure",
    sessionId: "provider-session",
    pid: 9876,
    configPath: "/private/config",
    accessToken: "provider-access-token",
    nested: { clientSecret: "provider-client-secret" },
  };
  const execution = serializeV2Result("ask", executionPayload);
  assert.deepEqual(execution.execution, {
    provider: "qwen",
    kind: "ask",
    model: "qwen3",
    promptPreview: "hello",
  });
  assert.equal(execution.type, "provider.execution");
  assert.equal(execution.providerResult.ok, false);
  assert.equal(execution.providerResult.providerSessionId, "provider-session");
  assert.equal("sessionId" in execution.providerResult, false);
  assert.equal("pid" in execution.providerResult, false);
  assert.equal("configPath" in execution.providerResult, false);
  assert.equal("prompt" in execution.providerResult, false);
  assert.equal("meta" in execution.providerResult, false);
  assert.equal("accessToken" in execution.providerResult, false);
  assert.equal("clientSecret" in (execution.providerResult.nested || {}), false);
  assert.equal(executionPayload.sessionId, "provider-session", "serialization must not mutate legacy output");
  assert.equal(executionPayload.pid, 9876, "serialization must not mutate legacy output");

  const started = serializeV2Result("review", { ok: true, job: activeJob }, { background: true });
  assert.equal(started.type, "job.started");
  assert.equal(started.job.jobId, activeJob.jobId);
  assert.equal(started.job.hostSessionId, "host-session-legacy");
  assert.equal("pid" in started.job, false);
});

test("a normal provider result with inner ok false remains a successful v2 envelope", () => {
  const result = serializeV2Result("rescue", {
    provider: "qwen",
    kind: "rescue",
    model: null,
    promptPreview: "diagnose",
    ok: false,
    error: "provider returned a normal compact failure",
  });
  const envelope = createV2SuccessEnvelope(result, {
    invocationId: INVOCATION_ID,
    command: ["rescue"],
    hostSurface: "terminal",
  });

  assert.equal(envelope.ok, true);
  assert.equal(envelope.result.providerResult.ok, false);
  assert.equal("error" in envelope, false);
});

test("JSON v2 sanitizes absolute paths embedded in provider and ledger error strings", () => {
  const privatePath = "/tmp/private-config/secret-qwen-bin";
  const provider = serializeV2Result("ask", {
    provider: "qwen",
    kind: "ask",
    ok: false,
    error: `spawn ${privatePath} ENOENT`,
  });
  const tail = serializeV2Result("debug.tail", {
    runId: "run-private",
    events: [{ phase: "attempt_result", error: { message: `spawn ${privatePath} ENOENT` } }],
  });

  assert.doesNotMatch(JSON.stringify(provider), /private-config|secret-qwen-bin/);
  assert.match(provider.providerResult.error, /<path:redacted>/);
  assert.doesNotMatch(JSON.stringify(tail), /private-config|secret-qwen-bin/);
  assert.match(tail.events[0].error.message, /<path:redacted>/);
});

test("serializeV2Result covers job status list, typed status wait, result, and cancel", () => {
  const statusList = serializeV2Result("status", {
    totalJobs: 2,
    running: [activeJob],
    recent: [terminalJob],
  });
  assert.equal(statusList.type, "job.status-list");
  assert.equal(statusList.totalJobs, 2);
  assert.equal(statusList.running[0].hostSessionId, "host-session-legacy");
  assert.equal(statusList.recent[0].providerSessionId, "provider-session-legacy");
  assert.equal(statusList.wait, null);

  const timedOutStatusList = serializeV2Result("status", {
    totalJobs: 1,
    running: [activeJob],
    recent: [],
    waitTimedOut: true,
  });
  assert.deepEqual(timedOutStatusList.wait, {
    for: "terminal",
    satisfied: false,
    timedOut: true,
    terminalMismatch: false,
  });

  const status = serializeV2Result("status", {
    job: terminalJob,
    waitTimedOut: false,
  }, {
    wait: {
      for: "completed",
      satisfied: true,
      timedOut: false,
      terminalMismatch: false,
    },
  });
  assert.deepEqual(status.wait, {
    for: "completed",
    satisfied: true,
    timedOut: false,
    terminalMismatch: false,
  });
  assert.equal(status.type, "job.status");

  const jobResult = serializeV2Result("result", {
    job: terminalJob,
    provider: "qwen",
    kind: "review",
    ok: true,
    response: "approved",
    sessionId: "provider-session-result",
    pid: 9876,
  });
  assert.equal(jobResult.type, "job.result");
  assert.equal(jobResult.job.providerSessionId, "provider-session-legacy");
  assert.equal(jobResult.providerResult.providerSessionId, "provider-session-result");
  assert.equal("pid" in jobResult.providerResult, false);

  assert.deepEqual(serializeV2Result("cancel", {
    jobId: "review-active123",
    cancelled: false,
    reason: "not_cancellable",
    pid: 4321,
    error: "already completed",
  }), {
    type: "job.cancel",
    jobId: "review-active123",
    cancelled: false,
    reason: "not_cancellable",
  });
});

test("serializeV2Result covers timing, ledger, explanation, and session results", () => {
  assert.deepEqual(serializeV2Result("timing", {
    records: [{ provider: "qwen" }],
    aggregate: { cohorts: [] },
    metadata: { historyLimit: 20 },
  }), {
    type: "timing.report",
    records: [{ provider: "qwen" }],
    aggregate: { cohorts: [] },
    metadata: { historyLimit: 20 },
  });

  assert.deepEqual(serializeV2Result("debug.runs", { ok: true, runs: [{ runId: "run_a" }] }), {
    type: "ledger.run-list",
    runs: [{ runId: "run_a" }],
  });

  const runEvents = serializeV2Result("debug.show", {
    ok: true,
    runId: "run_a",
    events: [{ eventId: "evt_1", sessionId: "provider-session", pid: 4321 }],
  });
  assert.deepEqual(runEvents, {
    type: "ledger.run-events",
    runId: "run_a",
    events: [{ eventId: "evt_1", providerSessionId: "provider-session" }],
  });

  assert.deepEqual(serializeV2Result("debug.explain", {
    ok: true,
    runId: "run_a",
    verdict: "failed",
    text: "A provider failed.",
  }), {
    type: "ledger.explanation",
    runId: "run_a",
    verdict: "failed",
    text: "A provider failed.",
  });

  const sessionList = serializeV2Result("sessions.list", {
    ok: true,
    recorded: [{ provider: "qwen", sessionId: "session-a", sessionArtifactPath: "/safe/a" }],
    nonPurgeable: [{ provider: "cmd", sessionId: "session-b", reason: "no_path" }],
  });
  assert.deepEqual(sessionList, {
    type: "session.list",
    recorded: [{ provider: "qwen", providerSessionId: "session-a", sessionArtifactPath: "/safe/a" }],
    nonPurgeable: [{ provider: "cmd", providerSessionId: "session-b", reason: "no_path" }],
  });

  const sessionPurge = serializeV2Result("sessions.purge", {
    ok: true,
    confirmed: true,
    plan: { deletable: [{ provider: "qwen", sessionId: "session-a", path: "/safe/a" }], skipped: [] },
    nonPurgeable: [],
    summary: { confirmed: true, deleted: 1 },
  });
  assert.equal(sessionPurge.type, "session.purge");
  assert.equal(sessionPurge.plan.deletable[0].providerSessionId, "session-a");
  assert.equal("sessionId" in sessionPurge.plan.deletable[0], false);
});

test("serializeV2Result keeps a reserved pure mapping for ledger tail", () => {
  const result = serializeV2Result("debug.tail", {
    runId: "run_a",
    events: [{ eventId: "evt_2" }],
    cursor: { requested: "evt_1", oldest: "evt_1", latest: "evt_2", next: "evt_2" },
    limited: false,
    cursorExpired: false,
    waitTimedOut: false,
  });
  assert.equal(result.type, "ledger.tail");
  assert.equal(result.cursor.next, "evt_2");
});

test("v2 success and error envelopes are mutually exclusive and keep safe metadata only", () => {
  const success = createV2SuccessEnvelope({ type: "timing.report", records: [] }, {
    invocationId: INVOCATION_ID,
    command: "timing",
    hostSurface: "terminal",
    workspaceSlug: "polycli-abc123",
    runId: null,
    jobId: "review-abc123",
    pid: 4321,
    providerSessionId: "must-not-be-meta",
    environment: { TOKEN: "secret" },
  });
  assert.deepEqual(success, {
    schemaVersion: 2,
    id: INVOCATION_ID,
    ok: true,
    result: { type: "timing.report", records: [] },
    _meta: {
      command: ["timing"],
      hostSurface: "terminal",
      workspaceSlug: "polycli-abc123",
      runId: null,
      jobId: "review-abc123",
    },
  });
  assert.equal("error" in success, false);

  const error = createV2ErrorEnvelope(new PolycliCliError({
    code: "job_not_found",
    message: "Job 'review-nope' not found.",
    data: { jobId: "review-nope" },
    nextSteps: ["Run `polycli status --json-v2`."],
  }), {
    invocationId: INVOCATION_ID,
    command: ["result"],
    hostSurface: "terminal",
  });
  assert.equal(error.ok, false);
  assert.equal("result" in error, false);
  assert.deepEqual(error.error, {
    code: "job_not_found",
    message: "Job 'review-nope' not found.",
    data: { jobId: "review-nope" },
    nextSteps: ["Run `polycli status --json-v2`."],
  });
  assert.deepEqual(error._meta, {
    command: ["result"],
    hostSurface: "terminal",
    workspaceSlug: null,
    runId: null,
    jobId: null,
  });
});

test("the envelope rejects a missing or non-invocation id instead of fabricating one", () => {
  assert.throws(
    () => createV2SuccessEnvelope({ type: "timing.report" }, { invocationId: "4321", command: ["timing"] }),
    (error) => error instanceof PolycliCliError && error.code === "invalid_argument",
  );
});

test("serializeV2Result rejects unknown command identifiers with a typed error", () => {
  assert.throws(
    () => serializeV2Result("unknown.command", {}),
    (error) => error instanceof PolycliCliError && error.code === "unknown_command",
  );
});
