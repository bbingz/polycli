import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STATE_VERSION = 1;
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 100;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT = path.join(os.tmpdir(), "polycli-companion");

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
  const fd = fs.openSync(tmpPath, "w", 0o666);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
  try {
    const dirFd = fs.openSync(path.dirname(filePath), "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) {
      throw error;
    }
  }
}

function withLockfile(lockPath, fn, { timeoutMs = 10_000, staleMs = 600_000, pollMs = 25 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o600
      );
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        return fn();
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        const pid = Number.isInteger(lock?.pid) && lock.pid > 0 ? lock.pid : null;
        const acquiredAt = Number.isFinite(lock?.acquiredAt) ? lock.acquiredAt : null;
        const lockAgeMs = acquiredAt == null ? null : Date.now() - acquiredAt;
        let ownerAlive = false;

        if (pid != null) {
          try {
            process.kill(pid, 0);
            ownerAlive = true;
          } catch (killError) {
            if (killError.code === "ESRCH") {
              fs.unlinkSync(lockPath);
              continue;
            }
            if (killError.code !== "EPERM") {
              throw killError;
            }
            ownerAlive = true;
          }
        }

        if (ownerAlive && lockAgeMs != null && lockAgeMs > staleMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      sleepSync(pollMs);
    }
  }

  const error = new Error(`Timed out acquiring lockfile ${lockPath} after ${timeoutMs}ms`);
  error.code = "ELOCKTIMEOUT";
  throw error;
}

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

function computeWorkspaceSlug(workspaceRoot) {
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

function stateRootDir() {
  const pluginData = process.env[PLUGIN_DATA_ENV];
  if (pluginData) {
    return path.join(pluginData, "state");
  }
  return FALLBACK_STATE_ROOT;
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

export function ensureStateDir(workspaceRoot) {
  fs.mkdirSync(resolveJobsDir(workspaceRoot), { recursive: true });
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

export function saveState(workspaceRoot, state) {
  ensureStateDir(workspaceRoot);
  const jobs = state.jobs
    .slice()
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""))
    .slice(0, MAX_JOBS);
  const config = state.config && typeof state.config === "object" ? state.config : {};
  writeJsonAtomic(resolveStateFile(workspaceRoot), { version: STATE_VERSION, config, jobs });
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
    const next = buildNext(current);

    if (!next) {
      return { written: false, job: current, envelope: null };
    }

    const job = next.job ?? current;
    if (!job) {
      return { written: false, job: null, envelope: next.envelope ?? null };
    }

    if (Object.prototype.hasOwnProperty.call(next, "envelope")) {
      writeJsonAtomic(resolveJobFile(workspaceRoot, jobId), next.envelope);
    }

    if (index >= 0) {
      state.jobs[index] = job;
    } else {
      state.jobs.push(job);
    }
    saveState(workspaceRoot, state);
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
  writeJsonAtomic(resolveJobFile(workspaceRoot, jobId), payload);
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
  writeJsonAtomic(resolveJobConfigFile(workspaceRoot, jobId), payload);
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
