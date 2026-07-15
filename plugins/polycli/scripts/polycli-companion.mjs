#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "@bbingz/polycli-utils/args";
import { withLockfile, writeJsonAtomic } from "@bbingz/polycli-utils/atomic-save";
import { getProviderRuntime, listProviderRuntimes, runProviderPromptStreaming } from "@bbingz/polycli-runtime";

import {
  buildStatusSnapshot,
  cancelJob,
  refreshJob,
  refreshJobsForLedgerRecovery,
  resolveJobReference,
  resolveLatestActiveJob,
  resolveLatestTerminalJob,
  waitForJob,
} from "./lib/job-control.mjs";
import { buildPromptRuntimeOptions } from "./lib/prompt-runtime.mjs";
import { resolveProvider } from "./lib/providers.mjs";
import {
  assertReviewProviderSupported,
  assertStopReviewGateProviderSupported,
  buildReviewPrompt,
  buildReviewRuntimeOptions,
  collectReviewContext,
} from "./lib/review.mjs";
import {
  getJob,
  recordLastUsedProvider,
  readJobConfigFile,
  readJobFile,
  removeJobConfigFile,
  resolveJobConfigFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveWorkspaceRoot,
  getConfig,
  setConfig,
  updateJobAtomically,
  upsertJob,
  writeJobConfigFile,
  writeJobFile,
} from "./lib/state.mjs";
import {
  appendTimingRecord,
  describeTimingStore,
  listTimingRecords,
  summarizeTimingRecords,
} from "./lib/timing.mjs";
import { appendPreview, previewText } from "./lib/preview.mjs";
import {
  appendRunLedgerEvent,
  buildRunExplanation,
  createTerminalLedgerDescriptor,
  ensureRunLedgerTerminalPair,
  readRunLedgerEvents,
  redactArgv,
  resolveHostSurface,
  resolveRunId,
  stripRunIdArgs,
  summarizeRunLedger,
} from "./lib/run-ledger.mjs";
import {
  collectNonPurgeableSessions,
  collectRecordedArtifacts,
  defaultHomedir,
  deriveSessionArtifactCandidate,
  executePurge,
  planPurge,
  recordArtifactPath,
} from "./lib/sessions.mjs";

const COMPANION_PATH = fileURLToPath(import.meta.url);
const JOB_PREFIXES = {
  ask: "pa",
  rescue: "pr",
  review: "pv",
  "adversarial-review": "pv",
};
const TIMEOUTS_MS = {
  ask: 120_000,
  rescue: 600_000,
  review: 300_000,
  "adversarial-review": 300_000,
  health: 60_000,
};
const PROVIDER_TIMEOUT_MULTIPLIERS = {
  gemini: {
    "gemini-3.1-pro-preview": 2,
  },
  // opencode's kimi-for-coding variant is a code-reasoning model that hits
  // 120s+ on HumanEval-class problems (verified 2026-05-02 multiway bench R3).
  opencode: {
    "kimi-for-coding/k2p6": 2,
  },
};

function resolveTimeoutMs(provider, kind, { model = null, defaultModel = null } = {}) {
  const base = TIMEOUTS_MS[kind];
  if (!Number.isFinite(base)) return base;
  const entry = PROVIDER_TIMEOUT_MULTIPLIERS[provider];
  if (entry == null) return base;
  if (typeof entry === "number") return base * entry;
  // Explicit --model wins; fall back to the cached upstream-default model only
  // if the caller did not pass one. This way, --model gemini-flash-2.5 stays
  // at the base budget even when the cached default is a deep-reasoning model.
  const lookup = model || defaultModel;
  const multiplier = (lookup && entry[lookup]) || 1;
  return base * multiplier;
}
const HEALTH_SENTINEL = "POLYCLI_HEALTH_OK";
const SESSION_ID_ENV = "POLYCLI_COMPANION_SESSION_ID";
const RUN_TRACKED_COMMANDS = new Set([
  "health",
  "ask",
  "rescue",
  "review",
  "adversarial-review",
]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

const RUN_CONTEXT = {
  runId: null,
  command: null,
  hostSurface: "unknown",
  rawArgs: [],
};

function buildCurrentRunContext(overrides = {}) {
  if (!RUN_CONTEXT.runId) return null;
  const command = overrides.command || RUN_CONTEXT.command;
  return {
    version: 1,
    runId: RUN_CONTEXT.runId,
    command,
    commands: [command].filter(Boolean),
    hostSurface: RUN_CONTEXT.hostSurface,
    argv: redactArgv(RUN_CONTEXT.rawArgs, { command: RUN_CONTEXT.command }),
    ...overrides,
  };
}

function buildRunEventForContext(runContext, base = {}) {
  if (!runContext?.runId) return null;
  const command = base.command || runContext.command;
  const commands = Array.from(
    new Set([...(runContext.commands || []), command, ...(base.commands || [])].filter(Boolean)),
  ).sort();
  return {
    runId: runContext.runId,
    hostSurface: runContext.hostSurface,
    argv: runContext.argv || [],
    ...base,
    command,
    commands,
  };
}

function recordRunEventForContext(workspaceRoot, runContext, base = {}) {
  const event = buildRunEventForContext(runContext, base);
  return event ? appendRunLedgerEvent(workspaceRoot, event) : null;
}

function prepareTerminalRunEventsForContext(runContext, bases = []) {
  const events = bases.map((base) => buildRunEventForContext(runContext, base)).filter(Boolean);
  if (events.length === 0) return { events, terminalDescriptor: null };
  const terminalDescriptor = createTerminalLedgerDescriptor(events);
  return {
    events: events.map((event) => ({ ...event, terminalDescriptor })),
    terminalDescriptor,
  };
}

function ensureTerminalRunEventsForContext(workspaceRoot, prepared) {
  return prepared.events.length > 0
    ? ensureRunLedgerTerminalPair(workspaceRoot, prepared.events)
    : [];
}

function hasTerminalJobEnvelope(envelope) {
  return TERMINAL_JOB_STATUSES.has(envelope?.job?.status);
}

function claimBackgroundWorker(workspaceRoot, jobId) {
  const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
    // The worker claims its own PID before it records any provider-facing event or invokes a
    // provider. This closes the parent spawn -> state-PID crash window: if cancellation won that
    // race, its terminal envelope makes this worker exit without doing work.
    if (!latest || !ACTIVE_JOB_STATUSES.has(latest.status) || hasTerminalJobEnvelope(storedEnvelope)) {
      return null;
    }
    if (latest.pid != null && latest.pid !== process.pid) {
      return null;
    }
    return {
      job: {
        ...latest,
        status: "running",
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      },
    };
  });
  return write.written ? write.job : null;
}

function shouldRetainJobConfig(workspaceRoot, jobId) {
  const current = getJob(workspaceRoot, jobId);
  return current?.status === "queued" || current?.status === "running";
}

function recordBackgroundSpawnFailure(workspaceRoot, jobId, execution, runContext, error) {
  const config = readJobConfigFile(resolveJobConfigFile(workspaceRoot, jobId));
  try {
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || !ACTIVE_JOB_STATUSES.has(latest.status) || hasTerminalJobEnvelope(storedEnvelope)) {
        return null;
      }
      const finishedAt = new Date().toISOString();
      const failedJob = {
        ...latest,
        ...execution.jobMeta,
        status: "failed",
        pid: null,
        finishedAt,
        updatedAt: finishedAt,
        error: error.message,
      };
      const terminalReason = `${execution.kind}_failed`;
      const terminalEvents = [
        {
          command: runContext?.command || execution.kind,
          kind: execution.kind,
          provider: execution.provider,
          phase: "attempt_result",
          status: "failed",
          reason: terminalReason,
          attempt: { ordinal: 1 },
          jobId,
          error: { message: String(error.message || error).slice(0, 300) },
          logFile: failedJob.logFile || null,
        },
        {
          command: runContext?.command || execution.kind,
          kind: execution.kind,
          provider: execution.provider,
          phase: "provider_decision",
          status: "failed",
          reason: terminalReason,
          jobId,
        },
      ];
      const terminal = prepareTerminalRunEventsForContext(runContext, terminalEvents);
      return {
        job: failedJob,
        envelope: {
          job: failedJob,
          result: { ok: false, error: error.message },
          terminalReason,
          terminalDescriptor: terminal.terminalDescriptor,
        },
        beforeStateCommit() {
          ensureTerminalRunEventsForContext(workspaceRoot, terminal);
        },
      };
    });
    if (write.written) {
      cleanupRuntimeOptions(config?.execution?.runtimeOptions);
      removeJobConfigFile(workspaceRoot, jobId);
    }
  } catch {
    // A failed state/ledger write leaves the active job and, when the envelope write succeeded,
    // a recoverable terminal intent. The next status refresh owns the retry.
  }
}

