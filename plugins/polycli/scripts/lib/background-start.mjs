import fs from "node:fs";
import process from "node:process";
import { spawn } from "node:child_process";

import { sanitizePublicErrorMessage } from "./cli-contract.mjs";
import {
  createTerminalLedgerDescriptor,
  ensureRunLedgerTerminalPair,
} from "./run-ledger.mjs";
import {
  getJob,
  readJobFile,
  readJobConfigFile,
  removeJobConfigFile,
  readJobStartFailureFile,
  removeJobStartFailureFile,
  resolveJobConfigFile,
  resolveJobFile,
  updateJobAtomically,
  writeJobConfigFile,
  writeJobStartFailureFile,
} from "./state.mjs";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

function blocksFailureFinalizer(envelope) {
  return TERMINAL_JOB_STATUSES.has(envelope?.job?.status)
    || (envelope?.cancellationIntent?.status === "requested"
      && ACTIVE_JOB_STATUSES.has(envelope?.job?.status));
}

function cleanupRuntimeOptions(runtimeOptions = {}) {
  const cleanupPaths = Array.isArray(runtimeOptions?.cleanupPaths)
    ? runtimeOptions.cleanupPaths
    : [];
  for (const cleanupPath of cleanupPaths) {
    if (typeof cleanupPath !== "string" || cleanupPath.trim() === "") continue;
    try {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    } catch {
      // A failed start has no live worker using these owned paths; cleanup remains best effort.
    }
  }
}

function buildRunEvent(runContext, base) {
  if (!runContext?.runId) return null;
  const command = base.command || runContext.command;
  return {
    runId: runContext.runId,
    hostSurface: runContext.hostSurface || "unknown",
    argv: runContext.argv || [],
    invocationId: runContext.invocationId ?? null,
    attemptId: runContext.attemptId ?? null,
    jobId: runContext.jobId ?? base.jobId ?? null,
    command,
    commands: Array.from(new Set([
      ...(runContext.commands || []),
      command,
      ...(base.commands || []),
    ].filter(Boolean))).sort(),
    ...base,
  };
}

function prepareFailureEvents(runContext, events) {
  const material = events.map((event) => buildRunEvent(runContext, event)).filter(Boolean);
  if (material.length === 0) return [];
  const terminalDescriptor = createTerminalLedgerDescriptor(material);
  return material.map((event) => ({ ...event, terminalDescriptor }));
}

function safeRunIdentity(jobId, execution, runContext) {
  return {
    runId: runContext?.runId ?? null,
    invocationId: runContext?.invocationId ?? null,
    attemptId: runContext?.attemptId ?? null,
    command: runContext?.command || execution.kind,
    commands: Array.from(new Set([
      ...(runContext?.commands || []),
      runContext?.command,
      execution.kind,
    ].filter(Boolean))).sort(),
    hostSurface: runContext?.hostSurface || "unknown",
    jobId,
    provider: execution.provider,
    kind: execution.kind,
    logFile: runContext?.logFile ?? null,
  };
}

function buildStartFailureRecovery(jobId, execution, runContext, error, runtimeOptions) {
  const safeMessage = sanitizePublicErrorMessage(error?.message || error, 300);
  const identity = safeRunIdentity(jobId, execution, runContext);
  const terminalReason = `${execution.kind}_failed`;
  const terminalEvents = prepareFailureEvents(identity, [
    {
      command: identity.command,
      kind: execution.kind,
      provider: execution.provider,
      phase: "attempt_result",
      status: "failed",
      reason: terminalReason,
      attempt: { ordinal: 1 },
      jobId,
      error: { message: safeMessage },
      logFile: identity.logFile,
    },
    {
      command: identity.command,
      kind: execution.kind,
      provider: execution.provider,
      phase: "provider_decision",
      status: "failed",
      reason: terminalReason,
      jobId,
    },
  ]);
  return {
    version: 1,
    jobId,
    provider: execution.provider,
    kind: execution.kind,
    error: safeMessage,
    recordedAt: new Date().toISOString(),
    identity,
    terminalDescriptor: terminalEvents[0]?.terminalDescriptor ?? null,
    ownedCleanupPaths: Array.isArray(runtimeOptions?.cleanupPaths)
      ? runtimeOptions.cleanupPaths.filter((entry) => typeof entry === "string" && entry.trim() !== "")
      : [],
  };
}

