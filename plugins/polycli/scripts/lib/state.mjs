import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Single hardened implementation of the atomic-write + lockfile primitives. state.mjs used to
// carry byte-for-byte copies of these; importing the shared utils version keeps the two in
// lockstep (so e.g. the no-pid stale-lock reclaim fix lands here too) instead of silently drifting.
import { withLockfile, writeJsonAtomic } from "@bbingz/polycli-utils/atomic-save";

const STATE_VERSION = 1;
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 100;
const POLYCLI_STATE_ROOT_ENV = "POLYCLI_STATE_ROOT";
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const ACTIVE_STATUSES = new Set(["queued", "running"]);
const FALLBACK_STATE_ROOT = path.join(os.homedir() || os.tmpdir(), ".polycli", "state");

function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout,
    stdio: options.stdio ?? "pipe",
  });
  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function computeWorkspaceSlug(workspaceRoot) {
  const base = path.basename(workspaceRoot).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "workspace";
  const hash = crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
  return `${base}-${hash}`;
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {},
    jobs: [],
  };
}

function buildCorruptBackupPath(stateFile) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stateFile}.corrupt-${timestamp}`;
}

function backupCorruptStateFile(stateFile) {
  try {
    fs.renameSync(stateFile, buildCorruptBackupPath(stateFile));
  } catch {
    // ignore
  }
}

export function describeStateRoot() {
  const polycliStateRoot = process.env[POLYCLI_STATE_ROOT_ENV];
  if (polycliStateRoot) {
    return {
      stateRoot: path.resolve(polycliStateRoot),
      source: POLYCLI_STATE_ROOT_ENV,
    };
  }

  const pluginData = process.env[PLUGIN_DATA_ENV];
  if (pluginData) {
    return {
      stateRoot: path.join(pluginData, "state"),
      source: PLUGIN_DATA_ENV,
    };
  }

  return {
    stateRoot: FALLBACK_STATE_ROOT,
    source: "home",
  };
}

function stateRootDir() {
  return describeStateRoot().stateRoot;
}

export function resolveWorkspaceRoot(cwd = process.cwd()) {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.status === 0 && result.stdout.trim()) {
    return path.resolve(result.stdout.trim());
  }
  return path.resolve(cwd);
}

export function resolveStateDir(workspaceRoot) {
  return path.join(stateRootDir(), computeWorkspaceSlug(workspaceRoot));
}

export function resolveStateFile(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), STATE_FILE_NAME);
}

export function resolveJobsDir(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), JOBS_DIR_NAME);
}

export function resolveJobFile(workspaceRoot, jobId) {
  return path.join(resolveJobsDir(workspaceRoot), `${jobId}.json`);
}

export function resolveJobLogFile(workspaceRoot, jobId) {
  return path.join(resolveJobsDir(workspaceRoot), `${jobId}.log`);
}

export function resolveJobConfigFile(workspaceRoot, jobId) {
  return path.join(resolveJobsDir(workspaceRoot), `${jobId}.config.json`);
}

function chmodPrivateDir(dir) {
  try {
    fs.chmodSync(dir, PRIVATE_DIR_MODE);
  } catch {
    // best-effort for existing host-managed directories
  }
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodPrivateDir(dir);
}

export function ensureStateDir(workspaceRoot) {
  ensurePrivateDir(stateRootDir());
  ensurePrivateDir(resolveStateDir(workspaceRoot));
  ensurePrivateDir(resolveJobsDir(workspaceRoot));
}

function pruneJobsForSave(jobs, { preserveJobIds = [] } = {}) {
  const sorted = jobs
    .slice()
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
  const active = sorted.filter((job) => ACTIVE_STATUSES.has(job.status));
  const terminal = sorted.filter((job) => !ACTIVE_STATUSES.has(job.status));
  const preserve = new Set(preserveJobIds);
  // updateJobAtomically has already made a terminal envelope durable before it calls saveState.
  // Keep that just-committed job in this state snapshot even if a skewed clock or old imported
  // records would otherwise rank it outside the normal terminal-history window.
  const protectedTerminal = terminal.filter((job) => preserve.has(job.jobId));
  const remainingTerminal = terminal.filter((job) => !preserve.has(job.jobId));
  const retainedTerminal = [
    ...protectedTerminal,
    ...remainingTerminal.slice(0, Math.max(0, MAX_JOBS - protectedTerminal.length)),
  ];
  return [...active, ...retainedTerminal]
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}

export function loadState(workspaceRoot) {
  const stateFile = resolveStateFile(workspaceRoot);
  let raw;
  try {
    raw = fs.readFileSync(stateFile, "utf8");
  } catch {
    return defaultState();
  }

  if (!raw.trim()) return defaultState();

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.jobs)) {
      backupCorruptStateFile(stateFile);
      return defaultState();
    }
    return {
      version: parsed.version ?? STATE_VERSION,
      config: parsed.config && typeof parsed.config === "object" ? parsed.config : {},
      jobs: parsed.jobs,
    };
  } catch {
    backupCorruptStateFile(stateFile);
    return defaultState();
  }
}

export function saveState(workspaceRoot, state, { preserveJobIds = [] } = {}) {
  ensureStateDir(workspaceRoot);
  const jobs = pruneJobsForSave(state.jobs, { preserveJobIds });
  const keptIds = new Set(jobs.map((job) => job.jobId));
  const config = state.config && typeof state.config === "object" ? state.config : {};
  writeJsonAtomic(resolveStateFile(workspaceRoot), { version: STATE_VERSION, config, jobs }, { mode: PRIVATE_FILE_MODE });
  // Publish the state snapshot before reclaiming pruned artifacts. A failed/interrupted state
  // write must leave its prior snapshot and every file it still references intact; an interrupted
  // cleanup only leaks old terminal artifacts and is safely retried by a later save.
  for (const job of state.jobs) {
    if (job && job.jobId && !keptIds.has(job.jobId)) {
      removeJobFile(workspaceRoot, job.jobId);
      removeJobConfigFile(workspaceRoot, job.jobId);
      removeJobLogFile(workspaceRoot, job.jobId);
    }
  }
  return { version: STATE_VERSION, config, jobs };
}

export function updateState(workspaceRoot, mutate) {
  ensureStateDir(workspaceRoot);
  const lockPath = `${resolveStateFile(workspaceRoot)}.lock`;
  return withLockfile(lockPath, () => {
    const state = loadState(workspaceRoot);
    mutate(state);
    return saveState(workspaceRoot, state);
  });
}

export function updateJobAtomically(workspaceRoot, jobId, buildNext) {
  ensureStateDir(workspaceRoot);
  const lockPath = `${resolveStateFile(workspaceRoot)}.lock`;
  return withLockfile(lockPath, () => {
    const state = loadState(workspaceRoot);
    const index = state.jobs.findIndex((job) => job.jobId === jobId);
    const current = index >= 0 ? state.jobs[index] : null;
    const currentEnvelope = readJobFile(resolveJobFile(workspaceRoot, jobId));
    const next = buildNext(current, currentEnvelope);

    if (!next) {
      return { written: false, job: current, envelope: null };
    }

    const job = next.job ?? current;
    if (!job) {
      return { written: false, job: null, envelope: next.envelope ?? null };
    }

    if (Object.prototype.hasOwnProperty.call(next, "envelope")) {
      writeJsonAtomic(resolveJobFile(workspaceRoot, jobId), next.envelope, { mode: PRIVATE_FILE_MODE });
    }

    if (typeof next.beforeStateCommit === "function") {
      next.beforeStateCommit({
        current,
        job,
        envelope: next.envelope ?? null,
      });
    }

    if (index >= 0) {
      state.jobs[index] = job;
    } else {
      state.jobs.push(job);
    }
    saveState(workspaceRoot, state, { preserveJobIds: [jobId] });
    return { written: true, job, envelope: next.envelope ?? null };
  });
}

export function upsertJob(workspaceRoot, jobPatch) {
  let savedJob = null;
  updateState(workspaceRoot, (state) => {
    const now = new Date().toISOString();
    const createdAt = jobPatch.createdAt || now;
    const updatedAt = jobPatch.updatedAt || now;
    const index = state.jobs.findIndex((job) => job.jobId === jobPatch.jobId);

    if (index >= 0) {
      state.jobs[index] = {
        ...state.jobs[index],
        ...jobPatch,
        updatedAt,
      };
      savedJob = state.jobs[index];
      return;
    }

    savedJob = {
      ...jobPatch,
      createdAt,
      updatedAt,
    };
    state.jobs.push(savedJob);
  });
  return savedJob;
}

export function listJobs(workspaceRoot) {
  return loadState(workspaceRoot).jobs.slice();
}

export function getJob(workspaceRoot, reference) {
  return listJobs(workspaceRoot).find((job) => job.jobId === reference) || null;
}

export function getConfig(workspaceRoot) {
  return loadState(workspaceRoot).config || {};
}

export function setConfig(workspaceRoot, key, value) {
  updateState(workspaceRoot, (state) => {
    state.config = state.config || {};
    state.config[key] = value;
  });
}

export function recordLastUsedProvider(workspaceRoot, provider) {
  if (typeof provider !== "string" || !provider.trim()) return;
  updateState(workspaceRoot, (state) => {
    state.config = state.config || {};
    state.config.lastUsedProvider = provider.trim();
    state.config.lastUsedProviderAt = new Date().toISOString();
  });
}

export function readLastUsedProvider(workspaceRoot) {
  const provider = getConfig(workspaceRoot).lastUsedProvider;
  return typeof provider === "string" && provider.trim() ? provider.trim() : null;
}

export function writeJobFile(workspaceRoot, jobId, payload) {
  ensureStateDir(workspaceRoot);
  writeJsonAtomic(resolveJobFile(workspaceRoot, jobId), payload, { mode: PRIVATE_FILE_MODE });
  return resolveJobFile(workspaceRoot, jobId);
}

export function readJobFile(jobFile) {
  try {
    return JSON.parse(fs.readFileSync(jobFile, "utf8"));
  } catch {
    return null;
  }
}

export function removeJobFile(workspaceRoot, jobId) {
  try {
    fs.unlinkSync(resolveJobFile(workspaceRoot, jobId));
  } catch {
    // ignore
  }
}

export function writeJobConfigFile(workspaceRoot, jobId, payload) {
  ensureStateDir(workspaceRoot);
  writeJsonAtomic(resolveJobConfigFile(workspaceRoot, jobId), payload, { mode: PRIVATE_FILE_MODE });
  return resolveJobConfigFile(workspaceRoot, jobId);
}

export function readJobConfigFile(configFile) {
  try {
    return JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {
    return null;
  }
}

export function removeJobConfigFile(workspaceRoot, jobId) {
  try {
    fs.unlinkSync(resolveJobConfigFile(workspaceRoot, jobId));
  } catch {
    // ignore
  }
}

export function removeJobLogFile(workspaceRoot, jobId) {
  try {
    fs.unlinkSync(resolveJobLogFile(workspaceRoot, jobId));
  } catch {
    // ignore
  }
}
