import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import process from "node:process";

import { spawnStreamingCommand } from "../src/spawn.js";

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write() {},
    end() {},
    on() {},
  };
  child.kill = () => {};
  return child;
}

test("spawnStreamingCommand resolves a structured failure when spawn emits error", async () => {
  const child = createFakeChild();
  const resultPromise = spawnStreamingCommand({
    bin: "missing-bin",
    args: [],
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn missing-bin ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test("spawnStreamingCommand escalates timed out detached children to SIGKILL via process group", async () => {
  const child = createFakeChild();
  child.pid = 43210;
  child.unref = () => {};

  const originalKill = process.kill;
  const calls = [];

  process.kill = (pid, signal) => {
    calls.push({ pid, signal });
    if (signal === "SIGKILL") {
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    }
    return true;
  };

  try {
    const result = await spawnStreamingCommand({
      bin: "slow-bin",
      args: [],
      timeout: 5,
      killGraceMs: 5,
      detached: true,
      spawnImpl() {
        return child;
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.deepEqual(calls, [
      { pid: -43210, signal: "SIGTERM" },
      { pid: -43210, signal: "SIGKILL" },
    ]);
  } finally {
    process.kill = originalKill;
  }
});

test("spawnStreamingCommand waits for stdin drain before ending input", async () => {
  const child = createFakeChild();
  const calls = [];

  child.stdin = new EventEmitter();
  child.stdin.write = () => {
    calls.push("write");
    queueMicrotask(() => child.stdin.emit("drain"));
    return false;
  };
  child.stdin.end = () => {
    calls.push("end");
    queueMicrotask(() => child.emit("close", 0, null));
  };

  const result = await spawnStreamingCommand({
    bin: "slow-stdin",
    args: [],
    input: "hello",
    spawnImpl() {
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["write", "end"]);
});

test("spawnStreamingCommand supports AbortSignal-driven termination", async () => {
  const child = createFakeChild();
  const controller = new AbortController();
  const calls = [];

  child.kill = (signal) => {
    calls.push(signal);
    queueMicrotask(() => child.emit("close", null, signal));
  };

  const resultPromise = spawnStreamingCommand({
    bin: "abortable-bin",
    args: [],
    signal: controller.signal,
    spawnImpl() {
      return child;
    },
  });

  controller.abort();
  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.equal(result.error, "process aborted");
  assert.deepEqual(calls, ["SIGTERM"]);
});

test("spawnStreamingCommand ignores stdout emitted after settle", async () => {
  const child = createFakeChild();
  const seen = [];

  const result = await spawnStreamingCommand({
    bin: "late-output-bin",
    args: [],
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("first\n"));
        child.emit("close", 0, null);
        child.stdout.emit("data", Buffer.from("second\n"));
      });
      return child;
    },
    onStdoutLine(line) {
      seen.push(line);
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(seen, ["first"]);
  assert.equal(result.stdout, "first\n");
});

test("spawnStreamingCommand terminates detached decoder overflows before settling once", async () => {
  const child = createFakeChild();
  const seen = [];
  const calls = [];
  let resolutions = 0;
  child.pid = 43211;

  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    calls.push({ pid, signal });
    if (signal === "SIGTERM") {
      child.emit("error", new Error("termination pending"));
    }
    if (signal === "SIGKILL") {
      child.stdout.emit("data", Buffer.from("late\n"));
      child.emit("close", 137, "SIGKILL");
    }
    return true;
  };

  try {
    const resultPromise = spawnStreamingCommand({
      bin: "overflowing-bin",
      args: [],
      detached: true,
      killGraceMs: 5,
      maxBufferBytes: 4,
      spawnImpl() {
        queueMicrotask(() => child.stdout.emit("data", Buffer.from("hello")));
        return child;
      },
      onStdoutLine(line) {
        seen.push(line);
      },
    });
    resultPromise.then(() => {
      resolutions += 1;
    });

    const result = await resultPromise;
    child.emit("close", 137, "SIGKILL");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(result.ok, false);
    assert.equal(result.status, 137);
    assert.equal(result.signal, "SIGKILL");
    assert.match(result.error, /Line buffer exceeded maxBufferBytes/);
    assert.deepEqual(calls, [
      { pid: -43211, signal: "SIGTERM" },
      { pid: -43211, signal: "SIGKILL" },
    ]);
    assert.deepEqual(seen, []);
    assert.equal(result.stdout, "");
    assert.equal(resolutions, 1);
  } finally {
    process.kill = originalKill;
  }
});
