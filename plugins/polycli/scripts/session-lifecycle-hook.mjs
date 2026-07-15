#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { cancelJob } from "./lib/job-control.mjs";
import {
  listJobs,
  resolveStateFile,
  resolveWorkspaceRoot,
} from "./lib/state.mjs";

export const SESSION_ID_ENV = "POLYCLI_COMPANION_SESSION_ID";
export const SESSION_END_BUDGET_MS = 4_000;

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") {
    return;
  }
  fs.appendFileSync(
    process.env.CLAUDE_ENV_FILE,
    `export ${name}=${shellEscape(value)}\n`,
    "utf8"
  );
}

function jobHostSessionId(job) {
  if (!job || typeof job !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(job, "hostSessionId")) {
    return job.hostSessionId ?? null;
  }
  // Legacy sessionId represented host ownership only while a job was active.
  return job.status === "running" || job.status === "queued"
    ? (job.sessionId ?? null)
    : null;
}

export async function cleanupSessionJobs(cwd, sessionId, {
  cancel = cancelJob,
  isExpectedWorkerProcess: verifyWorker,
  terminateProcess: terminateWorker,
  isWorkerAlive,
  budgetMs = SESSION_END_BUDGET_MS,
} = {}) {
  const cleanupStartedAt = Date.now();
  if (!cwd || !sessionId) return [];
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new TypeError("budgetMs must be a positive number");
  }

  const deadlineAt = cleanupStartedAt + budgetMs;
  const workspaceRoot = resolveWorkspaceRoot(cwd, { deadlineAt });
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) return [];

  // Snapshot ownership only; cancelJob remains authoritative for every state, ledger, identity,
  // termination, and cleanup transition. Running cancellations concurrently keeps SessionEnd
  // within the hook timeout while each per-job state lock preserves serialization.
  const active = listJobs(workspaceRoot).filter((job) =>
    (job.status === "running" || job.status === "queued")
      && jobHostSessionId(job) === sessionId
  );
  const cancelOptions = {
    deadlineAt,
    ...(verifyWorker ? { isExpectedWorker: verifyWorker } : {}),
    ...(terminateWorker ? { terminate: terminateWorker } : {}),
    ...(isWorkerAlive ? { isWorkerAlive } : {}),
  };
  return Promise.allSettled(active.map((job) => cancel(workspaceRoot, job.jobId, cancelOptions)));
}

export async function handleLifecycleHook(eventName, input = {}) {
  if (eventName === "SessionStart") {
    appendEnvVar(SESSION_ID_ENV, input.session_id);
    return;
  }

  if (eventName === "SessionEnd") {
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id || process.env[SESSION_ID_ENV];
    await cleanupSessionJobs(cwd, sessionId);
  }
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";
  await handleLifecycleHook(eventName, input);
}

if (process.argv[1] && process.argv[1].endsWith("session-lifecycle-hook.mjs")) {
  main().catch((err) => {
    process.stderr.write(
      `[polycli session-lifecycle-hook] fatal: ${err && err.message ? err.message : String(err)}\n`
    );
    process.exitCode = 1;
  });
}
