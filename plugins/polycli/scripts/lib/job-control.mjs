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
  resolveJobConfigFile,
  resolveJobFile,
  updateJobAtomically,
} from "./state.mjs";
import {
  createTerminalLedgerDescriptor,
  ensureRunLedgerTerminalPair,
} from "./run-ledger.mjs";
import {
  deriveSessionArtifactCandidate,
  recordArtifactPath,
} from "./sessions.mjs";

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_STATUS_LIMIT = 8;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isExpectedWorkerProcess(pid, configFile) {
  if (!Number.isInteger(pid) || pid <= 0 || !configFile) return null;
  try {
    const result = process.platform === "win32"
      ? spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
      ], { encoding: "utf8", stdio: "pipe" })
      : spawnSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: "pipe",
    });
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
  const recoveredSessionId = result?.sessionId ?? job.sessionId ?? null;
  const recoveredCwd = config?.execution?.cwd ?? config?.workspaceRoot ?? workspaceRoot ?? null;
  const sessionArtifactPath = recoveredSessionId && recoveredCwd
    ? recordArtifactPath(
        deriveSessionArtifactCandidate({
          provider,
          sessionId: recoveredSessionId,
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
    jobId: job.jobId,
    sessionId: recoveredSessionId,
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
      sessionId: material.sessionId,
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
  const runContext = config?.runContext;
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

function ensureRecoveredTerminalEvents(workspaceRoot, prepared) {
  // The state lock serializes worker finalization, cancellation, and recovery for this job.
  // The shared helper publishes a missing pair atomically and refuses conflicting data.
  if (prepared.events.length > 0) {
    ensureRunLedgerTerminalPair(workspaceRoot, prepared.events);
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
    return job ? enrichJob(workspaceRoot, job) : null;
  }
  const storedEnvelope = readJobFile(resolveJobFile(workspaceRoot, job.jobId));
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
      const terminal = prepareRecoveredTerminalEvents(workspaceRoot, finalized, config, {
        result,
        reason: terminalReason,
        terminalDescriptor: storedEnvelope?.terminalDescriptor ?? null,
      });

      return {
        job: finalized,
        envelope: {
          job: finalized,
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
    }
    const current = write.written ? write.job : (getJob(workspaceRoot, job.jobId) || job);
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
  const limited = showAll ? refreshed : refreshed.slice(0, DEFAULT_STATUS_LIMIT);
  return {
    totalJobs: refreshed.length,
    running: limited.filter((job) => ACTIVE_STATUSES.has(job.status)),
    recent: limited.filter((job) => TERMINAL_STATUSES.has(job.status)),
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

export function resolveLatestActiveJob(workspaceRoot) {
  return resolveJobReference(workspaceRoot, null, (job) => ACTIVE_STATUSES.has(job.status));
}

export function resolveLatestTerminalJob(workspaceRoot) {
  return resolveJobReference(workspaceRoot, null, (job) => TERMINAL_STATUSES.has(job.status));
}

export async function waitForJob(workspaceRoot, jobId, { timeoutMs = 240_000, pollIntervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = getJob(workspaceRoot, jobId);
    if (!current) {
      return { error: "job_not_found", job: null, waitTimedOut: false };
    }
    const refreshed = refreshJob(workspaceRoot, current);
    if (!ACTIVE_STATUSES.has(refreshed.status)) {
      return { job: refreshed, waitTimedOut: false };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  const timed = getJob(workspaceRoot, jobId);
  return { job: timed ? refreshJob(workspaceRoot, timed) : null, waitTimedOut: true };
}

export async function cancelJob(
  workspaceRoot,
  jobId,
  {
    terminate = terminateProcessTree,
    isWorkerAlive = isProcessAlive,
    isExpectedWorker = isExpectedWorkerProcess,
  } = {},
) {
  // Keep the public job active until a validated worker has been stopped. The envelope and ledger
  // are a durable cancellation intent, so a crash before the signal can be retried safely instead
  // of publishing "cancelled" while the worker still runs.
  let pidToKill = null;
  let configForCleanup = null;
  let cancellationEnvelope = null;
  let reason = null;
  const requestedAt = new Date().toISOString();
  const intentWrite = updateJobAtomically(workspaceRoot, jobId, (current, storedEnvelope) => {
    if (!current) {
      reason = "not_found";
      return null;
    }
    if (!ACTIVE_STATUSES.has(current.status)) {
      reason = "not_cancellable";
      return null;
    }
    const resumingCancellation = storedEnvelope?.job?.status === "cancelled";
    if (isTerminalEnvelope(storedEnvelope) && !resumingCancellation) {
      reason = "not_cancellable";
      return null;
    }

    pidToKill = current.pid ?? null;
    configForCleanup = readJobConfigFile(resolveJobConfigFile(workspaceRoot, jobId));
    const intentJob = resumingCancellation
      ? {
        ...current,
        ...storedEnvelope.job,
        status: "cancelled",
        pid: null,
        finishedAt: storedEnvelope.job.finishedAt || requestedAt,
        updatedAt: requestedAt,
      }
      : {
        ...current,
        status: "cancelled",
        pid: null,
        finishedAt: requestedAt,
        updatedAt: requestedAt,
      };
    const cancellationResult = resumingCancellation
      ? (storedEnvelope.result || { ok: false, error: "cancelled" })
      : { ok: false, error: "cancelled" };
    const terminal = prepareRecoveredTerminalEvents(workspaceRoot, intentJob, configForCleanup, {
      result: cancellationResult,
      reason: "cancelled",
      terminalDescriptor: storedEnvelope?.terminalDescriptor ?? null,
    });
    cancellationEnvelope = {
      job: intentJob,
      result: cancellationResult,
      terminalReason: "cancelled",
      terminalDescriptor: terminal.terminalDescriptor,
    };
    return {
      // Do not make the state terminal yet. It remains the recovery point if this process exits
      // after persisting the intent but before the worker receives its signal.
      job: current,
      envelope: cancellationEnvelope,
      beforeStateCommit() {
        ensureRecoveredTerminalEvents(workspaceRoot, terminal);
      },
    };
  });
  if (!intentWrite.written) {
    return { cancelled: false, reason: reason || "not_cancellable", jobId };
  }

  const configFile = resolveJobConfigFile(workspaceRoot, jobId);
  if (pidToKill && isWorkerAlive(pidToKill)) {
    if (!isExpectedWorker(pidToKill, configFile)) {
      return { cancelled: false, reason: "worker_identity_unverified", jobId };
    }
    try {
      await terminate(pidToKill, {
        signal: "SIGINT",
        forceSignal: "SIGKILL",
        forceAfterMs: 2_000,
      });
    } catch (error) {
      return { cancelled: false, reason: "kill_failed", jobId, killWarning: error.message };
    }
    if (isWorkerAlive(pidToKill)) {
      const postSignalIdentity = isExpectedWorker(pidToKill, configFile);
      if (postSignalIdentity === true) {
        return { cancelled: false, reason: "worker_still_running", jobId };
      }
      if (postSignalIdentity == null) {
        return { cancelled: false, reason: "worker_identity_unverified", jobId };
      }
    }
  }

  let finalConfig = configForCleanup;
  const finalWrite = updateJobAtomically(workspaceRoot, jobId, (current, storedEnvelope) => {
    if (!current) {
      reason = "not_found";
      return null;
    }
    if (current.status === "cancelled") return null;
    if (!ACTIVE_STATUSES.has(current.status) || storedEnvelope?.job?.status !== "cancelled") {
      reason = "cancellation_finalization_pending";
      return null;
    }
    finalConfig = readJobConfigFile(resolveJobConfigFile(workspaceRoot, jobId)) || finalConfig;
    const finishedAt = new Date().toISOString();
    const finalJob = {
      ...current,
      ...storedEnvelope.job,
      status: "cancelled",
      pid: null,
      finishedAt: storedEnvelope.job.finishedAt || finishedAt,
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
      },
      beforeStateCommit() {
        ensureRecoveredTerminalEvents(workspaceRoot, terminal);
      },
    };
  });
  if (!finalWrite.written) {
    const current = getJob(workspaceRoot, jobId);
    if (current?.status === "cancelled") {
      return { cancelled: true, jobId };
    }
    return { cancelled: false, reason: reason || "cancellation_finalization_pending", jobId };
  }

  // Runtime paths can contain the worker's live cwd, so only clean them after the verified stop
  // and the terminal state commit. The config remains available for any retry before this point.
  cleanupRuntimePaths(finalConfig);
  removeJobConfigFile(workspaceRoot, jobId);
  return { cancelled: true, jobId };
}
