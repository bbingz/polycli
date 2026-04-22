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

  throw new LockfileTimeoutError(lockPath, timeoutMs);
}
