#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { parseArgs } from "@bbingz/polycli-utils/args";
import { withLockfile, writeJsonAtomic } from "@bbingz/polycli-utils/atomic-save";
import {
  describeProviderRuntimes,
  getProviderRuntime,
  listProviderRuntimes,
  runProviderPromptStreaming,
} from "@bbingz/polycli-runtime";

import {
  COMMAND_SURFACE_VERSION,
  ERROR_DEFINITIONS,
  OUTPUT_SCHEMA_DEFINITIONS,
  assertCommandRegistry,
  getCommandDefinition,
  listCommandDefinitions,
  parseCommandArgs,
  renderCommandHelp,
  renderRootHelp,
  resolveCommandPath,
  suggestFromCandidates,
} from "./lib/command-registry.mjs";

import {
  buildStatusSnapshot,
  cancelJob,
  hasPendingCancellationIntent,
  refreshJob,
  refreshJobsForLedgerRecovery,
  resolveJobSelector,
  waitForJob,
} from "./lib/job-control.mjs";
import { startBackgroundWorker } from "./lib/background-start.mjs";
import { buildPromptRuntimeOptions } from "./lib/prompt-runtime.mjs";
import { PROVIDER_IDS, resolveProvider } from "./lib/providers.mjs";
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
  removeJobStartFailureFile,
  resolveJobConfigFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveWorkspaceRoot,
  computeWorkspaceSlug,
  getConfig,
  setConfig,
  updateJobAtomically,
  upsertJob,
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
  tailRunLedgerEvents,
} from "./lib/run-ledger.mjs";
import {
  PolycliCliError,
  createV2ErrorEnvelope,
  createV2SuccessEnvelope,
  serializeV2Result,
} from "./lib/cli-contract.mjs";
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
const BUILD_VERSION = typeof __POLYCLI_VERSION__ === "string" ? __POLYCLI_VERSION__ : "0.0.0-dev";
const BUILD_VERSION_SOURCE = typeof __POLYCLI_VERSION__ === "string" ? "bundled-release" : "development";
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
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

const RUN_CONTEXT = {
  invocationId: null,
  runId: null,
  command: null,
  hostSurface: "unknown",
  rawArgs: [],
  outputMode: "text",
  background: false,
  authoritativeJsonWritten: false,
  workspaceSlug: null,
};

function createAttemptId() {
  return `att_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function buildCurrentRunContext(overrides = {}) {
  if (!RUN_CONTEXT.runId) return null;
  const command = overrides.command || RUN_CONTEXT.command;
  return {
    version: 2,
    runId: RUN_CONTEXT.runId,
    invocationId: RUN_CONTEXT.invocationId,
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
    invocationId: runContext.invocationId ?? null,
    attemptId: runContext.attemptId ?? null,
    jobId: runContext.jobId ?? null,
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

function blocksBackgroundWorkerCommit(envelope) {
  return hasTerminalJobEnvelope(envelope) || hasPendingCancellationIntent(envelope);
}

function claimBackgroundWorker(workspaceRoot, jobId) {
  const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
    // The worker claims its own PID before it records any provider-facing event or invokes a
    // provider. This closes the parent spawn -> state-PID crash window: if cancellation won that
    // race, its terminal envelope makes this worker exit without doing work.
    if (!latest || !ACTIVE_JOB_STATUSES.has(latest.status) || blocksBackgroundWorkerCommit(storedEnvelope)) {
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

function printUsage(hostSurface = "unknown") {
  console.log(renderRootHelp({ hostSurface }));
}

function cliError(code, message, data = {}, exitCode = 1) {
  const error = new Error(message);
  error.code = code;
  error.data = data;
  error.exitCode = exitCode;
  return error;
}

function scanOutputModes(args = []) {
  let json = false;
  let jsonV2 = false;
  for (const argument of args) {
    if (argument === "--") break;
    if (argument === "--json" || argument === "--json=true") json = true;
    if (argument === "--json-v2" || argument === "--json-v2=true") jsonV2 = true;
  }
  return { json, jsonV2, conflict: json && jsonV2 };
}

function adaptArgsForLegacyHandler(args = []) {
  const v2Enabled = scanOutputModes(args).jsonV2;
  const adapted = [];
  let passthrough = false;
  let legacyJsonInjected = false;
  for (const argument of args) {
    if (passthrough) {
      adapted.push(argument);
      continue;
    }
    if (argument === "--") {
      if (v2Enabled && !legacyJsonInjected) {
        adapted.push("--json");
        legacyJsonInjected = true;
      }
      passthrough = true;
      adapted.push(argument);
      continue;
    }
    if (v2Enabled && (
      argument === "--json"
      || argument === "--json=true"
      || argument === "--json=false"
      || argument === "--json-v2"
      || argument === "--json-v2=true"
      || argument === "--json-v2=false"
    )) {
      continue;
    }
    if (argument === "--json-v2=false") continue;
    if (argument === "--help=false" || argument === "-h=false") continue;
    adapted.push(argument);
  }
  if (v2Enabled && !legacyJsonInjected) adapted.push("--json");
  return adapted;
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

function toTypedCliError(error) {
  let candidate = error;
  if (!(error instanceof PolycliCliError) && !error?.code) {
    const classified = classifyErrorCode(error?.message || "");
    if (classified !== "error") {
      const typedCode = classified === "invalid_history" || classified === "invalid_max_diff_bytes"
        ? "invalid_argument"
        : classified;
      candidate = cliError(typedCode, error.message, error.data || {}, error.exitCode || 1);
    }
  }
  const typed = PolycliCliError.from(candidate);
  if (typed.code === "internal_error" || typed.nextSteps.length > 0 || !RUN_CONTEXT.command) {
    return typed;
  }
  const definition = getCommandDefinition(RUN_CONTEXT.command.split("."));
  return new PolycliCliError({
    code: typed.code,
    message: typed.message,
    exitCode: typed.exitCode,
    data: typed.data,
    nextSteps: definition?.visibility === "public"
      ? [`Run \`polycli ${definition.path.join(" ")} --help\`.`]
      : [],
  });
}

