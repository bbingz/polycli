import fs from "node:fs";
import os from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { terminateProcessTree } from "@bbingz/polycli-utils/process";
import {
  getJob,
  listJobs,
  readJobFile,
  readJobConfigFile,
  removeJobConfigFile,
  removeJobStartFailureFile,
  resolveJobConfigFile,
  resolveJobFile,
  updateJobAtomically,
} from "./state.mjs";
import { recoverBackgroundStartFailure } from "./background-start.mjs";
import {
  createTerminalLedgerDescriptor,
  ensureRunLedgerTerminalPair,
} from "./run-ledger.mjs";
import {
  deriveSessionArtifactCandidate,
  recordArtifactPath,
} from "./sessions.mjs";
import { PolycliCliError } from "./cli-contract.mjs";

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const WAIT_TARGETS = new Set(["terminal", "completed", "failed", "cancelled"]);
const DEFAULT_STATUS_LIMIT = 8;
const MAX_SELECTOR_CANDIDATES = 8;

function createDeadlineError() {
  const error = new Error("cancellation deadline exceeded");
  error.code = "EDEADLINE";
  return error;
}

function remainingDeadlineMs(deadlineAt) {
  return Number.isFinite(deadlineAt) ? deadlineAt - Date.now() : null;
}

function deadlineLockOptions(deadlineAt) {
  const remainingMs = remainingDeadlineMs(deadlineAt);
  if (remainingMs == null) return {};
  if (remainingMs <= 0) throw createDeadlineError();
  return {
    timeoutMs: Math.max(1, Math.ceil(remainingMs)),
    pollMs: Math.max(1, Math.min(25, Math.ceil(remainingMs))),
  };
}

function isDeadlineFailure(error, deadlineAt) {
  return Number.isFinite(deadlineAt)
    && ["EDEADLINE", "ELOCKTIMEOUT", "ETIMEDOUT"].includes(error?.code);
}

async function awaitWithinDeadline(promise, deadlineAt) {
  const remainingMs = remainingDeadlineMs(deadlineAt);
  if (remainingMs == null) {
    await promise;
    return true;
  }
  if (remainingMs <= 0) return false;
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isExpectedWorkerProcess(pid, configFile, {
  deadlineAt = null,
  platform = process.platform,
  spawnProcess = spawnSync,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0 || !configFile) return null;
  const remainingMs = Number.isFinite(deadlineAt)
    ? Math.floor(deadlineAt - Date.now())
    : null;
  if (remainingMs != null && remainingMs <= 0) return null;
  try {
    const spawnOptions = {
      encoding: "utf8",
      stdio: "pipe",
      ...(remainingMs == null ? {} : { timeout: remainingMs }),
    };
    const result = platform === "win32"
      ? spawnProcess("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
      ], spawnOptions)
      : spawnProcess("ps", ["-ww", "-o", "command=", "-p", String(pid)], spawnOptions);
    if (result.error) return null;
    if (result.status !== 0) return false;
    return result.stdout.includes("_job-worker") && result.stdout.includes(configFile);
  } catch {
    return null;
  }
}

function sortJobsNewestFirst(jobs) {
  return jobs
    .slice()
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}

