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

export function writeFileAtomic(filePath, contents, options = {}) {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, contents, options);
  fs.renameSync(tmpPath, filePath);
  return filePath;
}

export function writeJsonAtomic(filePath, value, { spaces = 2, finalNewline = true } = {}) {
  const text = JSON.stringify(value, null, spaces) + (finalNewline ? "\n" : "");
  return writeFileAtomic(filePath, text, "utf8");
}

export function withLockfile(
  lockPath,
  fn,
  { timeoutMs = 10_000, staleMs = 30_000, pollMs = 25 } = {}
) {
  ensureParentDir(lockPath);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.closeSync(fd);
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
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
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