function assertPreDispatchReviewSafety(definition, parsed) {
  if (!definition || !["review", "adversarial-review"].includes(definition.id)) return;
  const explicitProvider = parsed.options.provider
    || (PROVIDER_IDS.includes(parsed.positionals[0]) ? parsed.positionals[0] : null);
  if (!explicitProvider) return;
  const descriptor = describeProviderRuntimes().find((entry) => entry.id === explicitProvider);
  if (descriptor?.reviewSafety?.mode !== "unsupported") return;
  let message = `Provider '${explicitProvider}' does not support review.`;
  try {
    assertReviewProviderSupported(explicitProvider);
  } catch (error) {
    message = error.message;
  }
  const error = cliError("invalid_argument", message, {
    provider: explicitProvider,
    reviewSafety: "unsupported",
  });
  error.legacyCode = "error";
  throw error;
}

function exitWithError(error) {
  const typed = toTypedCliError(error);
  if (RUN_CONTEXT.outputMode === "json-v2") {
    process.stdout.write(`${JSON.stringify(createV2ErrorEnvelope(typed, {
      invocationId: RUN_CONTEXT.invocationId,
      command: RUN_CONTEXT.command || process.argv[2] || "",
      hostSurface: RUN_CONTEXT.hostSurface,
      workspaceSlug: RUN_CONTEXT.workspaceSlug,
      runId: RUN_CONTEXT.runId,
      jobId: typeof typed.data?.jobId === "string" ? typed.data.jobId : null,
    }), null, 2)}\n`);
  } else if (RUN_CONTEXT.outputMode === "legacy-json") {
    const code = error?.legacyCode || error?.code || classifyErrorCode(error?.message || "");
    const legacyCode = code === "unknown_command" ? "unknown_subcommand" : code;
    process.stdout.write(`${JSON.stringify({ error: typed.message, code: legacyCode }, null, 2)}\n`);
  } else {
    process.stderr.write(`Error: ${typed.message}\n`);
    for (const suggestion of typed.data?.suggestions || []) {
      process.stderr.write(`Suggestion: ${suggestion}\n`);
    }
    for (const step of typed.nextSteps) process.stderr.write(`${step}\n`);
  }
  process.exitCode = typed.exitCode || error?.exitCode || 1;
}