function readProgressPreview(logFile, maxLines = 4) {
  if (!logFile) return "";
  try {
    const lines = fs.readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

function enrichJob(workspaceRoot, job) {
  const envelope = readJobFile(resolveJobFile(workspaceRoot, job.jobId));
  return {
    ...job,
    progressPreview: readProgressPreview(job.logFile),
    result: envelope?.result ?? null,
  };
}

function isTerminalEnvelope(envelope) {
  return Boolean(envelope?.job && TERMINAL_STATUSES.has(envelope.job.status));
}

export function hasPendingCancellationIntent(envelope) {
  return envelope?.cancellationIntent?.status === "requested";
}

function buildRecoveredTerminalEvents(
  workspaceRoot,
  job,
  config,
  runContext,
  { result = null, reason = "worker_exited", terminalDescriptor = null } = {},
) {
  const command = runContext.command || config?.execution?.kind || job.kind || null;
  const provider = runContext.provider || config?.execution?.provider || job.provider || null;
  const kind = runContext.kind || config?.execution?.kind || job.kind || command;
  const cancelled = reason === "cancelled" || job.status === "cancelled";
  const succeeded = !cancelled && job.status === "completed" && result?.ok !== false;
  const status = cancelled ? "cancelled" : (succeeded ? "completed" : "failed");
  const decisionStatus = cancelled ? "cancelled" : (succeeded ? "adopted" : "failed");
  const terminalReason = succeeded ? null : reason;
  const errorMessage = succeeded ? null : (result?.error || job.error || "worker exited before writing a result envelope");

  // Recovery path also records the verified upstream session artifact realpath
  // (Q9a) so worker-recovered runs are purgeable too — same honest rules as the
  // companion run site: derive ONE candidate, record only if it exists + is not a
  // symlink + realpath stays under the provider store root, else null.
  const recoveredProviderSessionId = result?.providerSessionId ?? job.providerSessionId ?? null;
  const recoveredCwd = config?.execution?.cwd ?? config?.workspaceRoot ?? workspaceRoot ?? null;
  const sessionArtifactPath = recoveredProviderSessionId && recoveredCwd
    ? recordArtifactPath(
        deriveSessionArtifactCandidate({
          provider,
          sessionId: recoveredProviderSessionId,
          workspaceRoot: recoveredCwd,
          homedir: os.homedir(),
        }),
        { homedir: os.homedir() },
      )
    : null;

  const base = {
    runId: runContext.runId,
    command,
    commands: command ? [command] : [],
    kind,
    provider,
    invocationId: runContext.invocationId ?? job.invocationId ?? null,
    jobId: job.jobId,
    attemptId: runContext.attemptId ?? job.attemptId ?? null,
    providerSessionId: recoveredProviderSessionId,
    sessionId: recoveredProviderSessionId,
    sessionArtifactPath,
    // A descriptor-bearing envelope came from the worker finalizer, whose terminal event records
    // only upstream-returned model fields. Do not substitute configured defaults during recovery:
    // doing so would manufacture a different terminal identity after a crash.
    model: terminalDescriptor ? (result?.model ?? null) : (result?.model || runContext.model || config?.execution?.model || job.model || null),
    defaultModel: terminalDescriptor ? (result?.defaultModel ?? null) : (result?.defaultModel || runContext.defaultModel || config?.execution?.defaultModel || null),
    hostSurface: runContext.hostSurface || "unknown",
    logFile: runContext.logFile || job.logFile || null,
  };

  return [
    {
      ...base,
      phase: "attempt_result",
      status,
      reason: terminalReason,
      attempt: { ordinal: 1 },
      preview: result?.response ? String(result.response).slice(0, 180) : null,
      stdoutBytes: result?.stdoutBytes ?? null,
      stderrBytes: result?.stderrBytes ?? null,
      errorCode: result?.errorCode ?? result?.timing?.errorCode ?? null,
      failureClass: result?.errorCode ?? result?.timing?.errorCode ?? null,
      timingRef: result?.timing
        ? {
          provider: result.timing.provider,
          kind: result.timing.kind,
          completedAt: result.timing.completedAt,
        }
        : null,
      error: errorMessage ? { message: String(errorMessage).slice(0, 300) } : null,
    },
    {
      ...base,
      phase: "provider_decision",
      status: decisionStatus,
      reason: terminalReason,
    },
  ];
}

function applyTerminalDescriptor(events, terminalDescriptor) {
  if (!terminalDescriptor) return events;
  const byPhase = new Map((terminalDescriptor.events || []).map((event) => [event.phase, event]));
  return events.map((event) => {
    const material = byPhase.get(event.phase);
    if (!material) return event;
    return {
      ...event,
      phase: material.phase,
      status: material.status,
      reason: material.reason,
      provider: material.provider,
      command: material.command,
      kind: material.kind,
      hostSurface: material.hostSurface,
      attempt: material.attempt,
      invocationId: material.invocationId ?? event.invocationId ?? null,
      attemptId: material.attemptId ?? event.attemptId ?? null,
      providerSessionId: material.providerSessionId ?? material.sessionId ?? event.providerSessionId ?? null,
      sessionId: material.providerSessionId ?? material.sessionId ?? event.providerSessionId ?? null,
      model: material.model,
      defaultModel: material.defaultModel,
      timingRef: material.timingRef,
      error: material.error,
      errorCode: material.errorCode,
      failureClass: material.failureClass,
    };
  });
}

function prepareRecoveredTerminalEvents(
  workspaceRoot,
  job,
  config,
  { result = null, reason = "worker_exited", terminalDescriptor = null } = {},
) {
  const descriptorEvent = terminalDescriptor?.events?.[0] ?? null;
  const runContext = config?.runContext || (terminalDescriptor?.runId
    ? {
      runId: terminalDescriptor.runId,
      command: descriptorEvent?.command ?? job.kind ?? null,
      kind: descriptorEvent?.kind ?? job.kind ?? null,
      provider: descriptorEvent?.provider ?? job.provider ?? null,
      hostSurface: descriptorEvent?.hostSurface || "unknown",
      invocationId: terminalDescriptor.invocationId ?? job.invocationId ?? null,
      attemptId: terminalDescriptor.attemptId ?? job.attemptId ?? null,
      jobId: terminalDescriptor.jobId ?? job.jobId ?? null,
      logFile: job.logFile ?? null,
    }
    : null);
  if (!runContext?.runId) return { events: [], terminalDescriptor };

  const events = buildRecoveredTerminalEvents(workspaceRoot, job, config, runContext, {
    result,
    reason,
    terminalDescriptor,
  });
  const descriptor = terminalDescriptor || createTerminalLedgerDescriptor(events);
  return {
    events: applyTerminalDescriptor(events, terminalDescriptor)
      .map((event) => ({ ...event, terminalDescriptor: descriptor })),
    terminalDescriptor: descriptor,
  };
}

function ensureRecoveredTerminalEvents(workspaceRoot, prepared, { lockOptions = {} } = {}) {
  // The state lock serializes worker finalization, cancellation, and recovery for this job.
  // The shared helper publishes a missing pair atomically and refuses conflicting data.
  if (prepared.events.length > 0) {
    ensureRunLedgerTerminalPair(workspaceRoot, prepared.events, { lockOptions });
  }
}

function cleanupRuntimePaths(config) {
  const cleanupPaths = config?.execution?.runtimeOptions?.cleanupPaths;
  if (!Array.isArray(cleanupPaths)) return;
  for (const cleanupPath of cleanupPaths) {
    if (typeof cleanupPath !== "string" || !cleanupPath) continue;
    try {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; cancellation must remain idempotent
    }
  }
}

export function refreshJob(workspaceRoot, job) {
  if (!job || !ACTIVE_STATUSES.has(job.status)) {
    if (job?.jobId && TERMINAL_STATUSES.has(job.status)) {
      removeJobStartFailureFile(workspaceRoot, job.jobId);
    }
    return job ? enrichJob(workspaceRoot, job) : null;
  }
  const storedEnvelope = readJobFile(resolveJobFile(workspaceRoot, job.jobId));
  if (hasPendingCancellationIntent(storedEnvelope)) {
    return enrichJob(workspaceRoot, job);
  }
  const startFailureRecovery = recoverBackgroundStartFailure(workspaceRoot, job.jobId);
  if (startFailureRecovery.written) {
    return enrichJob(workspaceRoot, getJob(workspaceRoot, job.jobId) || job);
  }
  if (!job.pid && !isTerminalEnvelope(storedEnvelope)) {
    return enrichJob(workspaceRoot, job);
  }
  if (isProcessAlive(job.pid)) {
    const identity = isExpectedWorkerProcess(job.pid, resolveJobConfigFile(workspaceRoot, job.jobId));
    // Keep legacy active jobs (which have no terminal intent) alive on an unverifiable host. A
    // terminal intent is different: a verified mismatch means this PID has been reused, so it is
    // safe to recover the intent without touching that unrelated process.
    if (!isTerminalEnvelope(storedEnvelope) || identity !== false) {
      return enrichJob(workspaceRoot, job);
    }
  }
  try {
    const write = updateJobAtomically(workspaceRoot, job.jobId, (latest, storedEnvelope) => {
      if (!latest || !ACTIVE_STATUSES.has(latest.status)) return null;

      const hasStoredTerminalIntent = isTerminalEnvelope(storedEnvelope);
      const finalizedAt = new Date().toISOString();
      const finalizedBase = hasStoredTerminalIntent
        ? {
          ...latest,
          ...storedEnvelope.job,
          hostSessionId: storedEnvelope.job.hostSessionId ?? latest.hostSessionId ?? null,
          invocationId: storedEnvelope.job.invocationId ?? latest.invocationId ?? null,
          attemptId: storedEnvelope.job.attemptId ?? latest.attemptId ?? null,
          providerSessionId: storedEnvelope.job.providerSessionId ?? latest.providerSessionId ?? null,
          pid: null,
        }
        : {
          ...latest,
          status: "failed",
          pid: null,
          finishedAt: finalizedAt,
          error: "worker exited before writing a result envelope",
        };
      const finalized = {
        ...finalizedBase,
        finishedAt: finalizedBase.finishedAt || finalizedAt,
        updatedAt: finalizedAt,
      };
      const result = hasStoredTerminalIntent
        ? (storedEnvelope.result || {
          ok: finalized.status === "completed",
          error: finalized.status === "cancelled" ? "cancelled" : finalized.error || null,
        })
        : { ok: false, error: finalized.error };
      const inferredReason = finalized.status === "cancelled"
        ? "cancelled"
        : (result.ok
          ? null
          : (result.error === "worker exited before writing a result envelope"
            ? "worker_exited"
            : `${finalized.kind || latest.kind}_failed`));
      const terminalReason = hasStoredTerminalIntent
        && Object.prototype.hasOwnProperty.call(storedEnvelope, "terminalReason")
        ? storedEnvelope.terminalReason
        : inferredReason;
      const config = readJobConfigFile(resolveJobConfigFile(workspaceRoot, latest.jobId));
      const providerSessionId = result?.providerSessionId ?? finalized.providerSessionId ?? null;
      const finalizedWithIdentities = {
        ...finalized,
        invocationId: finalized.invocationId ?? config?.runContext?.invocationId ?? null,
        attemptId: finalized.attemptId ?? config?.runContext?.attemptId ?? null,
        providerSessionId,
        sessionId: providerSessionId,
      };
      const terminal = prepareRecoveredTerminalEvents(workspaceRoot, finalizedWithIdentities, config, {
        result,
        reason: terminalReason,
        terminalDescriptor: storedEnvelope?.terminalDescriptor ?? null,
      });

      return {
        job: finalizedWithIdentities,
        envelope: {
          job: finalizedWithIdentities,
          result,
          terminalReason,
          terminalDescriptor: terminal.terminalDescriptor,
        },
        // The envelope is the recoverable intent. Do not publish the terminal state until the
        // ledger has either atomically accepted the complete pair or already contains that pair.
        beforeStateCommit() {
          ensureRecoveredTerminalEvents(workspaceRoot, terminal);
        },
      };
    });
    if (write.written) {
      const config = readJobConfigFile(resolveJobConfigFile(workspaceRoot, job.jobId));
      cleanupRuntimePaths(config);
      removeJobConfigFile(workspaceRoot, job.jobId);
      removeJobStartFailureFile(workspaceRoot, job.jobId);
    }
    const current = write.written ? write.job : (getJob(workspaceRoot, job.jobId) || job);
    if (TERMINAL_STATUSES.has(current?.status)) {
      removeJobStartFailureFile(workspaceRoot, job.jobId);
    }
    return enrichJob(workspaceRoot, current);
  } catch {
    // Keep the persisted job active when the ledger is temporarily unavailable;
    // a later status refresh retries recovery instead of exposing an incomplete
    // terminal state or result envelope.
    return enrichJob(workspaceRoot, getJob(workspaceRoot, job.jobId) || job);
  }
}

export function buildStatusSnapshot(workspaceRoot, { showAll = false } = {}) {
  const refreshed = sortJobsNewestFirst(listJobs(workspaceRoot)).map((job) => refreshJob(workspaceRoot, job));
  const recent = refreshed.filter((job) => TERMINAL_STATUSES.has(job.status));
  return {
    totalJobs: refreshed.length,
    running: refreshed.filter((job) => ACTIVE_STATUSES.has(job.status)),
    recent: showAll ? recent : recent.slice(0, DEFAULT_STATUS_LIMIT),
  };
}

export function refreshJobsForLedgerRecovery(workspaceRoot) {
  return sortJobsNewestFirst(listJobs(workspaceRoot)).map((job) => refreshJob(workspaceRoot, job));
}

export function resolveJobReference(workspaceRoot, reference, predicate = () => true) {
  const candidates = sortJobsNewestFirst(listJobs(workspaceRoot)).filter(predicate);
  if (!reference) return candidates[0] || null;

  const exact = candidates.find((job) => job.jobId === reference);
  if (exact) return exact;

  const prefixMatches = candidates.filter((job) => job.jobId.startsWith(reference));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  return null;
}

function selectorError(code, message, selector, data = {}) {
  return new PolycliCliError({
    code,
    message,
    data: {
      selector,
      ...data,
    },
  });
}

function resolveUniquePrefix(candidates, prefix, selector) {
  const matches = candidates.filter((job) => job.jobId.startsWith(prefix));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw selectorError(
      "ambiguous_selector",
      `Job selector '${selector}' matches more than one job.`,
      selector,
      { candidateIds: matches.slice(0, MAX_SELECTOR_CANDIDATES).map((job) => job.jobId) },
    );
  }
  throw selectorError(
    "job_not_found",
    `Job selector '${selector}' did not match a job in this workspace.`,
    selector,
  );
}

/**
 * Resolve one job from the current workspace's persisted state only.
 *
 * The optional predicate narrows the candidate set before selector semantics are
 * applied. Callers can therefore make `latest` mean the newest job acceptable
 * to that command without weakening the explicit active/terminal selectors.
 */
export function resolveJobSelector(workspaceRoot, selector = "latest", {
  predicate = () => true,
  grammar = "compat",
} = {}) {
  if (grammar !== "compat" && grammar !== "explicit") {
    throw new TypeError(`Unknown job selector grammar '${grammar}'.`);
  }
  const normalizedSelector = selector == null || selector === "" ? "latest" : String(selector);
  const candidates = sortJobsNewestFirst(listJobs(workspaceRoot)).filter(predicate);

  if (normalizedSelector === "latest") {
    const latest = candidates[0] || null;
    if (latest) return latest;
    throw selectorError(
      "job_not_found",
      "No job matches the selector in this workspace.",
      normalizedSelector,
    );
  }

  if (normalizedSelector === "latest-active") {
    const latest = candidates.find((job) => ACTIVE_STATUSES.has(job.status)) || null;
    if (latest) return latest;
    throw selectorError(
      "no_active_job",
      "No active job exists in this workspace.",
      normalizedSelector,
    );
  }

  if (normalizedSelector === "latest-terminal") {
    const latest = candidates.find((job) => TERMINAL_STATUSES.has(job.status)) || null;
    if (latest) return latest;
    throw selectorError(
      "no_completed_job",
      "No terminal job exists in this workspace.",
      normalizedSelector,
    );
  }

  if (normalizedSelector.startsWith("id:")) {
    const jobId = normalizedSelector.slice("id:".length);
    if (!jobId) {
      throw selectorError(
        "invalid_argument",
        "The id: selector requires a full job id.",
        normalizedSelector,
      );
    }
    const exact = candidates.find((job) => job.jobId === jobId) || null;
    if (exact) return exact;
    throw selectorError(
      "job_not_found",
      `Job '${jobId}' was not found in this workspace.`,
      normalizedSelector,
    );
  }

  if (normalizedSelector.startsWith("prefix:")) {
    const prefix = normalizedSelector.slice("prefix:".length);
    if (!prefix) {
      throw selectorError(
        "invalid_argument",
        "The prefix: selector requires a non-empty job-id prefix.",
        normalizedSelector,
      );
    }
    return resolveUniquePrefix(candidates, prefix, normalizedSelector);
  }

  if (grammar === "explicit") {
    throw selectorError(
      "invalid_argument",
      `Job selector '${normalizedSelector}' must use id:, prefix:, latest, latest-active, or latest-terminal grammar.`,
      normalizedSelector,
      { grammar },
    );
  }

  // Compatibility: a bare reference is exact first, then a unique prefix.
  const exact = candidates.find((job) => job.jobId === normalizedSelector) || null;
  if (exact) return exact;
  return resolveUniquePrefix(candidates, normalizedSelector, normalizedSelector);
}

export function resolveLatestActiveJob(workspaceRoot) {
  return resolveJobReference(workspaceRoot, null, (job) => ACTIVE_STATUSES.has(job.status));
}

export function resolveLatestTerminalJob(workspaceRoot) {
  return resolveJobReference(workspaceRoot, null, (job) => TERMINAL_STATUSES.has(job.status));
}

function typedWaitResult(forStatus, {
  satisfied = false,
  timedOut = false,
  terminalMismatch = false,
} = {}) {
  return {
    for: forStatus,
    satisfied,
    timedOut,
    terminalMismatch,
  };
}

function evaluateWaitTarget(job, forStatus) {
  if (!job) return null;
  if (forStatus === "terminal" && TERMINAL_STATUSES.has(job.status)) {
    return typedWaitResult(forStatus, { satisfied: true });
  }
  if (job.status === forStatus) {
    return typedWaitResult(forStatus, { satisfied: true });
  }
  if (forStatus !== "terminal" && TERMINAL_STATUSES.has(job.status)) {
    return typedWaitResult(forStatus, { terminalMismatch: true });
  }
  return null;
}

export async function waitForJob(workspaceRoot, jobId, options = {}) {
  const {
    timeoutMs = 240_000,
    pollIntervalMs = 500,
  } = options;
  const forStatus = options.for ?? "terminal";
  if (!WAIT_TARGETS.has(forStatus)) {
    throw new PolycliCliError({
      code: "invalid_argument",
      message: `Unsupported job wait target '${forStatus}'.`,
      data: {
        argument: forStatus,
        validValues: [...WAIT_TARGETS],
      },
    });
  }

  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    const current = getJob(workspaceRoot, jobId);
    if (!current) {
      return {
        error: "job_not_found",
        job: null,
        waitTimedOut: false,
        wait: typedWaitResult(forStatus),
      };
    }
    const refreshed = refreshJob(workspaceRoot, current);
    const terminalResult = evaluateWaitTarget(refreshed, forStatus);
    if (terminalResult) {
      return {
        job: refreshed,
        waitTimedOut: false,
        wait: terminalResult,
      };
    }
    if (Date.now() >= deadline) {
      return {
        job: refreshed,
        waitTimedOut: true,
        wait: typedWaitResult(forStatus, { timedOut: true }),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function cancelJob(
  workspaceRoot,
  jobId,
  {
    terminate = terminateProcessTree,
    isWorkerAlive = isProcessAlive,
    isExpectedWorker = isExpectedWorkerProcess,
    deadlineAt = null,
  } = {},
) {
  // Keep the public job active until a validated worker has been stopped. A distinct, non-terminal
  // envelope intent makes that request durable without publishing a result or terminal ledger pair.
  let pidToKill = null;
  let configForCleanup = null;
  let cancellationEnvelope = null;
  let reason = null;
  const requestedAt = new Date().toISOString();
  let intentWrite;
  try {
    intentWrite = updateJobAtomically(workspaceRoot, jobId, (current, storedEnvelope) => {
      if (!current) {
        reason = "not_found";
        return null;
      }
      if (!ACTIVE_STATUSES.has(current.status)) {
        reason = "not_cancellable";
        return null;
      }
      const resumingCancellation = hasPendingCancellationIntent(storedEnvelope);
      if (isTerminalEnvelope(storedEnvelope) && !resumingCancellation) {
        reason = "not_cancellable";
        return null;
      }

      pidToKill = current.pid ?? null;
      configForCleanup = readJobConfigFile(resolveJobConfigFile(workspaceRoot, jobId));
      cancellationEnvelope = resumingCancellation
        ? storedEnvelope
        : {
          job: current,
          cancellationIntent: {
            status: "requested",
            requestedAt,
          },
        };
      return {
        // Do not make the state or envelope terminal yet. Both remain recovery points if this
        // process exits after persisting the intent but before the worker receives its signal.
        job: current,
        envelope: cancellationEnvelope,
      };
    }, { lockOptions: deadlineLockOptions(deadlineAt) });
  } catch (error) {
    if (isDeadlineFailure(error, deadlineAt)) {
      return { cancelled: false, reason: "deadline_exceeded", jobId };
    }
    throw error;
  }
  if (!intentWrite.written) {
    return { cancelled: false, reason: reason || "not_cancellable", jobId };
  }

  const configFile = resolveJobConfigFile(workspaceRoot, jobId);
  if (Number.isInteger(pidToKill) && pidToKill > 1 && isWorkerAlive(pidToKill)) {
    if (remainingDeadlineMs(deadlineAt) != null && remainingDeadlineMs(deadlineAt) <= 0) {
      return { cancelled: false, reason: "deadline_exceeded", jobId };
    }
    if (!configForCleanup || isExpectedWorker(pidToKill, configFile, { deadlineAt }) !== true) {
      if (remainingDeadlineMs(deadlineAt) != null && remainingDeadlineMs(deadlineAt) <= 0) {
        return { cancelled: false, reason: "deadline_exceeded", jobId };
      }
      return { cancelled: false, reason: "worker_identity_unverified", jobId };
    }
    try {
      const remainingMs = remainingDeadlineMs(deadlineAt);
      if (remainingMs != null && remainingMs <= 0) {
        return { cancelled: false, reason: "deadline_exceeded", jobId };
      }
      const terminatedWithinDeadline = await awaitWithinDeadline(terminate(pidToKill, {
        signal: "SIGINT",
        forceSignal: "SIGKILL",
        forceAfterMs: remainingMs == null
          ? 2_000
          : Math.max(1, Math.min(2_000, Math.floor(remainingMs))),
        deadlineAt,
      }), deadlineAt);
      if (!terminatedWithinDeadline) {
        return { cancelled: false, reason: "deadline_exceeded", jobId };
      }
    } catch (error) {
      if (isDeadlineFailure(error, deadlineAt)) {
        return { cancelled: false, reason: "deadline_exceeded", jobId };
      }
      return { cancelled: false, reason: "kill_failed", jobId, killWarning: error.message };
    }
    if (isWorkerAlive(pidToKill)) {
      if (remainingDeadlineMs(deadlineAt) != null && remainingDeadlineMs(deadlineAt) <= 0) {
        return { cancelled: false, reason: "deadline_exceeded", jobId };
      }
      const postSignalIdentity = isExpectedWorker(pidToKill, configFile, { deadlineAt });
      if (remainingDeadlineMs(deadlineAt) != null && remainingDeadlineMs(deadlineAt) <= 0) {
        return { cancelled: false, reason: "deadline_exceeded", jobId };
      }
      if (postSignalIdentity === true) {
        return { cancelled: false, reason: "worker_still_running", jobId };
      }
      if (postSignalIdentity == null) {
        return { cancelled: false, reason: "worker_identity_unverified", jobId };
      }
    }
  }

  let finalConfig = configForCleanup;
  let finalWrite;
  try {
    finalWrite = updateJobAtomically(workspaceRoot, jobId, (current, storedEnvelope) => {
      if (!current) {
        reason = "not_found";
        return null;
      }
      if (current.status === "cancelled") return null;
      if (!ACTIVE_STATUSES.has(current.status) || !hasPendingCancellationIntent(storedEnvelope)) {
        reason = "cancellation_finalization_pending";
        return null;
      }
      finalConfig = readJobConfigFile(resolveJobConfigFile(workspaceRoot, jobId)) || finalConfig;
      const finishedAt = new Date().toISOString();
      const storedCancelledJob = storedEnvelope?.job?.status === "cancelled"
        ? storedEnvelope.job
        : null;
      const finalJob = {
        ...current,
        ...(storedCancelledJob || {}),
        status: "cancelled",
        pid: null,
        finishedAt: storedCancelledJob?.finishedAt || finishedAt,
        updatedAt: finishedAt,
      };
      const result = storedEnvelope.result || cancellationEnvelope?.result || { ok: false, error: "cancelled" };
      const terminal = prepareRecoveredTerminalEvents(workspaceRoot, finalJob, finalConfig, {
        result,
        reason: "cancelled",
        terminalDescriptor: storedEnvelope?.terminalDescriptor ?? null,
      });
      return {
        job: finalJob,
        envelope: {
          ...storedEnvelope,
          job: finalJob,
          result,
          terminalReason: "cancelled",
          terminalDescriptor: terminal.terminalDescriptor,
          cancellationIntent: storedEnvelope.cancellationIntent,
        },
        beforeStateCommit() {
          ensureRecoveredTerminalEvents(workspaceRoot, terminal, {
            lockOptions: deadlineLockOptions(deadlineAt),
          });
        },
      };
    }, { lockOptions: deadlineLockOptions(deadlineAt) });
  } catch (error) {
    if (isDeadlineFailure(error, deadlineAt)) {
      return { cancelled: false, reason: "deadline_exceeded", jobId };
    }
    throw error;
  }
  if (!finalWrite.written) {
    const current = getJob(workspaceRoot, jobId);
    if (current?.status === "cancelled") {
      removeJobStartFailureFile(workspaceRoot, jobId);
      return { cancelled: true, jobId };
    }
    return { cancelled: false, reason: reason || "cancellation_finalization_pending", jobId };
  }

  // Runtime paths can contain the worker's live cwd, so only clean them after the verified stop
  // and the terminal state commit. The config remains available for any retry before this point.
  cleanupRuntimePaths(finalConfig);
  removeJobConfigFile(workspaceRoot, jobId);
  removeJobStartFailureFile(workspaceRoot, jobId);
  return { cancelled: true, jobId };
}
