const ERROR_CODES = new Set([
  "invalid_argument",
  "unknown_command",
  "unknown_subcommand",
  "missing_provider",
  "unknown_provider",
  "missing_prompt",
  "invalid_scope",
  "job_not_found",
  "ambiguous_selector",
  "no_active_job",
  "no_completed_job",
  "cursor_expired",
  "provider_failed",
  "ledger_persist_failed",
  "worker_identity_unverified",
  "cancel_failed",
  "internal_error",
]);

const ERROR_EXIT_CODES = Object.freeze({
  worker_identity_unverified: 5,
  cancel_failed: 5,
});

const INTERNAL_ERROR_MESSAGE = "An internal Polycli error occurred.";
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_ERROR_DATA_STRING_LENGTH = 512;
const MAX_ERROR_DATA_ARRAY_LENGTH = 20;
const MAX_ERROR_DATA_KEYS = 30;
const MAX_ERROR_DATA_DEPTH = 4;
const MAX_ERROR_DATA_NODES = 200;
const MAX_NEXT_STEPS = 8;
const MAX_NEXT_STEP_LENGTH = 300;

const PRIVATE_ERROR_DATA_KEYS = new Set([
  "__proto__",
  "cause",
  "configfile",
  "configpath",
  "constructor",
  "env",
  "environment",
  "pid",
  "stack",
  "prototype",
  "runtimeoptions",
  "workerargv",
  "workercommand",
  "workercommandline",
  "workerpid",
  "workspaceroot",
]);

const PRIVATE_RESULT_KEYS = new Set([
  "argv",
  "configfile",
  "configpath",
  "environment",
  "env",
  "pid",
  "prompt",
  "runtimeoptions",
  "stopreviewgateworkspace",
  "stderr",
  "stdout",
  "workerargv",
  "workercommand",
  "workercommandline",
  "workerpid",
  "workspaceroot",
  "userprompt",
]);

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const PROVIDER_COMMANDS = new Set([
  "ask",
  "rescue",
  "review",
  "adversarial-review",
  "_stop-review-gate",
]);

function truncate(value, maximum) {
  return String(value ?? "").slice(0, maximum);
}