function output(value, asJson) {
  if (RUN_CONTEXT.outputMode === "json-v2") {
    const result = serializeV2Result(RUN_CONTEXT.command, value, {
      background: RUN_CONTEXT.background,
      wait: value?.wait ?? (Object.prototype.hasOwnProperty.call(value || {}, "waitTimedOut") ? true : null),
    });
    const envelope = createV2SuccessEnvelope(result, {
      invocationId: RUN_CONTEXT.invocationId,
      command: RUN_CONTEXT.command,
      hostSurface: RUN_CONTEXT.hostSurface,
      workspaceSlug: RUN_CONTEXT.workspaceSlug,
      runId: RUN_CONTEXT.runId,
      jobId: result.job?.jobId ?? result.jobId ?? null,
    });
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    RUN_CONTEXT.authoritativeJsonWritten = true;
    return;
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    RUN_CONTEXT.authoritativeJsonWritten = true;
    return;
  }
  process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

function buildAgentContext(hostSurface) {
  const commands = listCommandDefinitions({ hostSurface }).map((entry) => ({
    ...entry,
    options: entry.options.filter((option) => option.visibility !== "internal"),
  }));
  const exitCodes = Array.from(new Set([
    0,
    ...commands.flatMap((entry) => entry.exitCodes),
    ...ERROR_DEFINITIONS.map((entry) => entry.exitCode),
  ])).sort((left, right) => left - right);
  return {
    schemaVersion: 1,
    commandSurfaceVersion: COMMAND_SURFACE_VERSION,
    build: {
      version: BUILD_VERSION,
      versionSource: BUILD_VERSION_SOURCE,
      nodeMinimum: "20",
    },
    hostSurface,
    offline: true,
    commands,
    providers: describeProviderRuntimes(),
    outputSchemas: OUTPUT_SCHEMA_DEFINITIONS,
    errors: ERROR_DEFINITIONS,
    exitCodes,
    features: {
      legacyJson: true,
      jsonEnvelopeV2: true,
      ledgerCursor: true,
      skillsDiscovery: false,
      workflowRuntime: false,
    },
    compatibility: {
      legacyJobSessionId: {
        field: "sessionId",
        semantics: "ambiguous",
        deprecated: true,
        replacements: ["hostSessionId", "providerSessionId"],
      },
    },
  };
}

async function runAgentContext(rawArgs) {
  const { options } = parseArgs(rawArgs, { booleanOptions: ["json"] });
  const context = buildAgentContext(RUN_CONTEXT.hostSurface);
  if (options.json) {
    output(context, true);
    return;
  }
  output(
    [
      `Polycli ${context.build.version} command surface v${context.commandSurfaceVersion}`,
      `Host surface: ${context.hostSurface}`,
      `Commands: ${context.commands.filter((entry) => entry.path.length === 1).length}`,
      `Providers: ${context.providers.length}`,
      "Run `polycli agent-context --json` for the complete offline contract.",
    ].join("\n"),
    false,
  );
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

async function inspectSetupProvider(provider, { probeAuth, workspaceRoot }) {
  const attemptId = createAttemptId();
  const runContext = buildCurrentRunContext({
    command: "setup",
    kind: "setup",
    provider,
    attemptId,
  });
  await recordRunEventForContext(workspaceRoot, runContext, {
    command: "setup",
    kind: "setup",
    provider,
    phase: "attempt_started",
    status: "started",
    attempt: { ordinal: 1 },
  });

  let row = null;
  let inspectionError = null;
  try {
    row = await inspectProvider(provider, { probeAuth });
  } catch (error) {
    inspectionError = error;
  }

  const reason = inspectionError ? "setup_probe_failed" : "setup_probe_completed";
  const terminal = prepareTerminalRunEventsForContext(runContext, [
    {
      command: "setup",
      kind: "setup",
      provider,
      phase: "attempt_result",
      status: inspectionError ? "failed" : "completed",
      reason,
      attempt: { ordinal: 1 },
      model: row?.model ?? null,
      errorCode: inspectionError ? "provider_failed" : null,
      failureClass: inspectionError ? "provider_failed" : null,
      error: inspectionError
        ? { message: String(inspectionError.message || inspectionError).slice(0, 300) }
        : null,
    },
    {
      command: "setup",
      kind: "setup",
      provider,
      phase: "provider_decision",
      status: inspectionError ? "failed" : "adopted",
      reason,
    },
  ]);
  try {
    ensureTerminalRunEventsForContext(workspaceRoot, terminal);
  } catch {
    throw cliError(
      "ledger_persist_failed",
      "Failed to persist setup attempt ledger events. Provider work may have occurred, but durable finalization is unverified.",
      { runId: runContext?.runId ?? null, invocationId: runContext?.invocationId ?? null, attemptId },
    );
  }
  if (inspectionError) {
    const error = cliError(
      "provider_failed",
      String(inspectionError.message || inspectionError).slice(0, 500),
      { provider, kind: "setup" },
    );
    error.legacyCode = "error";
    throw error;
  }
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
  const attemptId = createAttemptId();
  const runContext = buildCurrentRunContext({
    command: execution.kind,
    kind: execution.kind,
    provider: execution.provider,
    attemptId,
    model: execution.model || null,
    defaultModel: execution.defaultModel || null,
  });
  await recordRunEventForContext(workspaceRoot, runContext, {
    command: execution.kind,
    kind: execution.kind,
    provider: execution.provider,
    phase: "attempt_started",
    status: "started",
    attempt: { ordinal: 1 },
  });

  const startedAt = Date.now();
  let result = null;
  let executionError = null;
  let sessionArtifactPath = null;
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
    emitRuntimeWarnings(result);
    if (result.timing) {
      appendTimingRecord(workspaceRoot, result.timing);
    }
    cacheProviderModel(workspaceRoot, execution.provider, result.model);
    sessionArtifactPath = resolveSessionArtifactPath(
      execution.provider,
      result.sessionId,
      execution.cwd,
    );
  } catch (error) {
    executionError = error;
  } finally {
    cleanupRuntimeOptions(execution.runtimeOptions);
  }

  const resultOk = Boolean(result?.ok) && !executionError;
  const publicError = executionError?.message || result?.error || null;
  const terminalReason = resultOk ? null : `${execution.kind}_failed`;
  const terminalErrorCode = executionError
    ? "provider_failed"
    : (result?.errorCode ?? result?.timing?.errorCode ?? null);
  const terminal = prepareTerminalRunEventsForContext(runContext, [
    {
      command: execution.kind,
      kind: execution.kind,
      provider: execution.provider,
      phase: "attempt_result",
      status: resultOk ? "completed" : "failed",
      reason: terminalReason,
      attempt: { ordinal: 1 },
      model: result?.model || null,
      providerSessionId: result?.sessionId ?? null,
      sessionArtifactPath,
      defaultModel: result?.defaultModel || null,
      preview: result?.response ? String(result.response).slice(0, 180) : null,
      stdoutBytes: result?.stdoutBytes ?? null,
      stderrBytes: result?.stderrBytes ?? null,
      durationMs: Date.now() - startedAt,
      errorCode: terminalErrorCode,
      failureClass: terminalErrorCode,
      timingRef: result?.timing
        ? {
          provider: result.timing.provider,
          kind: result.timing.kind,
          completedAt: result.timing.completedAt,
        }
        : null,
      error: publicError ? { message: String(publicError).slice(0, 300) } : null,
    },
    {
      command: execution.kind,
      kind: execution.kind,
      provider: execution.provider,
      phase: "provider_decision",
      status: resultOk ? "adopted" : "failed",
      reason: terminalReason,
      providerSessionId: result?.sessionId ?? null,
      sessionArtifactPath,
    },
  ]);
  try {
    ensureTerminalRunEventsForContext(workspaceRoot, terminal);
  } catch {
    throw cliError(
      "ledger_persist_failed",
      "Failed to persist terminal ledger events. Provider work may have occurred, but durable finalization is unverified.",
      { runId: runContext?.runId ?? null, invocationId: runContext?.invocationId ?? null, attemptId },
    );
  }

  if (executionError) {
    const error = cliError(
      terminalErrorCode === "ledger_persist_failed" ? terminalErrorCode : "provider_failed",
      String(executionError.message || executionError).slice(0, 500),
      { provider: execution.provider, kind: execution.kind },
    );
    error.legacyCode = "error";
    throw error;
  }

  const envelope = buildExecutionEnvelope(execution, result);
  if (asJson) {
    output(envelope, true);
    return;
  }

  if (!result.ok) {
    process.stderr.write(`Error: ${String(result.error || `${execution.provider} ${execution.kind} failed`).slice(0, 500)}\n`);
    process.exitCode = 1;
    return;
  }

  const lines = [];
  if (execution.meta?.truncationNotice) {
    lines.push(execution.meta.truncationNotice);
  }
  lines.push(result.response);
  output(lines.join("\n\n"), false);
}

function buildQueuedJob(execution, workspaceRoot, attemptId) {
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
    invocationId: RUN_CONTEXT.invocationId,
    attemptId,
    hostSessionId: process.env[SESSION_ID_ENV] || null,
    providerSessionId: null,
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
  const visibleSessionId = job.providerSessionId || job.hostSessionId || job.sessionId;
  if (visibleSessionId) lines.push(`Session: ${visibleSessionId}`);
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
  const visibleSessionId = envelope.job.providerSessionId || envelope.job.hostSessionId || envelope.job.sessionId;
  if (visibleSessionId) lines.push(`Session: ${visibleSessionId}`);
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
      invocationId: job.invocationId ?? null,
      attemptId: job.attemptId ?? null,
      hostSessionId: job.hostSessionId ?? null,
      providerSessionId: job.providerSessionId ?? null,
      sessionId: job.sessionId ?? null,
      error: job.error ?? null,
    },
  };
}

