import fs from "node:fs";
import process from "node:process";
import { spawn } from "node:child_process";

import { sanitizePublicErrorMessage } from "./cli-contract.mjs";
import { hasPendingCancellationIntent } from "./job-control.mjs";
import {
  createTerminalLedgerDescriptor,
  ensureRunLedgerTerminalPair,
} from "./run-ledger.mjs";
import {
  readJobConfigFile,
  removeJobConfigFile,
  resolveJobConfigFile,
  updateJobAtomically,
  writeJobConfigFile,
} from "./state.mjs";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

function blocksFailureFinalizer(envelope) {
  return TERMINAL_JOB_STATUSES.has(envelope?.job?.status)
    || hasPendingCancellationIntent(envelope);
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

export function recordBackgroundStartFailure(
  workspaceRoot,
  jobId,
  execution,
  runContext,
  error,
) {
  const configFile = resolveJobConfigFile(workspaceRoot, jobId);
  const config = readJobConfigFile(configFile);
  const runtimeOptions = config?.execution?.runtimeOptions ?? execution.runtimeOptions;
  const safeMessage = sanitizePublicErrorMessage(error?.message || error, 300);
  try {
    const write = updateJobAtomically(workspaceRoot, jobId, (latest, storedEnvelope) => {
      if (!latest || !ACTIVE_JOB_STATUSES.has(latest.status) || blocksFailureFinalizer(storedEnvelope)) {
        return null;
      }
      const finishedAt = new Date().toISOString();
      const failedJob = {
        ...latest,
        ...(execution.jobMeta || {}),
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
      ]);
      const terminalDescriptor = terminalEvents[0]?.terminalDescriptor ?? null;
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
    });
    if (write.written) {
      cleanupRuntimeOptions(runtimeOptions);
      removeJobConfigFile(workspaceRoot, jobId);
    }
    return { written: write.written, finalizationError: null };
  } catch (finalizationError) {
    // updateJobAtomically keeps public state active when its ledger barrier fails. The durable
    // envelope (if written) is then recoverable by refreshJob, while the caller still receives
    // the original config/log/open/spawn error rather than this secondary persistence failure.
    // When config creation itself failed there is no live worker and no durable cleanup metadata,
    // so reclaim the caller-owned runtime paths now using the execution fallback.
    if (!config) cleanupRuntimeOptions(runtimeOptions);
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
        recordBackgroundStartFailure(workspaceRoot, job.jobId, execution, runContext, asyncError);
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
    recordBackgroundStartFailure(workspaceRoot, job.jobId, execution, runContext, startFailure);
    throw startFailure;
  }

  return { child, startWarning, closeWarning };
}