function materialExecution(recovery) {
  return {
    provider: recovery.provider,
    kind: recovery.kind,
    runtimeOptions: { cleanupPaths: recovery.ownedCleanupPaths || [] },
  };
}

function finalizeBackgroundStartFailure(workspaceRoot, recovery, { lockOptions = {} } = {}) {
  const { jobId } = recovery;
  const execution = materialExecution(recovery);
  const runContext = recovery.identity;
  const safeMessage = recovery.error;
  return updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
    if (!latest || !ACTIVE_JOB_STATUSES.has(latest.status) || blocksFailureFinalizer(storedEnvelope)) {
      return null;
    }
    const finishedAt = new Date().toISOString();
    const failedJob = {
      ...latest,
      invocationId: latest.invocationId ?? runContext?.invocationId ?? null,
      attemptId: latest.attemptId ?? runContext?.attemptId ?? null,
      status: "failed",
      pid: null,
      finishedAt,
      updatedAt: finishedAt,
      error: safeMessage,
    };
    const terminalReason = `${execution.kind}_failed`;
    const terminalEvents = prepareFailureEvents(runContext, [
      {
        command: runContext?.command || execution.kind,
        kind: execution.kind,
        provider: execution.provider,
        phase: "attempt_result",
        status: "failed",
        reason: terminalReason,
        attempt: { ordinal: 1 },
        jobId,
        error: { message: safeMessage },
        logFile: failedJob.logFile || runContext?.logFile || null,
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
    ]).map((event) => ({
      ...event,
      terminalDescriptor: recovery.terminalDescriptor || event.terminalDescriptor,
    }));
    const terminalDescriptor = recovery.terminalDescriptor
      || terminalEvents[0]?.terminalDescriptor
      || null;
    return {
      job: failedJob,
      envelope: {
        job: failedJob,
        result: { ok: false, error: safeMessage },
        terminalReason,
        terminalDescriptor,
      },
      beforeStateCommit() {
        if (terminalEvents.length > 0) {
          ensureRunLedgerTerminalPair(workspaceRoot, terminalEvents);
        }
      },
    };
  }, { lockOptions });
}

function persistedJobBlocksFailure(workspaceRoot, jobId) {
  const job = getJob(workspaceRoot, jobId);
  const envelope = readJobFile(resolveJobFile(workspaceRoot, jobId));
  return !job || !ACTIVE_JOB_STATUSES.has(job.status) || blocksFailureFinalizer(envelope);
}

export function recoverBackgroundStartFailure(workspaceRoot, jobId, options = {}) {
  const recovery = readJobStartFailureFile(workspaceRoot, jobId);
  if (!recovery || recovery.version !== 1 || recovery.jobId !== jobId) {
    return { written: false, finalizationError: null };
  }
  if (persistedJobBlocksFailure(workspaceRoot, jobId)) {
    removeJobStartFailureFile(workspaceRoot, jobId);
    return { written: false, finalizationError: null };
  }
  try {
    const write = finalizeBackgroundStartFailure(workspaceRoot, recovery, options);
    if (write.written) {
      cleanupRuntimeOptions({ cleanupPaths: recovery.ownedCleanupPaths });
      removeJobConfigFile(workspaceRoot, jobId);
      removeJobStartFailureFile(workspaceRoot, jobId);
    }
    return { written: write.written, finalizationError: null };
  } catch (finalizationError) {
    return { written: false, finalizationError };
  }
}