async function startBackgroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  const attemptId = createAttemptId();
  const job = buildQueuedJob(execution, workspaceRoot, attemptId);
  upsertJob(workspaceRoot, job);
  const runContext = buildCurrentRunContext({
    command: execution.kind,
    jobId: job.jobId,
    provider: execution.provider,
    kind: execution.kind,
    attemptId,
    model: execution.model || null,
    defaultModel: execution.defaultModel || null,
    logFile: job.logFile,
  });
  const config = {
    workspaceRoot,
    hostSessionId: job.hostSessionId,
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
  };
  const { child } = await startBackgroundWorker({
    workspaceRoot,
    job,
    execution,
    runContext,
    config,
    companionPath: COMPANION_PATH,
    env: process.env,
  });

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
      ...(await inspectSetupProvider(provider, {
        probeAuth: Boolean(options["probe-auth"]),
        workspaceRoot,
      })),
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
  let providerSessionId = null;
  let inspection;
  try {
    inspection = await inspectProviderAvailability(provider);
  } catch (error) {
    const runtime = getProviderRuntime(provider);
    const detail = String(error?.message || error).slice(0, 300);
    inspection = {
      provider,
      available: false,
      availabilityDetail: detail,
      loggedIn: null,
      authState: "unknown",
      authChecked: false,
      authProbeCost: normalizeAuthProbeCost(runtime),
      authDetail: "not checked because the availability probe failed",
      model: null,
      capabilities: runtime.capabilities,
    };
  }
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
      providerSessionId = result.sessionId ?? null;
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

  Object.defineProperty(report, "_providerSessionId", {
    value: providerSessionId,
    enumerable: false,
  });
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

  const results = await Promise.all(providers.map(async (provider) => {
    const attemptId = createAttemptId();
    const runContext = buildCurrentRunContext({
      command: "health",
      kind: "health",
      provider,
      attemptId,
      model: options.model || null,
    });
    await recordRunEventForContext(workspaceRoot, runContext, {
      command: "health",
      kind: "health",
      provider,
      phase: "attempt_started",
      status: "started",
      attempt: { ordinal: 1 },
      model: options.model || null,
    });
    const report = await probeProviderHealth({
      provider,
      model: options.model || null,
      timeout,
      workspaceRoot,
    });
    const providerResultOk = report.probe?.ok === true;
    const terminalReason = providerResultOk ? null : "health_probe_failed";
    const terminal = prepareTerminalRunEventsForContext(runContext, [
      {
        command: "health",
        kind: "health",
        provider,
        phase: "attempt_result",
        status: providerResultOk ? "completed" : "failed",
        reason: terminalReason,
        attempt: { ordinal: 1 },
        model: report.model || null,
        providerSessionId: report._providerSessionId,
        preview: report.probe?.responsePreview || null,
        errorCode: providerResultOk ? null : "health_failed",
        failureClass: providerResultOk ? null : "health_failed",
        error: report.probe?.error
          ? { message: String(report.probe.error).slice(0, 300) }
          : null,
      },
      {
        command: "health",
        kind: "health",
        provider,
        phase: "provider_decision",
        status: report.ok ? "passed" : "skipped",
        reason: report.ok ? "health_passed" : "health_failed",
        providerSessionId: report._providerSessionId,
      },
    ]);
    try {
      ensureTerminalRunEventsForContext(workspaceRoot, terminal);
    } catch {
      throw cliError(
        "ledger_persist_failed",
        "Failed to persist health attempt ledger events. Provider work may have occurred, but durable finalization is unverified.",
        { runId: runContext?.runId ?? null, invocationId: runContext?.invocationId ?? null, attemptId },
      );
    }
    try {
      await recordRunEventForContext(workspaceRoot, runContext, {
        command: "health",
        kind: "health",
        provider,
        phase: "health_result",
        status: report.ok ? "passed" : "failed",
        reason: report.ok ? "health_passed" : "health_failed",
        model: report.model || null,
        providerSessionId: report._providerSessionId,
        preview: report.probe?.responsePreview || null,
        error: report.probe?.error
          ? { message: String(report.probe.error).slice(0, 300) }
          : null,
      });
    } catch {
      // health_result is a compatibility projection. The atomic attempt_result +
      // provider_decision pair above is the authoritative terminal record.
    }
    return report;
  }));

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
    const argument = options.base ? "--base" : "--scope";
    const error = cliError(
      "invalid_argument",
      options.base
        ? `Unable to resolve review base '${String(options.base).slice(0, 200)}'.`
        : "Unable to collect the requested review diff.",
      {
        argument,
        value: options.base || options.scope || "auto",
        scope: options.scope || "auto",
      },
    );
    error.legacyCode = "error";
    throw error;
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
    valueOptions: ["job", "for", "timeout-ms"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const reference = options.job || positionals[0] || null;
  const selectorOptions = options.job ? { grammar: "explicit" } : undefined;
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
    const target = resolveJobSelector(workspaceRoot, reference || "latest-active", selectorOptions);
    const waited = await waitForJob(workspaceRoot, target.jobId, {
      timeoutMs,
      for: options.for || "terminal",
    });
    if (waited.waitTimedOut) {
      process.exitCode = 2;
    }
    if (waited.error && RUN_CONTEXT.outputMode === "json-v2") {
      throw cliError("job_not_found", `Job '${target.jobId}' was not found while waiting.`, {
        jobId: target.jobId,
      });
    }
    if (options.json) {
      output(waited, true);
      return;
    }
    if (waited.error) {
      throw cliError("job_not_found", `Job '${target.jobId}' was not found while waiting.`, {
        jobId: target.jobId,
      });
    }
    output(renderJobDetail(waited.job), false);
    return;
  }

  if (reference) {
    const job = resolveJobSelector(workspaceRoot, reference, selectorOptions);
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
    valueOptions: ["job"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const job = resolveJobSelector(
    workspaceRoot,
    options.job || positionals[0] || "latest-terminal",
    options.job ? { grammar: "explicit" } : undefined,
  );

  const refreshed = refreshJob(workspaceRoot, job);
  if (refreshed.status === "queued" || refreshed.status === "running") {
    const error = cliError(
      "no_completed_job",
      `Job '${refreshed.jobId}' is still ${refreshed.status}. Use status first.`,
      { jobId: refreshed.jobId, status: refreshed.status },
    );
    error.legacyCode = "error";
    throw error;
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
    valueOptions: ["job"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const selector = options.job || positionals[0] || "latest-active";
  let job;
  try {
    job = resolveJobSelector(workspaceRoot, selector, options.job ? { grammar: "explicit" } : undefined);
  } catch (error) {
    if (RUN_CONTEXT.outputMode === "json-v2" || error.code === "ambiguous_selector") throw error;
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
  if (RUN_CONTEXT.outputMode === "json-v2") {
    if (report.cancelled) {
      output(report, true);
      return;
    }
    if (report.reason === "not_cancellable") {
      output(report, true);
      process.exitCode = 4;
      return;
    }
    throw new PolycliCliError({
      code: report.reason === "worker_identity_unverified"
        ? "worker_identity_unverified"
        : "cancel_failed",
      message: `Failed to cancel ${report.jobId}: ${report.error || report.reason}`,
      exitCode: 5,
      data: { jobId: report.jobId, reason: report.reason },
    });
  }
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
    if (!shouldRetainJobConfig(workspaceRoot, jobId)) {
      removeJobConfigFile(workspaceRoot, jobId);
      removeJobStartFailureFile(workspaceRoot, jobId);
    }
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

    const compactResult = compactProviderResult(result);
    const sessionArtifactPath = resolveSessionArtifactPath(
      execution.provider,
      result.sessionId,
      execution.cwd,
    );
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || latest.status === "cancelled" || blocksBackgroundWorkerCommit(storedEnvelope)) {
        return null;
      }
      // The state lock makes this the finalize-vs-cancel winner checkpoint. Only after the worker
      // wins may it commit provider-derived timing/model side effects; if cancellation intent won,
      // this callback returns without publishing any late provider material.
      if (result.timing) {
        appendTimingRecord(workspaceRoot, result.timing);
      }
      cacheProviderModel(workspaceRoot, execution.provider, result.model);

      const finishedAt = new Date().toISOString();
      const finishedJob = {
        ...latest,
        ...execution.jobMeta,
        status: result.ok ? "completed" : "failed",
        pid: null,
        finishedAt,
        updatedAt: finishedAt,
        providerSessionId: result.sessionId ?? null,
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
            providerSessionId: result.sessionId ?? null,
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
            providerSessionId: result.sessionId ?? null,
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
        removeJobStartFailureFile(workspaceRoot, jobId);
      }
      return;
    }
    removeJobConfigFile(workspaceRoot, jobId);
    removeJobStartFailureFile(workspaceRoot, jobId);
  } catch (error) {
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || latest.status === "cancelled" || blocksBackgroundWorkerCommit(storedEnvelope)) {
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
        removeJobStartFailureFile(workspaceRoot, jobId);
      }
      return;
    }
    removeJobConfigFile(workspaceRoot, jobId);
    removeJobStartFailureFile(workspaceRoot, jobId);
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

async function readDebugLedger({ raw = false } = {}) {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  refreshJobsForLedgerRecovery(workspaceRoot);
  const events = await readRunLedgerEvents(workspaceRoot, { raw });
  return { workspaceRoot, events };
}

async function runDebugTail(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "wait"],
    valueOptions: ["after", "limit", "timeout-ms"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const result = await tailRunLedgerEvents(workspaceRoot, {
    runId: positionals[0] || null,
    after: options.after || null,
    limit: options.limit == null ? undefined : Number(options.limit),
    wait: Boolean(options.wait),
    timeoutMs: options["timeout-ms"] == null ? undefined : Number(options["timeout-ms"]),
  });
  if (result.waitTimedOut) process.exitCode = 2;
  if (options.json) {
    output(result, true);
    return;
  }
  output(JSON.stringify(result, null, 2), false);
}

async function runDebugRuns(rawArgs) {
  const { options } = parseArgs(rawArgs, { booleanOptions: ["json"] });
  const { events } = await readDebugLedger();
  const runs = summarizeRunLedger(events);
  if (options.json) {
    output({ ok: true, runs }, true);
    return;
  }
  output(formatDebugRunsTable(runs), false);
}

async function runDebugShow(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, { booleanOptions: ["json"] });
  const runId = positionals[0];
  if (!runId) throw cliError("invalid_argument", "Missing run id for debug show.");
  const { events } = await readDebugLedger({ raw: RUN_CONTEXT.outputMode !== "json-v2" });
  const runEvents = events.filter((event) => event.runId === runId);
  if (options.json) {
    output({ ok: true, runId, events: runEvents }, true);
    return;
  }
  output(JSON.stringify({ runId, events: runEvents }, null, 2), false);
}

