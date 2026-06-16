import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { once } from "node:events";

import { LockfileTimeoutError, withLockfile, writeFileAtomic, writeJsonAtomic } from "../src/atomic-save.js";

function fileMode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

test("writeFileAtomic fsyncs the temp file before rename and fsyncs the parent dir after rename", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-atomic-save-"));
  const filePath = path.join(dir, "state.json");
  const events = [];
  let tempFd = null;
  let dirFd = null;

  const openSync = fs.openSync.bind(fs);
  const fsyncSync = fs.fsyncSync.bind(fs);
  const renameSync = fs.renameSync.bind(fs);

  t.mock.method(fs, "openSync", (target, flags, mode) => {
    const fd = openSync(target, flags, mode);
    const resolved = String(target);
    events.push(["open", resolved, fd]);
    if (resolved.startsWith(`${filePath}.tmp.`)) tempFd = fd;
    if (resolved === dir) dirFd = fd;
    return fd;
  });
  t.mock.method(fs, "fsyncSync", (fd) => {
    events.push(["fsync", fd]);
    return fsyncSync(fd);
  });
  t.mock.method(fs, "renameSync", (from, to) => {
    events.push(["rename", String(from), String(to)]);
    return renameSync(from, to);
  });

  writeFileAtomic(filePath, '{"ok":true}\n', "utf8");

  assert.equal(fs.readFileSync(filePath, "utf8"), '{"ok":true}\n');
  assert.notEqual(tempFd, null);
  assert.notEqual(dirFd, null);

  const fileFsyncIndex = events.findIndex(([kind, value]) => kind === "fsync" && value === tempFd);
  const renameIndex = events.findIndex(([kind]) => kind === "rename");
  const dirFsyncIndex = events.findLastIndex(([kind, value]) => kind === "fsync" && value === dirFd);

  assert.notEqual(fileFsyncIndex, -1);
  assert.notEqual(renameIndex, -1);
  assert.notEqual(dirFsyncIndex, -1);
  assert.ok(fileFsyncIndex < renameIndex, "temp file fsync should happen before rename");
  assert.ok(renameIndex < dirFsyncIndex, "directory fsync should happen after rename");
});

test("writeFileAtomic removes the temp file when rename fails", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-atomic-save-fail-"));
  const filePath = path.join(dir, "state.json");
  let tmpPath = null;

  t.mock.method(fs, "renameSync", (from) => {
    tmpPath = String(from);
    const error = new Error("rename failed");
    error.code = "EXDEV";
    throw error;
  });

  assert.throws(
    () => writeFileAtomic(filePath, '{"ok":true}\n', "utf8"),
    /rename failed/
  );
  assert.equal(fs.existsSync(tmpPath), false);
  assert.equal(fs.existsSync(filePath), false);
});

test("writeJsonAtomic accepts a private file mode", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-json-save-mode-"));
  const filePath = path.join(dir, "state.json");

  writeJsonAtomic(filePath, { ok: true }, { mode: 0o600 });

  assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).ok, true);
  assert.equal(fileMode(filePath), 0o600);
});

test("withLockfile does not reclaim a live owner pid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-lock-live-"));
  const lockPath = path.join(dir, "state.lock");
  const contents = JSON.stringify({ pid: process.pid, acquiredAt: Date.now() });
  fs.writeFileSync(lockPath, contents, "utf8");

  assert.throws(
    () => withLockfile(lockPath, () => "unreachable", { timeoutMs: 25, pollMs: 1, staleMs: 1_000 }),
    LockfileTimeoutError
  );
  assert.equal(fs.readFileSync(lockPath, "utf8"), contents);
});

test("withLockfile reclaims a dead owner pid", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-lock-dead-"));
  const lockPath = path.join(dir, "state.lock");
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await once(child, "close");
  fs.writeFileSync(lockPath, JSON.stringify({ pid: child.pid, acquiredAt: Date.now() }), "utf8");

  const result = withLockfile(lockPath, () => JSON.parse(fs.readFileSync(lockPath, "utf8")), {
    timeoutMs: 100,
    pollMs: 1,
    staleMs: 10_000,
  });

  assert.equal(result.pid, process.pid);
  assert.ok(result.acquiredAt <= Date.now());
  assert.equal(fs.existsSync(lockPath), false);
});

test("withLockfile does not reclaim a stale lock while the recorded pid is live", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-lock-reused-"));
  const lockPath = path.join(dir, "state.lock");
  const reusedPid = process.pid + 10_000;
  const contents = JSON.stringify({
    pid: reusedPid,
    acquiredAt: Date.now() - 1_000,
  });
  fs.writeFileSync(lockPath, contents, "utf8");

  const kill = t.mock.method(process, "kill", (pid, signal) => {
    assert.equal(pid, reusedPid);
    assert.equal(signal, 0);
    return true;
  });

  assert.throws(
    () => withLockfile(lockPath, () => "unreachable", { timeoutMs: 25, pollMs: 1, staleMs: 25 }),
    LockfileTimeoutError
  );

  assert.ok(kill.mock.callCount() >= 1);
  assert.equal(fs.readFileSync(lockPath, "utf8"), contents);
});

test("withLockfile reclaims a stale no-pid (partial-write) lock by mtime", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-lock-nopid-"));
  const lockPath = path.join(dir, "state.lock");
  // Holder crashed after O_EXCL created the file but before writing a valid {pid} body.
  fs.writeFileSync(lockPath, "", "utf8");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, old, old);

  const result = withLockfile(lockPath, () => "acquired", {
    timeoutMs: 100,
    pollMs: 1,
    staleMs: 25,
  });

  assert.equal(result, "acquired");
  assert.equal(fs.existsSync(lockPath), false);
});

test("withLockfile waits on a fresh no-pid lock instead of reclaiming it immediately", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-lock-nopid-fresh-"));
  const lockPath = path.join(dir, "state.lock");
  fs.writeFileSync(lockPath, "", "utf8"); // fresh empty lock (mtime ~ now)

  assert.throws(
    () => withLockfile(lockPath, () => "unreachable", { timeoutMs: 25, pollMs: 1, staleMs: 10_000 }),
    LockfileTimeoutError
  );
});