export function recordBackgroundStartFailure(
  workspaceRoot,
  jobId,
  execution,
  runContext,
  error,
  options = {},
) {
  const configFile = resolveJobConfigFile(workspaceRoot, jobId);
  const config = readJobConfigFile(configFile);
  const runtimeOptions = config?.execution?.runtimeOptions ?? execution.runtimeOptions;
  const recovery = buildStartFailureRecovery(jobId, execution, runContext, error, runtimeOptions);
  if (persistedJobBlocksFailure(workspaceRoot, jobId)) {
    removeJobStartFailureFile(workspaceRoot, jobId);
    return { written: false, finalizationError: null };
  }
  try {
    writeJobStartFailureFile(workspaceRoot, jobId, recovery);
  } catch {
    // The terminal transaction may still succeed. If both writes fail, keep the original start
    // error authoritative; this secondary persistence problem must never mask it.
  }
  // Close a race with cancellation/worker finalization: if either won while the sidecar write was
  // in flight, remove the now-stale recovery marker. Otherwise cancellation's own terminal cleanup
  // removes it after this check.
  if (persistedJobBlocksFailure(workspaceRoot, jobId)) {
    removeJobStartFailureFile(workspaceRoot, jobId);
    return { written: false, finalizationError: null };
  }
  try {
    const write = finalizeBackgroundStartFailure(workspaceRoot, recovery, options);
    if (write.written) {
      cleanupRuntimeOptions(runtimeOptions);
      removeJobConfigFile(workspaceRoot, jobId);
      removeJobStartFailureFile(workspaceRoot, jobId);
    }
    return { written: write.written, finalizationError: null };
  } catch (finalizationError) {
    // updateJobAtomically keeps public state active when its ledger barrier fails. The durable
    // envelope (if written) is then recoverable by refreshJob, while the caller still receives
    // the original config/log/open/spawn error rather than this secondary persistence failure.
    // A start failure has no live worker, so reclaim caller-owned runtime paths immediately; the
    // sidecar retains the same paths only so an interrupted cleanup remains safely retryable.
    cleanupRuntimeOptions(runtimeOptions);
    return { written: false, finalizationError };
  }
}

export async function startBackgroundWorker({
  workspaceRoot,
  job,
  execution,
  runContext,
  config,
  companionPath,
  env = process.env,
  failureFinalizationOptions = {},
}, {
  writeConfigFile = writeJobConfigFile,
  writeLogFile = fs.writeFileSync,
  openLogFile = fs.openSync,
  closeLogFile = fs.closeSync,
  spawnWorker = spawn,
} = {}) {
  let child = null;
  let logFd = null;
  let startFailure = null;
  let startWarning = null;
  let closeWarning = null;
  const configFile = resolveJobConfigFile(workspaceRoot, job.jobId);

  try {
    writeConfigFile(workspaceRoot, job.jobId, config);
    writeLogFile(job.logFile, `[${new Date().toISOString()}] started ${job.provider} ${job.kind}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    logFd = openLogFile(job.logFile, "a", 0o600);
    child = spawnWorker(process.execPath, [companionPath, "_job-worker", configFile], {
      cwd: execution.cwd,
      env: { ...env },
      stdio: ["ignore", logFd, logFd],
      detached: true,
    });

    // Once spawn returned a child, never misreport this job as a synchronous start failure: the
    // process may already be live. Async spawn errors use the same authoritative finalizer.
    try {
      child.once("error", (asyncError) => {
        recordBackgroundStartFailure(
          workspaceRoot,
          job.jobId,
          execution,
          runContext,
          asyncError,
          failureFinalizationOptions,
        );
      });
      child.unref();
    } catch (error) {
      startWarning = error;
    }
  } catch (error) {
    startFailure = error;
  } finally {
    if (logFd != null) {
      try {
        closeLogFile(logFd);
      } catch (error) {
        if (child) closeWarning = error;
        else if (!startFailure) startFailure = error;
      }
    }
  }

  if (startFailure) {
    recordBackgroundStartFailure(
      workspaceRoot,
      job.jobId,
      execution,
      runContext,
      startFailure,
      failureFinalizationOptions,
    );
    throw startFailure;
  }

  return { child, startWarning, closeWarning };
}