async function runDebugExplain(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, { booleanOptions: ["json"] });
  const runId = positionals[0];
  if (!runId) throw cliError("invalid_argument", "Missing run id for debug explain.");
  const { events } = await readDebugLedger();
  const explanation = buildRunExplanation(events, runId);
  if (options.json) {
    output({ ok: true, ...explanation }, true);
    return;
  }
  output(explanation.text, false);
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

async function readSessionLedger() {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const events = await readRunLedgerEvents(workspaceRoot);
  const recorded = collectRecordedArtifacts(events);
  const nonPurgeable = collectNonPurgeableSessions(events);
  return { recorded, nonPurgeable };
}

async function runSessionsList(rawArgs) {
  const { options } = parseArgs(rawArgs, { booleanOptions: ["json"] });
  const { recorded, nonPurgeable } = await readSessionLedger();
  if (options.json) {
    output({ ok: true, recorded, nonPurgeable }, true);
    return;
  }
  output(renderSessionsList(recorded, nonPurgeable), false);
}

async function runSessionsPurge(rawArgs) {
  const { options } = parseArgs(rawArgs, { booleanOptions: ["json", "confirm"] });
  const { recorded, nonPurgeable } = await readSessionLedger();
  const homedir = defaultHomedir();
  const plan = planPurge({ recorded, homedir });
  const confirm = Boolean(options.confirm);
  const summary = executePurge(plan, { confirm });
  if (options.json) {
    output({ ok: true, confirmed: summary.confirmed, plan, nonPurgeable, summary }, true);
    return;
  }
  output(renderPurgePlan(plan, summary, nonPurgeable), false);
}