async function recordRunEvent(workspaceRoot, base = {}) {
  return recordRunEventForContext(workspaceRoot, buildCurrentRunContext(), base);
}

// Compute the verified realpath of the upstream session artifact this run just
// created, or null. Never returns an unverified or fabricated path (invariant #6).
function resolveSessionArtifactPath(provider, sessionId, cwd) {
  if (!sessionId || !cwd) return null;
  const homedir = defaultHomedir();
  const candidate = deriveSessionArtifactCandidate({
    provider,
    sessionId,
    workspaceRoot: cwd,
    homedir,
  });
  if (!candidate.path) return null;
  return recordArtifactPath(candidate, { homedir });
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  polycli-companion.mjs setup [--provider <provider>] [--probe-auth] [--json]",
      "    [--enable-review-gate|--disable-review-gate]",
      "  polycli-companion.mjs health [--provider <provider>] [--model <model>] [--timeout-ms <ms>] [--json]",
      "  polycli-companion.mjs ask --provider <provider> [--model <model>] [--background] [--json] <prompt>",
      "  polycli-companion.mjs rescue --provider <provider> [--model <model>] [--background] [--json] <prompt>",
      "  polycli-companion.mjs review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [--json] [focus ...]",
      "  polycli-companion.mjs adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [--json] [focus ...]",
      "  polycli-companion.mjs status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]",
      "  polycli-companion.mjs result [job-id] [--json]",
      "  polycli-companion.mjs cancel [job-id] [--json]",
      "  polycli-companion.mjs timing [--provider <provider>] [--history <count|all>] [--all] [--json]",
      "  polycli-companion.mjs debug runs [--json]",
      "  polycli-companion.mjs debug show <run-id> [--json]",
      "  polycli-companion.mjs debug explain <run-id> [--json]",
      "  polycli-companion.mjs sessions [list] [--json]",
      "  polycli-companion.mjs sessions purge [--confirm] [--json]",
    ].join("\n")
  );
}

function hasHelpFlag(args = []) {
  return args.includes("--help") || args.includes("-h");
}

function wantsJson(args = []) {
  return args.includes("--json");
}

function classifyErrorCode(message = "") {
  if (message.startsWith("Missing provider.")) return "missing_provider";
  if (message.startsWith("Unknown provider ")) return "unknown_provider";
  if (message.startsWith("Invalid --scope value ")) return "invalid_scope";
  if (message.startsWith("Missing prompt text ")) return "missing_prompt";
  if (message.startsWith("Unknown subcommand ")) return "unknown_subcommand";
  if (/^Job '.+' not found\.$/.test(message)) return "job_not_found";
  if (message === "No completed job found.") return "no_completed_job";
  if (message === "No active job found.") return "no_active_job";
  if (
    message === "--history must be a non-negative integer."
    || message === "--history must be a non-negative integer or all."
  ) return "invalid_history";
  if (message === "--max-diff-bytes must be a non-negative integer.") return "invalid_max_diff_bytes";
  return "error";
}

function exitWithError({ message, code = classifyErrorCode(message), asJson = false, exitCode = 1 }) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ error: message, code }, null, 2)}\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exitCode = exitCode;
}

function output(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

function resolveProviderModelCacheFile(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), "provider-models.json");
}

function readProviderModelCache(workspaceRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveProviderModelCacheFile(workspaceRoot), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readCachedProviderModel(workspaceRoot, provider) {
  const cached = readProviderModelCache(workspaceRoot)[provider];
  return typeof cached === "string" && cached.trim() ? cached : null;
}

function cacheProviderModel(workspaceRoot, provider, model) {
  if (typeof model !== "string" || !model.trim()) return;
  const cacheFile = resolveProviderModelCacheFile(workspaceRoot);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true, mode: 0o700 });
  // Serialize the read-modify-write under a lock and write atomically. A bare writeFileSync RMW
  // let two concurrent invocations against the same workspace each read the old cache, add only
  // their own provider, and last-writer-wins — silently dropping the other's freshly-cached model.
  withLockfile(`${cacheFile}.lock`, () => {
    writeJsonAtomic(cacheFile, { ...readProviderModelCache(workspaceRoot), [provider]: model }, { mode: 0o600 });
  });
}

function normalizeAuthProbeCost(runtime) {
  const value = runtime.capabilities?.authProbeCost;
  return value === "status" || value === "model" ? value : "unknown";
}

function deriveAuthState(auth) {
  if (!auth) return "unknown";
  const detail = String(auth.detail ?? auth.reason ?? "");
  if (/auth probe inconclusive/i.test(detail)) return "unknown";
  if (auth.loggedIn === true) return "authenticated";
  if (auth.loggedIn === false) return "unauthenticated";
  return "unknown";
}

function skippedAuthDetail({ available, authProbeCost }) {
  if (!available) return "not checked because the provider CLI is unavailable";
  if (authProbeCost === "model") {
    return "not checked by default because authentication uses a model prompt; rerun setup --probe-auth to opt in";
  }
  return "not checked because this provider has no declared safe auth-status probe";
}

async function inspectProvider(provider, { probeAuth = false } = {}) {
  const runtime = getProviderRuntime(provider);
  const availability = await Promise.resolve(runtime.getAvailability(process.cwd()));
  const available = availability.available === true;
  const authProbeCost = normalizeAuthProbeCost(runtime);
  const authChecked = available && (probeAuth || authProbeCost === "status");
  const auth = authChecked
    ? await Promise.resolve(runtime.getAuthStatus(process.cwd()))
    : null;
  const row = {
    provider,
    available,
    availabilityDetail: availability.detail ?? null,
    loggedIn: auth?.loggedIn ?? null,
    authState: deriveAuthState(auth),
    authChecked,
    authProbeCost,
    authDetail: auth?.detail ?? auth?.reason ?? skippedAuthDetail({ available, authProbeCost }),
    model: auth?.model ?? null,
    capabilities: runtime.capabilities,
  };
  cacheProviderModel(resolveWorkspaceRoot(process.cwd()), provider, row.model);
  return row;
}

async function inspectProviderAvailability(provider) {
  const runtime = getProviderRuntime(provider);
  const availability = await Promise.resolve(runtime.getAvailability(process.cwd()));
  const authProbeCost = normalizeAuthProbeCost(runtime);
  return {
    provider,
    available: availability.available ?? false,
    availabilityDetail: availability.detail ?? null,
    loggedIn: null,
    authState: "unknown",
    authChecked: false,
    authProbeCost,
    authDetail: "not checked by health",
    model: null,
    capabilities: runtime.capabilities,
  };
}

