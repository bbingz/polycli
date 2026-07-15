#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { isExpectedWorkerProcess } from "./lib/job-control.mjs";
import {
  resolveJobConfigFile,
  resolveStateFile,
  resolveWorkspaceRoot,
  updateState,
} from "./lib/state.mjs";

export const SESSION_ID_ENV = "POLYCLI_COMPANION_SESSION_ID";

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

function terminateProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already gone.
    }
  }
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

export function cleanupSessionJobs(cwd, sessionId, {
  isExpectedWorkerProcess: verifyWorker = isExpectedWorkerProcess,
  terminateProcess: terminateWorker = terminateProcess,
} = {}) {
  if (!cwd || !sessionId) return;

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) return;

  const workersToTerminate = [];
  updateState(workspaceRoot, (state) => {
    const jobs = Array.isArray(state.jobs) ? state.jobs : [];
    const sessionJobs = jobs.filter((job) => jobHostSessionId(job) === sessionId);
    if (sessionJobs.length === 0) return;

    for (const job of sessionJobs) {
      if (job.status === "running" || job.status === "queued") {
        workersToTerminate.push({
          pid: job.pid,
          configFile: resolveJobConfigFile(workspaceRoot, job.jobId),
        });
      }
    }

    state.jobs = jobs.filter((job) => {
      if (jobHostSessionId(job) !== sessionId) return true;
      return job.status === "completed"
        || job.status === "failed"
        || job.status === "cancelled";
    });
  });

  for (const { pid, configFile } of workersToTerminate) {
    if (!Number.isInteger(pid) || pid <= 1 || !fs.existsSync(configFile)) continue;
    if (verifyWorker(pid, configFile) !== true) continue;
    terminateWorker(pid);
  }
}

export function handleLifecycleHook(eventName, input = {}) {
  if (eventName === "SessionStart") {
    appendEnvVar(SESSION_ID_ENV, input.session_id);
    return;
  }

  if (eventName === "SessionEnd") {
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id || process.env[SESSION_ID_ENV];
    cleanupSessionJobs(cwd, sessionId);
  }
}

function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";
  handleLifecycleHook(eventName, input);
}

if (process.argv[1] && process.argv[1].endsWith("session-lifecycle-hook.mjs")) {
  try {
    main();
  } catch (err) {
    process.stderr.write(
      `[polycli session-lifecycle-hook] fatal: ${err && err.message ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}