const COMMAND_HANDLERS = Object.freeze({
  setup: runSetup,
  health: runHealth,
  ask: runAsk,
  rescue: runRescue,
  review: (args) => runReviewCommand(args, { adversarial: false }),
  "adversarial-review": (args) => runReviewCommand(args, { adversarial: true }),
  status: runStatus,
  result: runResult,
  cancel: runCancel,
  timing: runTiming,
  "debug.runs": runDebugRuns,
  "debug.show": runDebugShow,
  "debug.explain": runDebugExplain,
  "debug.tail": runDebugTail,
  "sessions.list": runSessionsList,
  "sessions.purge": runSessionsPurge,
  "agent-context": runAgentContext,
  "_stop-review-gate": runStopReviewGate,
  "_job-worker": runJobWorker,
});

assertCommandRegistry({ handlerIds: Object.keys(COMMAND_HANDLERS) });

async function dispatchCommand(commandId, rawArgs) {
  const handler = COMMAND_HANDLERS[commandId];
  if (!handler) throw cliError("unknown_command", `Unknown command '${commandId}'.`);
  return handler(rawArgs);
}

function commandResolutionError(fullArgs, resolution, hostSurface) {
  if (!resolution) {
    const argument = fullArgs[0] || "";
    const validCommands = listCommandDefinitions({ hostSurface, topLevelOnly: true })
      .map((entry) => entry.path[0]);
    const suggestions = suggestFromCandidates(argument, validCommands);
    return cliError(
      "unknown_command",
      `Unknown command '${argument}'.${suggestions.length ? ` Did you mean ${suggestions.join(" or ")}?` : ""}`,
      { argument, validCommands, suggestions },
    );
  }
  const { definition, args } = resolution;
  if (definition.executable) return null;
  if (args[0] === "--help" || args[0] === "-h") return null;
  const argument = args[0] || "";
  const validSubcommands = listCommandDefinitions({ hostSurface })
    .filter((entry) => entry.path.length === definition.path.length + 1
      && definition.path.every((part, index) => entry.path[index] === part))
    .map((entry) => entry.path.at(-1));
  const suggestions = suggestFromCandidates(argument, validSubcommands);
  return cliError(
    "unknown_subcommand",
    `Unknown subcommand '${[...definition.path, argument].filter(Boolean).join(" ")}'.${suggestions.length ? ` Did you mean ${suggestions.join(" or ")}?` : ""}`,
    { command: definition.path, argument, validSubcommands, suggestions },
  );
}