function createJobId(kind) {
  const prefix = JOB_PREFIXES[kind] || "pj";
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function parseExecutionMode(options) {
  if (options.background && options.wait) {
    throw new Error("Choose either --background or --wait, not both.");
  }
  return {
    background: Boolean(options.background),
  };
}

function emitNote(line) {
  if (!line) return;
  process.stderr.write(`${line}\n`);
}

function emitRuntimeWarnings(result = {}) {
  if (!Array.isArray(result.warnings)) return;
  for (const warning of result.warnings) {
    if (typeof warning === "string" && warning.trim()) {
      process.stderr.write(`${warning.trim()}\n`);
    }
  }
}

function validateEffort(effort) {
  if (effort == null) return;
  if (!["low", "medium", "high"].includes(effort)) {
    throw new Error("--effort must be one of: low, medium, high.");
  }
}

function buildProviderFlagRuntimeOptions(provider, options) {
  const runtimeOptions = {};
  const notes = [];
  const resumeFlags = [
    options["resume-last"] ? "--resume-last" : null,
    options.resume ? "--resume" : null,
    options.fresh ? "--fresh" : null,
  ].filter(Boolean);

  if (provider === "kimi") {
    if (resumeFlags.length > 1) {
      throw new Error("Choose only one of --resume-last, --resume, or --fresh.");
    }
    if (options["resume-last"]) runtimeOptions.resumeLast = true;
    if (options.resume) runtimeOptions.resumeSessionId = options.resume;
    if (options.fresh) runtimeOptions.fresh = true;
    if (options.write) {
      notes.push("Kimi doesn't distinguish plan-mode from write-mode; it will act on what the prompt asks.");
    }
    if (options.effort) {
      notes.push(`--effort is gemini-specific; ${provider} will proceed without it.`);
    }
    return { runtimeOptions, notes };
  }

  if (provider === "gemini") {
    if (options.write) runtimeOptions.write = true;
    if (options.effort) runtimeOptions.effort = options.effort;
    if (resumeFlags.length > 0) {
      notes.push(`${resumeFlags.join(", ")} ${resumeFlags.length === 1 ? "is" : "are"} kimi-specific; ${provider} will proceed without ${resumeFlags.length === 1 ? "it" : "them"}.`);
    }
    return { runtimeOptions, notes };
  }

  if (provider === "agy") {
    if (resumeFlags.length > 1) {
      throw new Error("Choose only one of --resume-last, --resume, or --fresh.");
    }
    if (options["resume-last"]) runtimeOptions.continueLast = true;
    if (options.resume) runtimeOptions.resumeConversationId = options.resume;
    if (options.fresh) {
      notes.push("--fresh is already agy's default for non-resumed print runs.");
    }
    if (options.write) {
      notes.push("--write is gemini-specific; agy will proceed without it.");
    }
    if (options.effort) {
      notes.push("--effort is gemini-specific; agy will proceed without it.");
    }
    return { runtimeOptions, notes };
  }

  if (provider === "grok") {
    if (resumeFlags.length > 1) {
      throw new Error("Choose only one of --resume-last, --resume, or --fresh.");
    }
    if (options["resume-last"]) runtimeOptions.continueLast = true;
    if (options.resume) runtimeOptions.resumeSessionId = options.resume;
    if (options.fresh) {
      notes.push("--fresh is already grok's default for non-resumed -p runs.");
    }
    if (options.effort) runtimeOptions.effort = options.effort;
    if (options.write) {
      notes.push("--write is gemini-specific; grok will proceed without it.");
    }
    return { runtimeOptions, notes };
  }

  if (options.write) {
    notes.push(`--write is gemini-specific; ${provider} will proceed without it.`);
  }
  if (options.effort) {
    notes.push(`--effort is gemini-specific; ${provider} will proceed without it.`);
  }
  if (resumeFlags.length > 0) {
    notes.push(`${resumeFlags.join(", ")} ${resumeFlags.length === 1 ? "is" : "are"} kimi-specific; ${provider} will proceed without ${resumeFlags.length === 1 ? "it" : "them"}.`);
  }
  return { runtimeOptions, notes };
}

function buildExecutionEnvelope(execution, result) {
  return {
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || execution.defaultModel || null,
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    meta: execution.meta || {},
    ...compactProviderResult(result),
  };
}

function compactProviderResult(result = {}) {
  const compact = { ...result };
  if (typeof result.stdout === "string") {
    compact.stdoutBytes = Buffer.byteLength(result.stdout, "utf8");
    delete compact.stdout;
  }
  if (typeof result.stderr === "string") {
    compact.stderrBytes = Buffer.byteLength(result.stderr, "utf8");
    delete compact.stderr;
  }
  if (Array.isArray(result.events)) {
    compact.eventCount = result.events.length;
    delete compact.events;
  }
  return compact;
}

function cleanupRuntimeOptions(runtimeOptions = {}) {
  const cleanupPaths = Array.isArray(runtimeOptions.cleanupPaths)
    ? runtimeOptions.cleanupPaths
    : [];
  for (const cleanupPath of cleanupPaths) {
    if (typeof cleanupPath !== "string" || cleanupPath.trim() === "") continue;
    try {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    } catch {}
  }
}

function hydrateRuntimeOptions(runtimeOptions = {}) {
  if (!runtimeOptions.env) {
    return runtimeOptions;
  }
  return {
    ...runtimeOptions,
    env: { ...process.env, ...runtimeOptions.env },
  };
}

async function runForegroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  await recordRunEvent(workspaceRoot, {
    command: execution.kind,
    kind: execution.kind,
    provider: execution.provider,
    phase: "attempt_started",
    status: "started",
    attempt: { ordinal: 1 },
  });
  let result;
  try {
    result = await runProviderPromptStreaming({
      provider: execution.provider,
      prompt: execution.prompt,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      cwd: execution.cwd,
      timeout: execution.timeout,
      kind: execution.kind,
      measurementScope: execution.measurementScope || "request",
      meta: execution.meta || null,
      ...hydrateRuntimeOptions(execution.runtimeOptions),
      onEvent() {},
    });
  } finally {
    cleanupRuntimeOptions(execution.runtimeOptions);
  }
  emitRuntimeWarnings(result);
  if (result.timing) {
    appendTimingRecord(workspaceRoot, result.timing);
  }
  cacheProviderModel(workspaceRoot, execution.provider, result.model);

  const sessionArtifactPath = resolveSessionArtifactPath(
    execution.provider,
    result.sessionId,
    execution.cwd,
  );

  await recordRunEvent(workspaceRoot, {
    command: execution.kind,
    kind: execution.kind,
    provider: execution.provider,
    phase: "attempt_result",
    status: result.ok ? "completed" : "failed",
    attempt: { ordinal: 1 },
    model: result.model || null,
    sessionId: result.sessionId ?? null,
    sessionArtifactPath,
    defaultModel: result.defaultModel || null,
    preview: result.response ? String(result.response).slice(0, 180) : null,
    stdoutBytes: result.stdoutBytes ?? null,
    stderrBytes: result.stderrBytes ?? null,
    errorCode: result.errorCode ?? result.timing?.errorCode ?? null,
    failureClass: result.errorCode ?? result.timing?.errorCode ?? null,
    timingRef: result.timing
      ? {
        provider: result.timing.provider,
        kind: result.timing.kind,
        completedAt: result.timing.completedAt,
      }
      : null,
    error: result.ok || !result.error
      ? null
      : { message: String(result.error).slice(0, 300) },
  });
  await recordRunEvent(workspaceRoot, {
    command: execution.kind,
    kind: execution.kind,
    provider: execution.provider,
    phase: "provider_decision",
    status: result.ok ? "adopted" : "failed",
    reason: result.ok ? null : `${execution.kind}_failed`,
    sessionId: result.sessionId ?? null,
    sessionArtifactPath,
  });

  const envelope = buildExecutionEnvelope(execution, result);
  if (asJson) {
    output(envelope, true);
    return;
  }

  if (!result.ok) {
    throw new Error(result.error || `${execution.provider} ${execution.kind} failed`);
  }

  const lines = [];
  if (execution.meta?.truncationNotice) {
    lines.push(execution.meta.truncationNotice);
  }
  lines.push(result.response);
  output(lines.join("\n\n"), false);
}

function buildQueuedJob(execution, workspaceRoot) {
  const now = new Date().toISOString();
  const jobId = createJobId(execution.kind);
  return {
    jobId,
    workspaceRoot,
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || null,
    defaultModel: execution.defaultModel || null,
    status: "queued",
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    logFile: resolveJobLogFile(workspaceRoot, jobId),
    createdAt: now,
    updatedAt: now,
    sessionId: process.env[SESSION_ID_ENV] || null,
    ...execution.jobMeta,
  };
}

function renderStartedJob(job) {
  return [
    `Started ${job.provider} ${job.kind} job ${job.jobId}.`,
    `Use /polycli:status ${job.jobId} to monitor it.`,
    `Use /polycli:result ${job.jobId} to fetch the stored output.`,
  ].join("\n");
}

