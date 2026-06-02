import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export class LockfileTimeoutError extends Error {
  constructor(lockPath, timeoutMs) {
    super(`Timed out acquiring lockfile ${lockPath} after ${timeoutMs}ms`);
    this.code = "ELOCKTIMEOUT";
    this.lockPath = lockPath;
    this.timeoutMs = timeoutMs;
  }
}

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeWriteOptions(options) {
  if (typeof options === "string") {
    return {
      flag: "w",
      mode: 0o666,
      writeOptions: options,
    };
  }

  if (options && typeof options === "object") {
    const { flag = "w", mode = 0o666, ...writeOptions } = options;
    return {
      flag,
      mode,
      writeOptions: Object.keys(writeOptions).length > 0 ? writeOptions : undefined,
    };
  }

  return {
    flag: "w",
    mode: 0o666,
    writeOptions: undefined,
  };
}

function writeFileAtomicSync(filePath, contents, options = {}) {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
  const { flag, mode, writeOptions } = normalizeWriteOptions(options);
  const fd = fs.openSync(tmpPath, flag, mode);

  try {
    fs.writeFileSync(fd, contents, writeOptions);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, filePath);

  const dirFd = fs.openSync(path.dirname(filePath), "r");
  try {
    fs.fsyncSync(dirFd);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) {
      throw error;
    }
  } finally {
    fs.closeSync(dirFd);
  }
}

export function writeFileAtomic(filePath, contents, options = {}) {
  writeFileAtomicSync(filePath, contents, options);
  return filePath;
}

export function writeJsonAtomic(filePath, value, { spaces = 2, finalNewline = true } = {}) {
  const text = JSON.stringify(value, null, spaces) + (finalNewline ? "\n" : "");
  return writeFileAtomic(filePath, text, "utf8");
}

function unlinkIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already gone — fine
  }
}

// Decide whether an existing (EEXIST) lock can be reclaimed. Returns true when the lock was
// removed (or already vanished) and the caller should retry acquiring; false when it is still
// held by a live owner and the caller should keep waiting. Handles the partial-write case where
// the holder crashed after O_EXCL created the file but before/while writing a valid {pid} body:
// such a no-pid / unparseable lock is reclaimed by age (acquiredAt or file mtime) once stale,
// instead of wedging the store for the full timeout.
function tryReclaimStaleLock(lockPath, staleMs) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch {
    return true; // vanished between EEXIST and read — retry the acquire
  }

  let lock = null;
  try {
    lock = JSON.parse(raw);
  } catch {
    lock = null;
  }

  const pid = Number.isInteger(lock?.pid) && lock.pid > 0 ? lock.pid : null;
  const acquiredAt = Number.isFinite(lock?.acquiredAt) ? lock.acquiredAt : null;

  if (pid != null) {
    try {
      process.kill(pid, 0);
    } catch (killError) {
      if (killError.code === "ESRCH") {
        unlinkIfExists(lockPath);
        return true;
      }
      if (killError.code !== "EPERM") {
        throw killError;
      }
      // EPERM: owner is alive but not ours — fall through to the stale-age check.
    }
    const ageMs = acquiredAt == null ? null : Date.now() - acquiredAt;
    if (ageMs != null && ageMs > staleMs) {
      unlinkIfExists(lockPath);
      return true;
    }
    return false;
  }

  // No valid pid: holder crashed mid-write (partial/empty/malformed lock body). Reclaim once
  // older than staleMs, using acquiredAt when present otherwise the lock file's mtime.
  let ageMs = acquiredAt == null ? null : Date.now() - acquiredAt;
  if (ageMs == null) {
    try {
      ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch {
      return true; // vanished — retry the acquire
    }
  }
  if (ageMs != null && ageMs > staleMs) {
    unlinkIfExists(lockPath);
    return true;
  }
  return false;
}

export function withLockfile(
  lockPath,
  fn,
  { timeoutMs = 10_000, staleMs = 600_000, pollMs = 25 } = {}
) {
  ensureParentDir(lockPath);
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
      if (tryReclaimStaleLock(lockPath, staleMs)) {
        continue;
      }
      sleepSync(pollMs);
    }
  }

  throw new LockfileTimeoutError(lockPath, timeoutMs);
}