async function main() {
  const fullArgs = process.argv.slice(2);
  RUN_CONTEXT.invocationId = `inv_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  RUN_CONTEXT.authoritativeJsonWritten = false;
  RUN_CONTEXT.hostSurface = resolveHostSurface(process.env, import.meta.url);
  RUN_CONTEXT.rawArgs = fullArgs;
  const outputModes = scanOutputModes(fullArgs);
  const command = fullArgs[0];
  const implicitLegacyJson = command === "setup"
    && RUN_CONTEXT.hostSurface === "claude-plugin"
    && !outputModes.json
    && !outputModes.jsonV2;
  RUN_CONTEXT.outputMode = outputModes.jsonV2
    ? "json-v2"
    : ((outputModes.json || implicitLegacyJson) ? "legacy-json" : "text");

  RUN_CONTEXT.command = command || null;
  if (outputModes.conflict) {
    throw cliError(
      "invalid_argument",
      "Options --json and --json-v2 cannot be used together.",
      { argument: "--json-v2", conflictsWith: "--json" },
    );
  }
  if (!command || command === "--help" || command === "-h") {
    printUsage(RUN_CONTEXT.hostSurface);
    return;
  }

  const resolution = resolveCommandPath(fullArgs, {
    hostSurface: RUN_CONTEXT.hostSurface,
    includeInternal: true,
  });
  const resolutionError = commandResolutionError(fullArgs, resolution, RUN_CONTEXT.hostSurface);
  if (resolutionError) throw resolutionError;
  const { definition } = resolution;
  RUN_CONTEXT.command = definition.id;
  const parsed = parseCommandArgs(definition, resolution.args, {
    enumSources: { providers: PROVIDER_IDS },
  });
  RUN_CONTEXT.background = parsed.options.background === true;
  if (parsed.options.help && definition.visibility !== "internal") {
    console.log(renderCommandHelp(definition));
    return;
  }

  assertPreDispatchReviewSafety(definition, parsed);

  const adaptedArgs = adaptArgsForLegacyHandler(resolution.args);
  if (implicitLegacyJson) adaptedArgs.push("--json");
  const { argv: rawArgs, runId: explicitRunId } = stripRunIdArgs(adaptedArgs);
  if (definition.id === "agent-context") {
    RUN_CONTEXT.runId = null;
    RUN_CONTEXT.workspaceSlug = null;
    return dispatchCommand(definition.id, rawArgs);
  }
  if (definition.runTracked) {
    try {
      RUN_CONTEXT.runId = resolveRunId({ runId: explicitRunId }, process.env);
    } catch (error) {
      if (!/^Invalid run id:/.test(error?.message || "")) throw error;
      const typed = cliError("invalid_argument", error.message, {
        argument: "--run-id",
        value: explicitRunId || process.env.POLYCLI_RUN_ID || null,
      });
      typed.legacyCode = "error";
      throw typed;
    }
  } else {
    RUN_CONTEXT.runId = null;
  }
  RUN_CONTEXT.workspaceSlug = computeWorkspaceSlug(resolveWorkspaceRoot(process.cwd()));

  if (!RUN_CONTEXT.runId) {
    return dispatchCommand(definition.id, rawArgs);
  }

  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  await recordRunEvent(workspaceRoot, { phase: "run_started", status: "started" });
  try {
    const result = await dispatchCommand(definition.id, rawArgs);
    const failed = process.exitCode != null && process.exitCode !== 0;
    try {
      await recordRunEvent(workspaceRoot, {
        phase: "run_summary",
        status: failed ? "failed" : "completed",
      });
    } catch (summaryError) {
      if (!RUN_CONTEXT.authoritativeJsonWritten) throw summaryError;
    }
    return result;
  } catch (error) {
    try {
      await recordRunEvent(workspaceRoot, {
        phase: "run_summary",
        status: "failed",
        error: { message: String(error?.message || error).slice(0, 300) },
      });
    } catch (summaryError) {
      if (error?.code !== "ledger_persist_failed") throw summaryError;
    }
    throw error;
  }
}

main().catch((error) => {
  exitWithError(error);
});