function renderJobDetail(job) {
  const lines = [
    `Job: ${job.jobId}`,
    `Provider: ${job.provider}`,
    `Kind: ${job.kind}`,
    `Status: ${job.status}`,
  ];
  if (job.model) lines.push(`Model: ${job.model}`);
  if (job.promptPreview) lines.push(`Prompt: ${job.promptPreview}`);
  if (job.scope) lines.push(`Scope: ${job.scope}`);
  if (job.baseRef) lines.push(`Base Ref: ${job.baseRef}`);
  if (job.createdAt) lines.push(`Created: ${job.createdAt}`);
  if (job.finishedAt) lines.push(`Finished: ${job.finishedAt}`);
  if (job.sessionId) lines.push(`Session: ${job.sessionId}`);
  if (job.progressPreview) {
    lines.push("");
    lines.push("Progress:");
    lines.push(job.progressPreview);
  }
  return lines.join("\n");
}

function renderStatusSnapshot(snapshot) {
  const rows = [...snapshot.running, ...snapshot.recent];
  const lines = [
    ...(snapshot.waitTimedOut ? ["Timed out waiting for all jobs."] : []),
  ];
  if (rows.length === 0) {
    lines.push("No jobs found.");
    return lines.join("\n");
  }

  lines.push("| jobId | provider | kind | status | prompt |");
  lines.push("|---|---|---|---|---|");
  for (const job of rows) {
    lines.push(`| ${job.jobId} | ${job.provider} | ${job.kind} | ${job.status} | ${job.promptPreview || ""} |`);
    if (job.progressPreview && snapshot.running.some((running) => running.jobId === job.jobId)) {
      lines.push(`|  |  |  | progress | ${previewText(job.progressPreview, 180)} |`);
    }
  }
  return lines.join("\n");
}

async function waitForAllJobs(workspaceRoot, { timeoutMs = 240_000, pollIntervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = buildStatusSnapshot(workspaceRoot, { showAll: true });
    if (snapshot.running.length === 0) {
      return { ...snapshot, waitTimedOut: false };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  snapshot = buildStatusSnapshot(workspaceRoot, { showAll: true });
  return { ...snapshot, waitTimedOut: snapshot.running.length > 0 };
}

function parseStatusTimeoutMs(rawValue) {
  if (rawValue == null) return undefined;
  const value = String(rawValue);
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs)) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  return timeoutMs;
}

function renderResultEnvelope(envelope) {
  const result = envelope.result ?? envelope;
  const lines = [
    `Job: ${envelope.job.jobId}`,
    `Provider: ${envelope.job.provider}`,
    `Kind: ${envelope.job.kind}`,
    `Status: ${envelope.job.status}`,
  ];
  if (envelope.job.finishedAt) lines.push(`Finished: ${envelope.job.finishedAt}`);
  if (envelope.job.sessionId) lines.push(`Session: ${envelope.job.sessionId}`);
  if (result?.response) {
    lines.push("");
    lines.push("Response:");
    lines.push(result.response);
  }
  if (!result?.response && result?.error) {
    lines.push("");
    lines.push("Error:");
    lines.push(result.error);
  }
  return lines.join("\n");
}

function buildResultPayload(envelope) {
  const job = envelope.job || {};
  const result = envelope.result || {};
  return {
    provider: result.provider ?? job.provider ?? null,
    kind: result.kind ?? job.kind ?? null,
    model: result.model ?? job.model ?? null,
    promptPreview: result.promptPreview ?? job.promptPreview ?? null,
    ...result,
    job: {
      jobId: job.jobId ?? null,
      provider: job.provider ?? null,
      kind: job.kind ?? null,
      model: job.model ?? null,
      status: job.status ?? null,
      promptPreview: job.promptPreview ?? null,
      createdAt: job.createdAt ?? null,
      updatedAt: job.updatedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      pid: job.pid ?? null,
      logFile: job.logFile ?? null,
      sessionId: job.sessionId ?? null,
      error: job.error ?? null,
    },
  };
}

