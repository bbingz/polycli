import fs from "node:fs";
import os from "node:os";
import process from "node:process";

import { terminateProcessTree } from "@bbingz/polycli-utils/process";
import { withLockfile } from "@bbingz/polycli-utils/atomic-save";

import {
  getJob,
  listJobs,
  readJobFile,
  readJobConfigFile,
  removeJobConfigFile,
  resolveJobConfigFile,
  resolveJobFile,
  updateJobAtomically,
  writeJobFile,
  upsertJob,
} from "./state.mjs";
import {
  appendRunLedgerEvent,
  readRunLedgerEvents,
  resolveRunLedgerFile,
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

function hasLedgerPhase(events, runId, jobId, phase) {
  return events.some((event) => event.runId === runId && event.jobId === jobId && event.phase === phase);
}

function recoverLedgerTerminalEvents(workspaceRoot, job, { result = null, reason = "worker_exited" } = {}) {
  const config = readJobConfigFile(resolveJobConfigFile(workspaceRoot, job.jobId));
  const runContext = config?.runContext;
  if (!runContext?.runId) return;

  // Serialize the whole read -> hasLedgerPhase -> append -> removeConfig across processes.
  // appendRunLedgerEvent only locks its own single append, so two concurrent refreshJob() callers
  // could both observe "no terminal events yet" and each append, double-counting the run. The
  // recover lock is a distinct path from the ndjson append lock, so there is no deadlock.
  const recoverLock = `${resolveRunLedgerFile(workspaceRoot)}.recover.lock`;
  withLockfile(recoverLock, () =>
    writeRecoveredTerminalEvents(workspaceRoot, job, config, runContext, { result, reason }));
}

function writeRecoveredTerminalEvents(workspaceRoot, job, config, runContext, { result = null, reason = "worker_exited" } = {}) {
  const events = readRunLedgerEvents(workspaceRoot);
  const command = runContext.command || config?.execution?.kind || job.kind || null;
  const provider = runContext.provider || config?.execution?.provider || job.provider || null;
  const kind = runContext.kind || config?.execution?.kind || job.kind || command;
  const status = result?.ok ? "completed" : "failed";
  const decisionStatus = result?.ok ? "adopted" : "failed";
  const decisionReason = result?.ok ? null : reason;
  const errorMessage = result?.ok ? null : (result?.error || job.error || "worker exited before writing a result envelope");

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
    model: result?.model || runContext.model || config?.execution?.model || job.model || null,
    defaultModel: result?.defaultModel || runContext.defaultModel || config?.execution?.defaultModel || null,
    hostSurface: runContext.hostSurface || "unknown",
    logFile: runContext.logFile || job.logFile || null,
  };

  if (!hasLedgerPhase(events, runContext.runId, job.jobId, "attempt_result")) {
    appendRunLedgerEvent(workspaceRoot, {
      ...base,
      phase: "attempt_result",
      status,
      reason,
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
    });
  }

  if (!hasLedgerPhase(events, runContext.runId, job.jobId, "provider_decision")) {
    appendRunLedgerEvent(workspaceRoot, {
      ...base,
      phase: "provider_decision",
      status: decisionStatus,
      reason: decisionReason,
    });
  }

  removeJobConfigFile(workspaceRoot, job.jobId);
}

export function refreshJob(workspaceRoot, job) {
  if (!job || !ACTIVE_STATUSES.has(job.status)) {
    return job ? enrichJob(workspaceRoot, job) : null;
  }
  if (!job.pid || isProcessAlive(job.pid)) {
    return enrichJob(workspaceRoot, job);
  }

  const envelope = readJobFile(resolveJobFile(workspaceRoot, job.jobId));
  if (envelope?.job) {
    const finalized = {
      ...job,
      ...envelope.job,
      pid: null,
    };
    upsertJob(workspaceRoot, finalized);
    recoverLedgerTerminalEvents(workspaceRoot, finalized, { result: envelope.result || null, reason: `${finalized.kind || job.kind}_failed` });
    return enrichJob(workspaceRoot, finalized);
  }

  const failed = {
    ...job,
    status: "failed",
    pid: null,
    finishedAt: new Date().toISOString(),
    error: "worker exited before writing a result envelope",
  };
  upsertJob(workspaceRoot, failed);
  writeJobFile(workspaceRoot, job.jobId, {
    job: failed,
    result: { ok: false, error: failed.error },
  });
  recoverLedgerTerminalEvents(workspaceRoot, failed, {
    result: { ok: false, error: failed.error },
    reason: "worker_exited",
  });
  return enrichJob(workspaceRoot, failed);
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

export async function cancelJob(workspaceRoot, jobId) {
  // Flip the job to cancelled and capture its pid atomically under the state lock FIRST, then
  // signal that pid. Previously cancelJob read the job WITHOUT a lock and killed job.pid before
  // re-validating, so a stale pre-lock snapshot could signal a pid the worker had already freed
  // (and the OS reused). The pid we kill below was confirmed ACTIVE at lock time.
  let pidToKill = null;
  let reason = null;
  const finishedAt = new Date().toISOString();
  const write = updateJobAtomically(workspaceRoot, jobId, (current) => {
    if (!current) {
      reason = "not_found";
      return null;
    }
    if (!ACTIVE_STATUSES.has(current.status)) {
      reason = "not_cancellable";
      return null;
    }
    pidToKill = current.pid ?? null;
    const nextJob = {
      ...current,
      status: "cancelled",
      pid: null,
      finishedAt,
    };
    return {
      job: nextJob,
      envelope: {
        job: nextJob,
        result: {
          ok: false,
          error: "cancelled",
        },
      },
    };
  });
  if (!write.written) {
    return { cancelled: false, reason: reason || "not_cancellable", jobId };
  }

  if (pidToKill) {
    try {
      await terminateProcessTree(pidToKill, {
        signal: "SIGINT",
        forceSignal: "SIGKILL",
        forceAfterMs: 2_000,
      });
    } catch (error) {
      // The job is already recorded as cancelled; surface the kill problem without un-cancelling.
      return { cancelled: true, jobId, killWarning: error.message };
    }
  }
  return { cancelled: true, jobId };
}