export function sanitizePublicErrorMessage(value, maximum = MAX_ERROR_MESSAGE_LENGTH) {
  return truncate(value, maximum)
    .replace(/\b[A-Za-z]:[\\/][^\s"'`<>]+/g, "<path:redacted>")
    .replace(/(^|[\s("'`=:[{,;])\/(?!\/)[^\s"'`<>\]}]+/g, "$1<path:redacted>")
    .replace(/\b(TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_KEY|CREDENTIAL)=[^\s]+/gi, "$1=<secret:redacted>");
}

function isSecretKey(key) {
  return /(?:token|secret|password|credential|credentials|api_?key|access_?key|private_?key)$/i.test(String(key));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sanitizeErrorData(value, depth = 0, state = {
  seen: new WeakSet(),
  remaining: MAX_ERROR_DATA_NODES,
}) {
  if (state.remaining <= 0) return undefined;
  state.remaining -= 1;
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizePublicErrorMessage(value, MAX_ERROR_DATA_STRING_LENGTH);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return truncate(value, MAX_ERROR_DATA_STRING_LENGTH);
  if (typeof value !== "object" || depth >= MAX_ERROR_DATA_DEPTH) return undefined;
  if (state.seen.has(value)) return undefined;

  state.seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_ERROR_DATA_ARRAY_LENGTH)
      .map((entry) => sanitizeErrorData(entry, depth + 1, state))
      .filter((entry) => entry !== undefined);
    state.seen.delete(value);
    return result;
  }

  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_ERROR_DATA_KEYS)) {
    if (PRIVATE_ERROR_DATA_KEYS.has(key.toLowerCase()) || isSecretKey(key)) continue;
    const sanitized = sanitizeErrorData(entry, depth + 1, state);
    if (sanitized !== undefined) result[truncate(key, 128)] = sanitized;
  }
  state.seen.delete(value);
  return result;
}

function sanitizeNextSteps(nextSteps) {
  if (!Array.isArray(nextSteps)) return [];
  return nextSteps
    .filter((step) => typeof step === "string" && step.trim() !== "")
    .slice(0, MAX_NEXT_STEPS)
    .map((step) => sanitizePublicErrorMessage(step, MAX_NEXT_STEP_LENGTH));
}

function defaultExitCode(code) {
  return ERROR_EXIT_CODES[code] ?? 1;
}

export class PolycliCliError extends Error {
  constructor({
    code,
    message,
    exitCode,
    data = {},
    nextSteps = [],
  } = {}) {
    const catalogCode = ERROR_CODES.has(code) ? code : "internal_error";
    const publicMessage = catalogCode === "internal_error"
      ? INTERNAL_ERROR_MESSAGE
      : sanitizePublicErrorMessage(message || "Polycli command failed.", MAX_ERROR_MESSAGE_LENGTH);
    super(publicMessage);
    Object.defineProperty(this, "name", { value: "PolycliCliError" });
    this.code = catalogCode;
    this.exitCode = Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255
      ? exitCode
      : defaultExitCode(catalogCode);
    this.data = sanitizeErrorData(catalogCode === "internal_error" ? {} : data) || {};
    this.nextSteps = sanitizeNextSteps(catalogCode === "internal_error" ? [] : nextSteps);
  }

  static from(error) {
    if (error instanceof PolycliCliError) return error;
    if (error && ERROR_CODES.has(error.code)) {
      return new PolycliCliError({
        code: error.code,
        message: error.message,
        exitCode: error.exitCode,
        data: error.data,
        nextSteps: error.nextSteps,
      });
    }
    return new PolycliCliError({ code: "internal_error" });
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      exitCode: this.exitCode,
      data: this.data,
      nextSteps: this.nextSteps,
    };
  }
}

function nullableIdentity(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

export function normalizeV2Job(job = {}) {
  const source = job && typeof job === "object" && !Array.isArray(job) ? job : {};
  const hasExplicitHost = hasOwn(source, "hostSessionId");
  const hasExplicitProvider = hasOwn(source, "providerSessionId");
  const legacyOnly = !hasExplicitHost && !hasExplicitProvider;
  const legacySessionId = nullableIdentity(source.sessionId);
  const hostSessionId = hasExplicitHost
    ? nullableIdentity(source.hostSessionId)
    : (legacyOnly && ACTIVE_JOB_STATUSES.has(source.status) ? legacySessionId : null);
  const providerSessionId = hasExplicitProvider
    ? nullableIdentity(source.providerSessionId)
    : (legacyOnly && TERMINAL_JOB_STATUSES.has(source.status) ? legacySessionId : null);

  return {
    jobId: nullableIdentity(source.jobId),
    provider: nullableIdentity(source.provider),
    kind: nullableIdentity(source.kind),
    status: nullableIdentity(source.status),
    model: nullableIdentity(source.model),
    defaultModel: nullableIdentity(source.defaultModel),
    promptPreview: source.promptPreview == null ? null : String(source.promptPreview),
    hostSessionId,
    providerSessionId,
    createdAt: nullableIdentity(source.createdAt),
    updatedAt: nullableIdentity(source.updatedAt),
    finishedAt: nullableIdentity(source.finishedAt),
    logFile: nullableIdentity(source.logFile),
    error: clonePublicResult(source.error, new WeakSet(), "error") ?? null,
  };
}

function clonePublicResult(value, seen = new WeakSet(), keyHint = "") {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return /(error|message|detail|warning|reason)/i.test(keyHint)
      ? sanitizePublicErrorMessage(value, MAX_ERROR_DATA_STRING_LENGTH)
      : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return null;

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .map((entry) => clonePublicResult(entry, seen, keyHint))
      .filter((entry) => entry !== undefined);
    seen.delete(value);
    return result;
  }

  const result = {};
  const explicitProviderSessionId = hasOwn(value, "providerSessionId");
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (PRIVATE_RESULT_KEYS.has(normalizedKey) || isSecretKey(key)) continue;
    if (key === "sessionId") {
      if (!explicitProviderSessionId) {
        result.providerSessionId = nullableIdentity(entry);
      }
      continue;
    }
    const cloned = clonePublicResult(entry, seen, key);
    if (cloned !== undefined) result[key] = cloned;
  }
  seen.delete(value);
  return result;
}

function normalizeProviderResult(result) {
  return clonePublicResult(result && typeof result === "object" ? result : {}) || {};
}

function normalizeCommandId(commandId) {
  if (Array.isArray(commandId)) {
    return commandId.map((part) => String(part).trim()).filter(Boolean).join(".");
  }
  return String(commandId ?? "")
    .trim()
    .replace(/[\s.]+/g, ".");
}

function extractProviderExecution(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const executionSource = source.execution && typeof source.execution === "object"
    ? source.execution
    : source;
  const resultSource = source.providerResult && typeof source.providerResult === "object"
    ? { ...source.providerResult }
    : { ...source };

  for (const key of [
    "execution",
    "providerResult",
    "provider",
    "kind",
    "model",
    "promptPreview",
    "prompt",
    "userPrompt",
    "meta",
    "job",
  ]) {
    delete resultSource[key];
  }

  const providerResult = normalizeProviderResult(resultSource);
  if (typeof providerResult.ok !== "boolean") {
    throw new PolycliCliError({
      code: "internal_error",
      message: "Provider result is missing its boolean ok field.",
    });
  }

  return {
    type: "provider.execution",
    execution: {
      provider: nullableIdentity(executionSource.provider),
      kind: nullableIdentity(executionSource.kind),
      model: nullableIdentity(executionSource.model),
      promptPreview: executionSource.promptPreview == null
        ? null
        : String(executionSource.promptPreview),
    },
    providerResult,
  };
}

function normalizeWaitResult(wait, payload, job) {
  if (wait === false || wait === null) return null;
  const source = wait && typeof wait === "object"
    ? wait
    : (payload?.wait && typeof payload.wait === "object" ? payload.wait : null);
  const hasLegacyWait = hasOwn(payload || {}, "waitTimedOut");
  if (!source && wait !== true && !hasLegacyWait) return null;

  const forStatus = ["terminal", "completed", "failed", "cancelled"].includes(source?.for)
    ? source.for
    : "terminal";
  const timedOut = source?.timedOut === true || payload?.waitTimedOut === true;
  const terminalMismatch = source?.terminalMismatch === true;
  const satisfied = typeof source?.satisfied === "boolean"
    ? source.satisfied
    : (!timedOut
      && !terminalMismatch
      && (forStatus === "terminal"
        ? TERMINAL_JOB_STATUSES.has(job.status)
        : job.status === forStatus));
  return {
    for: forStatus,
    satisfied,
    timedOut,
    terminalMismatch,
  };
}

function normalizeStatusListWait(wait, payload) {
  if (wait === false || wait === null) return null;
  const source = wait && typeof wait === "object"
    ? wait
    : (payload?.wait && typeof payload.wait === "object" ? payload.wait : null);
  const hasLegacyWait = hasOwn(payload || {}, "waitTimedOut");
  if (!source && wait !== true && !hasLegacyWait) return null;

  const timedOut = source?.timedOut === true || payload?.waitTimedOut === true;
  return {
    for: "terminal",
    satisfied: typeof source?.satisfied === "boolean" ? source.satisfied : !timedOut,
    timedOut,
    terminalMismatch: false,
  };
}

function normalizeSessionEntries(entries) {
  return clonePublicResult(Array.isArray(entries) ? entries : []);
}

function serializeProviderCommand(commandId, payload) {
  if (payload?.job) {
    return {
      type: "job.started",
      job: normalizeV2Job(payload.job),
    };
  }
  return extractProviderExecution({
    ...payload,
    kind: payload?.kind ?? commandId,
  });
}

export function serializeV2Result(commandId, legacyPayload, context = {}) {
  const id = normalizeCommandId(commandId);
  const payload = legacyPayload && typeof legacyPayload === "object" ? legacyPayload : {};

  if (id === "setup") {
    return {
      type: "provider.setup",
      providers: clonePublicResult(Array.isArray(legacyPayload) ? legacyPayload : payload.providers) || [],
    };
  }

  if (id === "health") {
    return {
      type: "provider.health",
      results: clonePublicResult(payload.results) || [],
      healthyProviders: clonePublicResult(payload.healthyProviders) || [],
      unhealthyProviders: clonePublicResult(payload.unhealthyProviders) || [],
      allHealthy: payload.allHealthy === true,
      anyHealthy: payload.anyHealthy === true,
    };
  }

  if (PROVIDER_COMMANDS.has(id)) {
    return serializeProviderCommand(id, payload);
  }

  if (id === "status") {
    if (payload.job) {
      const job = normalizeV2Job(payload.job);
      return {
        type: "job.status",
        job,
        wait: normalizeWaitResult(context.wait, payload, job),
      };
    }
    return {
      type: "job.status-list",
      totalJobs: Number.isSafeInteger(payload.totalJobs) ? payload.totalJobs : 0,
      running: (Array.isArray(payload.running) ? payload.running : []).map(normalizeV2Job),
      recent: (Array.isArray(payload.recent) ? payload.recent : []).map(normalizeV2Job),
      wait: normalizeStatusListWait(context.wait, payload),
    };
  }

  if (id === "result") {
    const source = payload.providerResult && typeof payload.providerResult === "object"
      ? { ...payload.providerResult }
      : (payload.result && typeof payload.result === "object"
        ? payload.result
        : { ...payload });
    delete source.job;
    delete source.provider;
    delete source.kind;
    delete source.model;
    delete source.promptPreview;
    return {
      type: "job.result",
      job: normalizeV2Job(payload.job),
      providerResult: normalizeProviderResult(source),
    };
  }

  if (id === "cancel") {
    return {
      type: "job.cancel",
      jobId: nullableIdentity(payload.jobId),
      cancelled: payload.cancelled === true,
      reason: nullableIdentity(payload.reason) || (payload.cancelled === true ? "cancelled" : "unknown"),
    };
  }

  if (id === "timing") {
    return {
      type: "timing.report",
      records: clonePublicResult(payload.records) || [],
      aggregate: clonePublicResult(payload.aggregate) || {},
      metadata: clonePublicResult(payload.metadata) || {},
    };
  }

  if (id === "debug.runs") {
    return {
      type: "ledger.run-list",
      runs: clonePublicResult(payload.runs) || [],
    };
  }

  if (id === "debug.show") {
    return {
      type: "ledger.run-events",
      runId: nullableIdentity(payload.runId),
      events: clonePublicResult(payload.events) || [],
    };
  }

  if (id === "debug.explain") {
    const explanation = clonePublicResult(payload) || {};
    delete explanation.ok;
    return { type: "ledger.explanation", ...explanation };
  }

  if (id === "debug.tail") {
    return {
      type: "ledger.tail",
      runId: nullableIdentity(payload.runId),
      events: clonePublicResult(payload.events) || [],
      cursor: clonePublicResult(payload.cursor) || {
        requested: null,
        oldest: null,
        latest: null,
        next: null,
      },
      limited: payload.limited === true,
      cursorExpired: payload.cursorExpired === true,
      waitTimedOut: payload.waitTimedOut === true,
    };
  }

  if (id === "sessions.list") {
    return {
      type: "session.list",
      recorded: normalizeSessionEntries(payload.recorded),
      nonPurgeable: normalizeSessionEntries(payload.nonPurgeable),
    };
  }

  if (id === "sessions.purge") {
    return {
      type: "session.purge",
      confirmed: payload.confirmed === true,
      plan: clonePublicResult(payload.plan) || {},
      nonPurgeable: normalizeSessionEntries(payload.nonPurgeable),
      summary: clonePublicResult(payload.summary) || {},
    };
  }

  throw new PolycliCliError({
    code: "unknown_command",
    message: `Unknown command '${truncate(id, 120)}'.`,
    data: { command: id },
  });
}

function normalizeCommandPath(command) {
  if (Array.isArray(command)) {
    return command
      .slice(0, 8)
      .map((part) => truncate(part, 128))
      .filter(Boolean);
  }
  return normalizeCommandId(command)
    .split(".")
    .slice(0, 8)
    .map((part) => truncate(part, 128))
    .filter(Boolean);
}

function safeMetaIdentifier(value) {
  if (typeof value !== "string" || value === "") return null;
  return truncate(value, 256);
}

function assertInvocationId(invocationId) {
  if (!/^inv_[a-f0-9]{20}$/.test(String(invocationId ?? ""))) {
    throw new PolycliCliError({
      code: "invalid_argument",
      message: "A valid invocation ID is required for JSON v2 output.",
      data: { field: "invocationId" },
    });
  }
}

function buildEnvelopeMeta(context, result = null) {
  const inferredRunId = result && typeof result === "object" ? result.runId : null;
  const inferredJobId = result && typeof result === "object"
    ? (result.job?.jobId ?? result.jobId)
    : null;
  return {
    command: normalizeCommandPath(context.command),
    hostSurface: safeMetaIdentifier(context.hostSurface),
    workspaceSlug: safeMetaIdentifier(context.workspaceSlug),
    runId: safeMetaIdentifier(context.runId ?? inferredRunId),
    jobId: safeMetaIdentifier(context.jobId ?? inferredJobId),
  };
}

export function createV2SuccessEnvelope(result, context = {}) {
  assertInvocationId(context.invocationId);
  return {
    schemaVersion: 2,
    id: context.invocationId,
    ok: true,
    result,
    _meta: buildEnvelopeMeta(context, result),
  };
}

export function createV2ErrorEnvelope(error, context = {}) {
  assertInvocationId(context.invocationId);
  const typedError = PolycliCliError.from(error);
  return {
    schemaVersion: 2,
    id: context.invocationId,
    ok: false,
    error: {
      code: typedError.code,
      message: typedError.message,
      data: typedError.data,
      nextSteps: typedError.nextSteps,
    },
    _meta: buildEnvelopeMeta(context),
  };
}
