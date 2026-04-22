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