async function startBackgroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  const job = buildQueuedJob(execution, workspaceRoot);
  upsertJob(workspaceRoot, job);
  const runContext = buildCurrentRunContext({
    command: execution.kind,
    jobId: job.jobId,
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || null,
    defaultModel: execution.defaultModel || null,
    logFile: job.logFile,
  });
  writeJobConfigFile(workspaceRoot, job.jobId, {
    workspaceRoot,
    execution: {
      ...execution,
      measurementScope: "job",
      meta: {
        ...(execution.meta || {}),
        background: true,
        jobId: job.jobId,
      },
    },
    jobId: job.jobId,
    runContext,
  });

  fs.writeFileSync(job.logFile, `[${new Date().toISOString()}] started ${job.provider} ${job.kind}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const logFd = fs.openSync(job.logFile, "a", 0o600);
  const child = spawn(process.execPath, [COMPANION_PATH, "_job-worker", resolveJobConfigFile(workspaceRoot, job.jobId)], {
    cwd: execution.cwd,
    env: { ...process.env },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  child.once("error", (error) => {
    recordBackgroundSpawnFailure(workspaceRoot, job.jobId, execution, runContext, error);
  });
  child.unref();
  fs.closeSync(logFd);

  const runningWrite = updateJobAtomically(workspaceRoot, job.jobId, (latest) => {
    if (!latest || latest.status !== "queued") return null;
    return {
      job: {
        ...latest,
        status: "running",
        pid: child.pid ?? null,
        updatedAt: new Date().toISOString(),
      },
    };
  });
  const runningJob = runningWrite.written ? runningWrite.job : (getJob(workspaceRoot, job.jobId) || job);

  if (!ACTIVE_JOB_STATUSES.has(runningJob.status)) {
    // Cancellation may win before the child claims itself. In that case the worker will see the
    // terminal state and exit before any provider call; remove the config we may have recreated
    // after the canceller's cleanup so it cannot linger as a false live-worker marker.
    removeJobConfigFile(workspaceRoot, job.jobId);
  }

  if (runContext && ACTIVE_JOB_STATUSES.has(runningJob.status)) {
    await recordRunEventForContext(workspaceRoot, runContext, {
      command: execution.kind,
      kind: execution.kind,
      provider: execution.provider,
      phase: "job_started",
      status: "started",
      jobId: job.jobId,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      logFile: job.logFile,
      pid: runningJob.pid ?? null,
    });
  }

  if (asJson) {
    output({ ok: true, job: runningJob }, true);
    return;
  }

  output(renderStartedJob(runningJob), false);
}

async function runSetup(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "probe-auth", "enable-review-gate", "disable-review-gate"],
    valueOptions: ["provider"],
  });
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate, not both.");
  }
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }

  let providers;
  if (options.provider) {
    providers = [resolveProvider({ provider: options.provider }).provider];
  } else if (positionals[0]) {
    providers = [resolveProvider({ positionals }).provider];
  } else {
    providers = listProviderRuntimes().map((runtime) => runtime.id);
  }

  const gateConfig = getConfig(workspaceRoot);
  const results = [];
  for (const provider of providers) {
    results.push({
      ...(await inspectProvider(provider, { probeAuth: Boolean(options["probe-auth"]) })),
      stopReviewGate: gateConfig.stopReviewGate === true,
      stopReviewGateWorkspace: workspaceRoot,
    });
  }

  if (options.json) {
    output(results, true);
    return;
  }

  const lines = [];
  for (const row of results) {
    lines.push(
      [
        `[${row.provider}]`,
        `available=${row.available ? "yes" : "no"}`,
        `auth=${row.authState}`,
        `authProbe=${row.authChecked ? "checked" : `skipped:${row.authProbeCost}`}`,
        row.model ? `model=${row.model}` : null,
        row.availabilityDetail ? `version=${row.availabilityDetail}` : null,
        row.authDetail ? `detail=${row.authDetail}` : null,
      ].filter(Boolean).join(" ")
    );
  }
  output(lines.join("\n"), false);
}

async function probeProviderHealth({
  provider,
  model = null,
  timeout,
  workspaceRoot,
}) {
  const inspection = await inspectProviderAvailability(provider);
  const report = {
    ...inspection,
    ok: false,
    probe: {
      ok: false,
      responseMatched: false,
      expected: HEALTH_SENTINEL,
      responsePreview: null,
      error: null,
      timing: null,
    },
  };

  if (!inspection.available) {
    report.probe.error = inspection.availabilityDetail || "provider CLI is unavailable";
  } else if (provider === "claude") {
    try {
      const auth = await Promise.resolve(getProviderRuntime(provider).getAuthStatus(process.cwd()));
      report.loggedIn = auth.loggedIn ?? false;
      report.authDetail = auth.detail ?? auth.reason ?? null;
      report.model = auth.model ?? report.model;
      report.probe = {
        ok: Boolean(auth.loggedIn),
        kind: "auth_status",
        authOnly: true,
        responseMatched: Boolean(auth.loggedIn),
        expected: "authenticated",
        responsePreview: auth.detail ?? null,
        error: auth.loggedIn ? null : (auth.detail ?? "claude auth status did not report authenticated"),
        timing: null,
      };
      report.ok = Boolean(auth.loggedIn);
    } catch (error) {
      report.probe.error = error.message;
    }
  } else {
    try {
      const result = await runProviderPromptStreaming({
        provider,
        prompt: `Reply with ${HEALTH_SENTINEL} only.`,
        model,
        defaultModel: model ? null : readCachedProviderModel(workspaceRoot, provider),
        cwd: process.cwd(),
        timeout,
        kind: "health",
        measurementScope: "request",
        meta: { health: true },
        ...hydrateRuntimeOptions(buildPromptRuntimeOptions({
          provider,
          kind: "ask",
        })),
        onEvent() {},
      });
      if (result.timing) {
        appendTimingRecord(workspaceRoot, result.timing);
      }
      const response = result.response || "";
      const responseMatched = response.trim() === HEALTH_SENTINEL;
      report.probe = {
        ok: result.ok,
        responseMatched,
        expected: HEALTH_SENTINEL,
        responsePreview: previewText(response, 180),
        error: result.error ?? null,
        timing: result.timing ?? null,
      };
      report.ok = Boolean(result.ok && responseMatched);
      report.model = result.model ?? report.model;
      cacheProviderModel(workspaceRoot, provider, report.model);
    } catch (error) {
      report.probe.error = error.message;
    }
  }

  return report;
}

function renderHealthReport(report) {
  const lines = [
    `[${report.provider}] health=${report.ok ? "ok" : "failed"}`,
    `available=${report.available ? "yes" : "no"}`,
    `auth=${report.loggedIn == null ? "not_checked" : (report.loggedIn ? "yes" : "no")}`,
  ];
  if (report.model) lines.push(`model=${report.model}`);
  if (report.availabilityDetail) lines.push(`version=${report.availabilityDetail}`);
  if (report.authDetail) lines.push(`detail=${report.authDetail}`);
  lines.push(`probe=${report.probe.ok ? "ok" : "failed"}`);
  lines.push(`matched=${report.probe.responseMatched ? "yes" : "no"}`);
  if (report.probe.responsePreview) lines.push(`response=${report.probe.responsePreview}`);
  if (report.probe.error) lines.push(`error=${report.probe.error}`);
  return lines.join(" ");
}

function buildHealthPayload(results) {
  const healthyProviders = results.filter((result) => result.ok).map((result) => result.provider);
  const unhealthyProviders = results.filter((result) => !result.ok).map((result) => result.provider);
  return {
    ok: healthyProviders.length > 0,
    anyHealthy: healthyProviders.length > 0,
    allHealthy: results.length > 0 && unhealthyProviders.length === 0,
    healthyProviders,
    unhealthyProviders,
    results,
  };
}

async function runHealth(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider", "model", "timeout-ms"],
    aliasMap: { m: "model" },
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const timeoutMs = options["timeout-ms"] ? Number.parseInt(options["timeout-ms"], 10) : TIMEOUTS_MS.health;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TIMEOUTS_MS.health;
  const hasSingleProvider = Boolean(options.provider || positionals[0]);
  if (options.model && !hasSingleProvider) {
    throw new Error("--model requires --provider for health; provider model names are not portable.");
  }
  const providers = hasSingleProvider
    ? [resolveProvider({ provider: options.provider, positionals }).provider]
    : listProviderRuntimes().map((runtime) => runtime.id);

  const results = await Promise.all(providers.map((provider) => probeProviderHealth({
      provider,
      model: options.model || null,
      timeout,
      workspaceRoot,
    })));

  for (const report of results) {
    await recordRunEvent(workspaceRoot, {
      command: "health",
      kind: "health",
      provider: report.provider,
      phase: "health_result",
      status: report.ok ? "passed" : "failed",
      reason: report.ok ? "health_passed" : "health_failed",
      model: report.model || null,
      preview: report.probe?.responsePreview || null,
      error: report.probe?.error
        ? { message: String(report.probe.error).slice(0, 300) }
        : null,
    });
    await recordRunEvent(workspaceRoot, {
      command: "health",
      kind: "health",
      provider: report.provider,
      phase: "provider_decision",
      status: report.ok ? "passed" : "skipped",
      reason: report.ok ? "health_passed" : "health_failed",
    });
  }

  const payload = buildHealthPayload(results);
  if (!payload.anyHealthy) {
    process.exitCode = 2;
  }
  output(
    options.json
      ? payload
      : [
        `Healthy providers: ${payload.healthyProviders.length > 0 ? payload.healthyProviders.join(", ") : "none"}`,
        `All healthy: ${payload.allHealthy ? "yes" : "no"}`,
        ...results.map((result) => renderHealthReport(result)),
      ].join("\n"),
    options.json
  );
}

function parsePromptExecution(rawArgs, kind) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait", "resume-last", "fresh", "write"],
    valueOptions: ["provider", "model", "resume", "effort"],
    aliasMap: { m: "model" },
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals,
  });
  validateEffort(options.effort);
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const userPrompt = remainingPositionals.join(" ").trim();
  if (!userPrompt) {
    throw new Error(`Missing prompt text for ${kind}.`);
  }
  const providerFlags = buildProviderFlagRuntimeOptions(provider, options);
  for (const note of providerFlags.notes) emitNote(note);
  const cachedDefaultModel = readCachedProviderModel(workspaceRoot, provider);
  return {
    options,
    execution: {
      provider,
      kind,
      prompt: userPrompt,
      userPrompt,
      model: options.model || null,
      defaultModel: cachedDefaultModel,
      cwd: process.cwd(),
      timeout: resolveTimeoutMs(provider, kind, {
        model: options.model || null,
        defaultModel: cachedDefaultModel,
      }),
      meta: {},
      jobMeta: {},
      measurementScope: "request",
      runtimeOptions: buildPromptRuntimeOptions({
        provider,
        kind,
        runtimeOptions: providerFlags.runtimeOptions,
      }),
    },
  };
}

async function runAsk(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "ask");
  recordLastUsedProvider(resolveWorkspaceRoot(execution.cwd), execution.provider);
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}

async function runRescue(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "rescue");
  recordLastUsedProvider(resolveWorkspaceRoot(execution.cwd), execution.provider);
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}

function buildStopReviewGateExecution(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider"],
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals,
  });
  assertStopReviewGateProviderSupported(provider);

  const prompt = remainingPositionals.join(" ").trim();
  if (!prompt) {
    throw new Error("Missing prompt text for stop-review-gate.");
  }

  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const defaultModel = readCachedProviderModel(workspaceRoot, provider);
  return {
    options,
    execution: {
      provider,
      // This private command uses the normal review timing budget and schema,
      // but its separate kind keeps stop-time gate latency out of ordinary
      // review cohorts. It also does not record a last-used provider or expose
      // a general-purpose prompt surface.
      kind: "stop-review-gate",
      prompt,
      userPrompt: "stop-time review gate",
      model: null,
      defaultModel,
      cwd: process.cwd(),
      timeout: resolveTimeoutMs(provider, "review", { defaultModel }),
      meta: { stopReviewGate: true },
      jobMeta: {},
      measurementScope: "request",
      runtimeOptions: buildReviewRuntimeOptions({
        provider,
        cwd: process.cwd(),
      }),
    },
  };
}

async function runStopReviewGate(rawArgs) {
  const { options, execution } = buildStopReviewGateExecution(rawArgs);
  await runForegroundExecution(execution, options.json);
}

function buildReviewExecution(rawArgs, { adversarial }) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait"],
    valueOptions: ["provider", "model", "base", "scope", "max-diff-bytes"],
    aliasMap: { m: "model" },
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals,
  });
  assertReviewProviderSupported(provider);
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const focus = remainingPositionals.join(" ").trim();
  const maxDiffBytes = parseMaxDiffBytes(options["max-diff-bytes"]);
  const reviewContext = collectReviewContext({
    cwd: process.cwd(),
    scope: options.scope,
    baseRef: options.base || null,
    maxDiffBytes,
  });

  if (!reviewContext.ok) {
    throw new Error(reviewContext.error);
  }

  return {
    options,
    provider,
    reviewContext,
    execution: {
      provider,
      kind: adversarial ? "adversarial-review" : "review",
      prompt: buildReviewPrompt({
        provider,
        diff: reviewContext.diff,
        focus,
        adversarial,
        truncated: reviewContext.truncated,
        truncationNotice: reviewContext.truncationNotice,
      }),
      userPrompt: focus || `${adversarial ? "adversarial " : ""}review ${reviewContext.scope}`,
      model: options.model || null,
      defaultModel: readCachedProviderModel(workspaceRoot, provider),
      cwd: process.cwd(),
      timeout: resolveTimeoutMs(provider, adversarial ? "adversarial-review" : "review", {
        model: options.model || null,
        defaultModel: readCachedProviderModel(workspaceRoot, provider),
      }),
      meta: {
        scope: reviewContext.scope,
        baseRef: reviewContext.baseRef || null,
        truncated: reviewContext.truncated,
        truncationNotice: reviewContext.truncationNotice,
        adversarial,
        background: false,
      },
      jobMeta: {
        scope: reviewContext.scope,
        baseRef: reviewContext.baseRef || null,
        adversarial,
      },
      measurementScope: "request",
      runtimeOptions: buildReviewRuntimeOptions({
        provider,
        cwd: process.cwd(),
      }),
    },
  };
}

async function runReviewCommand(rawArgs, { adversarial }) {
  const { options, provider, reviewContext, execution } = buildReviewExecution(rawArgs, { adversarial });
  if (!reviewContext.diff.trim()) {
    try {
      const warnings = Array.isArray(reviewContext.warnings) && reviewContext.warnings.length > 0
        ? reviewContext.warnings
        : undefined;
      const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
      await recordRunEvent(workspaceRoot, {
        command: execution.kind,
        kind: execution.kind,
        provider: null,
        phase: "provider_decision",
        status: "skipped",
        reason: "no_changes",
      });
      output(
        options.json
          ? { ok: true, provider, verdict: "no_changes", scope: reviewContext.scope, warnings }
          : [
            ...(warnings ? [`Note: ${warnings.join(" | ")}`] : []),
            "No changes to review.",
          ].join("\n\n"),
        options.json
      );
      return;
    } finally {
      cleanupRuntimeOptions(execution.runtimeOptions);
    }
  }

  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}

async function runStatus(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "all", "wait"],
    valueOptions: ["timeout-ms"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const reference = positionals[0] || null;
  const timeoutMs = options.wait ? parseStatusTimeoutMs(options["timeout-ms"]) : undefined;

  if (options.wait && options.all && !reference) {
    const waited = await waitForAllJobs(workspaceRoot, {
      timeoutMs,
    });
    if (waited.waitTimedOut) {
      process.exitCode = 2;
    }
    if (options.json) {
      output(waited, true);
      return;
    }
    output(renderStatusSnapshot(waited), false);
    return;
  }

  if (options.wait) {
    const target = reference ? resolveJobReference(workspaceRoot, reference) : resolveLatestActiveJob(workspaceRoot);
    if (!target) {
      throw new Error(reference ? `Job '${reference}' not found.` : "No active job found.");
    }
    const waited = await waitForJob(workspaceRoot, target.jobId, {
      timeoutMs,
    });
    if (waited.waitTimedOut) {
      process.exitCode = 2;
    }
    if (options.json) {
      output(waited, true);
      return;
    }
    if (waited.error) {
      throw new Error(waited.error);
    }
    output(renderJobDetail(waited.job), false);
    return;
  }

  if (reference) {
    const job = resolveJobReference(workspaceRoot, reference);
    if (!job) {
      throw new Error(`Job '${reference}' not found.`);
    }
    const refreshed = refreshJob(workspaceRoot, job);
    if (options.json) {
      output({ job: refreshed }, true);
      return;
    }
    output(renderJobDetail(refreshed), false);
    return;
  }

  const snapshot = buildStatusSnapshot(workspaceRoot, { showAll: Boolean(options.all) });
  if (options.json) {
    output(snapshot, true);
    return;
  }
  output(renderStatusSnapshot(snapshot), false);
}

async function runResult(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const job = positionals[0]
    ? resolveJobReference(workspaceRoot, positionals[0])
    : resolveLatestTerminalJob(workspaceRoot);

  if (!job) {
    throw new Error(positionals[0] ? `Job '${positionals[0]}' not found.` : "No completed job found.");
  }

  const refreshed = refreshJob(workspaceRoot, job);
  if (refreshed.status === "queued" || refreshed.status === "running") {
    throw new Error(`Job '${refreshed.jobId}' is still ${refreshed.status}. Use status first.`);
  }

  const envelope = readJobFile(resolveJobFile(workspaceRoot, refreshed.jobId)) || { job: refreshed, result: refreshed.result };
  if (options.json) {
    output(buildResultPayload(envelope), true);
    return;
  }
  output(renderResultEnvelope(envelope), false);
}

async function runCancel(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const job = positionals[0]
    ? resolveJobReference(workspaceRoot, positionals[0])
    : resolveLatestActiveJob(workspaceRoot);

  if (!job) {
    if (options.json) {
      output({ cancelled: false, reason: "not_found", jobId: positionals[0] || null }, true);
      process.exitCode = 1;
      return;
    }
    output(positionals[0] ? `Job ${positionals[0]} not found.` : "No active job found to cancel.", false);
    process.exitCode = 1;
    return;
  }

  const report = await cancelJob(workspaceRoot, job.jobId);
  if (options.json) {
    output(report, true);
  } else if (report.cancelled) {
    output(`Cancelled job ${report.jobId}.`, false);
  } else if (report.reason === "not_cancellable") {
    output(`Job ${report.jobId} is already ${job.status}.`, false);
    process.exitCode = 4;
  } else {
    output(`Failed to cancel ${report.jobId}: ${report.error || report.reason}`, false);
    process.exitCode = 5;
  }
}

function formatMetric(metric) {
  if (!metric) return "n/a";
  if (metric.status === "measured" || metric.status === "zero") {
    return `${metric.ms}ms`;
  }
  return metric.status;
}

function formatCohortValue(value) {
  return value ?? "unspecified";
}

function renderTimingReport(records, aggregate) {
  if (records.length === 0) {
    return "No timing records found.";
  }

  const lines = [
    "Recent timing records:",
    ...records.map((record) => {
      const suffix = [
        `total=${formatMetric(record.metrics.total)}`,
        `ttft=${formatMetric(record.metrics.ttft)}`,
        `gen=${formatMetric(record.metrics.gen)}`,
        `tool=${formatMetric(record.metrics.tool)}`,
        `tail=${formatMetric(record.metrics.tail)}`,
      ].join(" ");
      return `- ${record.completedAt} ${record.provider} ${record.kind || "prompt"} ${record.measurementScope} ${suffix}`;
    }),
    "",
    "Comparable timing cohorts (percentiles stay within provider, kind, scope, outcome, and runtime persistence):",
  ];

  for (const cohort of aggregate.cohorts) {
    lines.push(
      `- provider=${cohort.provider} kind=${formatCohortValue(cohort.kind)} scope=${cohort.measurementScope} outcome=${formatCohortValue(cohort.outcome)} persistence=${cohort.runtimePersistence}: count=${cohort.recordCount} total.p50=${cohort.metrics.total.p50} total.p95=${cohort.metrics.total.p95}`
    );
  }

  lines.push("", "Provider summary (counts/capability only; use comparable cohorts for percentiles):");
  for (const [provider, summary] of Object.entries(aggregate.byProvider)) {
    const mixed = summary.mixedDimensions.length > 0
      ? ` mixed=${summary.mixedDimensions.join(",")}`
      : "";
    lines.push(`- ${provider}: count=${summary.recordCount} cohorts=${summary.cohortCount}${mixed}`);
  }

  return lines.join("\n");
}

function parseHistoryLimit(value, { all = false } = {}) {
  if (all) return null;
  if (value == null) return 20;
  if (String(value).toLowerCase() === "all") return null;
  if (!/^\d+$/.test(String(value))) {
    throw new Error("--history must be a non-negative integer or all.");
  }
  return Number.parseInt(value, 10);
}

function parseMaxDiffBytes(value) {
  if (value == null) return null;
  if (!/^\d+$/.test(String(value))) {
    throw new Error("--max-diff-bytes must be a non-negative integer.");
  }
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

async function runTiming(rawArgs) {
  const { options } = parseArgs(rawArgs, {
    booleanOptions: ["all", "json"],
    valueOptions: ["provider", "history"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const provider = options.provider
    ? resolveProvider({ provider: options.provider }).provider
    : null;
  const limit = parseHistoryLimit(options.history, { all: options.all });
  const records = listTimingRecords(workspaceRoot, {
    provider,
    limit,
  });
  const aggregate = summarizeTimingRecords(records);
  const metadata = {
    ...describeTimingStore(workspaceRoot),
    provider,
    historyLimit: limit == null ? "all" : limit,
    recordCount: records.length,
    aggregateScope: "records",
    percentileCohortDimensions: aggregate.cohortDimensions,
  };

  if (options.json) {
    output({ records, aggregate, metadata }, true);
    return;
  }

  output(renderTimingReport(records, aggregate), false);
}

async function runJobWorker(rawArgs) {
  const configFile = rawArgs[0];
  if (!configFile) {
    throw new Error("Missing config path for _job-worker.");
  }
  const payload = readJobConfigFile(configFile);
  if (!payload) {
    throw new Error(`Unable to read job config ${configFile}`);
  }

  const { workspaceRoot, execution, jobId, runContext } = payload;
  const current = claimBackgroundWorker(workspaceRoot, jobId);
  if (!current) {
    // The parent may have been interrupted before writing the PID and a concurrent cancellation
    // won. Treat the terminal/non-owned state as a normal no-op rather than performing a late
    // provider call for a cancelled job.
    return;
  }

  if (runContext?.runId) {
    await recordRunEventForContext(workspaceRoot, runContext, {
      command: runContext.command || execution.kind,
      kind: execution.kind,
      provider: execution.provider,
      phase: "attempt_started",
      status: "started",
      attempt: { ordinal: 1 },
      jobId,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      logFile: current.logFile || null,
    });
  }

  const startedAt = Date.now();

  try {
    const result = await runProviderPromptStreaming({
      provider: execution.provider,
      prompt: execution.prompt,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      cwd: execution.cwd,
      timeout: execution.timeout,
      kind: execution.kind,
      measurementScope: execution.measurementScope || "job",
      meta: execution.meta || null,
      ...hydrateRuntimeOptions(execution.runtimeOptions),
      onEvent(event) {
        appendPreview(current.logFile, execution.provider, event);
      },
    });

    // A terminal status promises that all durable result, timing, and ledger writes
    // are visible. Keep the job active until those writes complete so status --wait
    // cannot race consumers that inspect or remove the state directory.
    if (result.timing) {
      appendTimingRecord(workspaceRoot, result.timing);
    }
    cacheProviderModel(workspaceRoot, execution.provider, result.model);

    const compactResult = compactProviderResult(result);
    const sessionArtifactPath = resolveSessionArtifactPath(
      execution.provider,
      result.sessionId,
      execution.cwd,
    );
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || latest.status === "cancelled" || hasTerminalJobEnvelope(storedEnvelope)) {
        return null;
      }
      const finishedAt = new Date().toISOString();
      const finishedJob = {
        ...latest,
        ...execution.jobMeta,
        status: result.ok ? "completed" : "failed",
        pid: null,
        finishedAt,
        updatedAt: finishedAt,
        sessionId: result.sessionId ?? null,
        error: result.error ?? null,
      };
      const terminalReason = result.ok ? null : `${execution.kind}_failed`;
      const terminalEvents = runContext?.runId
        ? [
          {
            command: runContext.command || execution.kind,
            kind: execution.kind,
            provider: execution.provider,
            phase: "attempt_result",
            status: result.ok ? "completed" : "failed",
            reason: terminalReason,
            attempt: { ordinal: 1 },
            jobId,
            model: result.model || null,
            sessionId: result.sessionId ?? null,
            sessionArtifactPath,
            defaultModel: result.defaultModel || null,
            preview: result.response ? String(result.response).slice(0, 180) : null,
            stdoutBytes: compactResult.stdoutBytes ?? null,
            stderrBytes: compactResult.stderrBytes ?? null,
            errorCode: result.errorCode ?? result.timing?.errorCode ?? null,
            failureClass: result.errorCode ?? result.timing?.errorCode ?? null,
            durationMs: Date.now() - startedAt,
            timingRef: result.timing
              ? {
                provider: result.timing.provider,
                kind: result.timing.kind,
                completedAt: result.timing.completedAt,
              }
              : null,
            error: result.ok || !result.error
              ? null
              : { message: String(result.error).slice(0, 300) },
            logFile: finishedJob.logFile || null,
          },
          {
            command: runContext.command || execution.kind,
            kind: execution.kind,
            provider: execution.provider,
            phase: "provider_decision",
            status: result.ok ? "adopted" : "failed",
            reason: terminalReason,
            jobId,
            sessionId: result.sessionId ?? null,
            sessionArtifactPath,
          },
        ]
        : [];
      const terminal = prepareTerminalRunEventsForContext(runContext, terminalEvents);
      return {
        job: finishedJob,
        envelope: {
          job: finishedJob,
          result: compactResult,
          terminalReason,
          terminalDescriptor: terminal.terminalDescriptor,
        },
        // state.mjs writes this envelope first. A crash or ledger failure leaves a recoverable
        // intent instead of exposing a terminal state with only half of its ledger pair.
        beforeStateCommit() {
          ensureTerminalRunEventsForContext(workspaceRoot, terminal);
        },
      };
    });
    if (!write.written) {
      if (!shouldRetainJobConfig(workspaceRoot, jobId)) {
        removeJobConfigFile(workspaceRoot, jobId);
      }
      return;
    }
    removeJobConfigFile(workspaceRoot, jobId);
  } catch (error) {
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || latest.status === "cancelled" || hasTerminalJobEnvelope(storedEnvelope)) {
        return null;
      }
      const finishedAt = new Date().toISOString();
      const failedJob = {
        ...latest,
        ...execution.jobMeta,
        status: "failed",
        pid: null,
        finishedAt,
        updatedAt: finishedAt,
        error: error.message,
      };
      const terminalReason = `${execution.kind}_failed`;
      const terminalEvents = runContext?.runId
        ? [
          {
            command: runContext.command || execution.kind,
            kind: execution.kind,
            provider: execution.provider,
            phase: "attempt_result",
            status: "failed",
            reason: terminalReason,
            attempt: { ordinal: 1 },
            jobId,
            durationMs: Date.now() - startedAt,
            error: { message: String(error?.message || error).slice(0, 300) },
            logFile: failedJob.logFile || null,
          },
          {
            command: runContext.command || execution.kind,
            kind: execution.kind,
            provider: execution.provider,
            phase: "provider_decision",
            status: "failed",
            reason: terminalReason,
            jobId,
          },
        ]
        : [];
      const terminal = prepareTerminalRunEventsForContext(runContext, terminalEvents);
      return {
        job: failedJob,
        envelope: {
          job: failedJob,
          result: { ok: false, error: error.message },
          terminalReason,
          terminalDescriptor: terminal.terminalDescriptor,
        },
        beforeStateCommit() {
          ensureTerminalRunEventsForContext(workspaceRoot, terminal);
        },
      };
    });
    if (!write.written) {
      if (!shouldRetainJobConfig(workspaceRoot, jobId)) {
        removeJobConfigFile(workspaceRoot, jobId);
      }
      return;
    }
    removeJobConfigFile(workspaceRoot, jobId);
    throw error;
  } finally {
    // Cancellation deliberately keeps the public job active until its verified signal and ledger
    // transaction finish. Do not let a worker that just observed that intent remove live runtime
    // paths early; cancellation (or later recovery) owns cleanup after terminal state publication.
    if (!shouldRetainJobConfig(workspaceRoot, jobId)) {
      cleanupRuntimeOptions(execution.runtimeOptions);
    }
  }
}

function formatDebugRunsTable(runs) {
  if (runs.length === 0) return "No runs found.";
  const lines = [
    "| runId | commands | startedAt | updatedAt | adopted | skipped | failed |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const run of runs) {
    lines.push(
      `| ${run.runId} | ${run.commands.join(",")} | ${run.startedAt || ""} | ${run.updatedAt || ""} | ${run.adoptedCount} | ${run.skippedCount} | ${run.failedCount} |`,
    );
  }
  return lines.join("\n");
}

async function runDebugCommand(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
  });
  const subcommand = positionals[0] || "runs";
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  refreshJobsForLedgerRecovery(workspaceRoot);
  const events = await readRunLedgerEvents(workspaceRoot);
  const asJson = Boolean(options.json);

  if (subcommand === "runs") {
    const runs = summarizeRunLedger(events);
    if (asJson) {
      output({ ok: true, runs }, true);
      return;
    }
    output(formatDebugRunsTable(runs), false);
    return;
  }

  if (subcommand === "show") {
    const runId = positionals[1];
    if (!runId) {
      throw new Error("Missing run id for debug show.");
    }
    const runEvents = events.filter((event) => event.runId === runId);
    if (asJson) {
      output({ ok: true, runId, events: runEvents }, true);
      return;
    }
    output(JSON.stringify({ runId, events: runEvents }, null, 2), false);
    return;
  }

  if (subcommand === "explain") {
    const runId = positionals[1];
    if (!runId) {
      throw new Error("Missing run id for debug explain.");
    }
    const explanation = buildRunExplanation(events, runId);
    if (asJson) {
      output({ ok: true, ...explanation }, true);
      return;
    }
    output(explanation.text, false);
    return;
  }

  throw new Error(`Unknown subcommand 'debug ${subcommand}'.`);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "?";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function renderSessionsList(recorded, nonPurgeable = []) {
  const lines = [];
  if (recorded.length === 0) {
    lines.push("No polycli-recorded purgeable upstream sessions in this workspace.");
  } else {
    lines.push("Recorded upstream sessions (this workspace):");
    for (const rec of recorded) {
      const exists = fs.existsSync(rec.sessionArtifactPath);
      let size = "";
      if (exists) {
        try {
          size = ` ${formatBytes(fs.lstatSync(rec.sessionArtifactPath).size)}`;
        } catch {
          size = "";
        }
      }
      lines.push(`- ${rec.provider} ${rec.sessionId} ${exists ? "exists" : "missing"}${size} ${rec.sessionArtifactPath}`);
    }
  }
  if (nonPurgeable.length > 0) {
    lines.push("Tracked but not purgeable (no recorded artifact path):");
    for (const np of nonPurgeable) {
      lines.push(`- ${np.provider} ${np.sessionId} (${np.reason})`);
    }
  }
  return lines.join("\n");
}

function renderPurgePlan(plan, summary, nonPurgeable = []) {
  const lines = [];
  if (summary.confirmed) {
    lines.push(`Deleted ${summary.deleted} recorded upstream session artifact(s).`);
  } else {
    lines.push(`Dry run: ${plan.deletable.length} artifact(s) would be deleted. Re-run with --confirm to delete.`);
  }
  for (const entry of plan.deletable) {
    lines.push(`  ${summary.confirmed ? "deleted" : "would delete"}: ${entry.provider} ${entry.sessionId} ${entry.path}`);
  }
  for (const entry of plan.skipped) {
    lines.push(`  skipped: ${entry.path ?? entry.provider ?? "?"} (${entry.reason})`);
  }
  for (const np of nonPurgeable) {
    lines.push(`  not purgeable: ${np.provider} ${np.sessionId} (${np.reason})`);
  }
  if (plan.deletable.length === 0 && plan.skipped.length === 0 && nonPurgeable.length === 0) {
    lines.push("  nothing to purge.");
  }
  return lines.join("\n");
}

async function runSessionsCommand(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "confirm"],
  });
  const subcommand = positionals[0] || "list";
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const events = await readRunLedgerEvents(workspaceRoot);
  const recorded = collectRecordedArtifacts(events);
  const nonPurgeable = collectNonPurgeableSessions(events);
  const asJson = Boolean(options.json);

  if (subcommand === "list") {
    if (asJson) {
      output({ ok: true, recorded, nonPurgeable }, true);
      return;
    }
    output(renderSessionsList(recorded, nonPurgeable), false);
    return;
  }

  if (subcommand === "purge") {
    const homedir = defaultHomedir();
    const plan = planPurge({ recorded, homedir });
    const confirm = Boolean(options.confirm);
    const summary = executePurge(plan, { confirm });
    if (asJson) {
      output({ ok: true, confirmed: summary.confirmed, plan, nonPurgeable, summary }, true);
      return;
    }
    output(renderPurgePlan(plan, summary, nonPurgeable), false);
    return;
  }

  throw new Error(`Unknown subcommand 'sessions ${subcommand}'.`);
}

async function dispatchCommand(command, rawArgs) {
  if (command === "setup") return runSetup(rawArgs);
  if (command === "health") return runHealth(rawArgs);
  if (command === "ask") return runAsk(rawArgs);
  if (command === "rescue") return runRescue(rawArgs);
  if (command === "review") return runReviewCommand(rawArgs, { adversarial: false });
  if (command === "adversarial-review") return runReviewCommand(rawArgs, { adversarial: true });
  if (command === "status") return runStatus(rawArgs);
  if (command === "result") return runResult(rawArgs);
  if (command === "cancel") return runCancel(rawArgs);
  if (command === "timing") return runTiming(rawArgs);
  if (command === "debug") return runDebugCommand(rawArgs);
  if (command === "sessions") return runSessionsCommand(rawArgs);
  if (command === "_stop-review-gate") return runStopReviewGate(rawArgs);
  if (command === "_job-worker") return runJobWorker(rawArgs);
  throw new Error(`Unknown subcommand '${command}'.`);
}

async function main() {
  const fullArgs = process.argv.slice(2);
  const { argv: normalizedArgs, runId: explicitRunId } = stripRunIdArgs(fullArgs);
  const [command, ...rawArgs] = normalizedArgs;
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (hasHelpFlag(rawArgs) && command !== "_job-worker") {
    printUsage();
    return;
  }

  RUN_CONTEXT.command = command;
  RUN_CONTEXT.hostSurface = resolveHostSurface(process.env, import.meta.url);
  RUN_CONTEXT.rawArgs = fullArgs;
  RUN_CONTEXT.runId = RUN_TRACKED_COMMANDS.has(command)
    ? resolveRunId({ runId: explicitRunId }, process.env)
    : null;

  if (!RUN_CONTEXT.runId) {
    return dispatchCommand(command, rawArgs);
  }

  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  await recordRunEvent(workspaceRoot, { phase: "run_started", status: "started" });
  try {
    const result = await dispatchCommand(command, rawArgs);
    const failed = process.exitCode != null && process.exitCode !== 0;
    await recordRunEvent(workspaceRoot, {
      phase: "run_summary",
      status: failed ? "failed" : "completed",
    });
    return result;
  } catch (error) {
    await recordRunEvent(workspaceRoot, {
      phase: "run_summary",
      status: "failed",
      error: { message: String(error?.message || error).slice(0, 300) },
    });
    throw error;
  }
}

main().catch((error) => {
  exitWithError({
    message: error.message,
    asJson: wantsJson(process.argv.slice(2)),
    exitCode: process.exitCode || 1,
  });
});
