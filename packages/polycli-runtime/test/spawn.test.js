import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

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
