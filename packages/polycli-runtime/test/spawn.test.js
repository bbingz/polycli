import test from "node:test";
import assert from "node:assert/strict";
import { spawn as nodeSpawn } from "node:child_process";
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

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return !isProcessAlive(pid);
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

test("spawnStreamingCommand preserves E2BIG as a canonical structured failure", async () => {
  const child = createFakeChild();
  const resultPromise = spawnStreamingCommand({
    bin: "oversized-argv-bin",
    args: [],
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn oversized-argv-bin E2BIG");
        error.code = "E2BIG";
        child.emit("error", error);
      });
      return child;
    },
  });

  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.spawnErrorCode, "E2BIG");
  assert.equal(result.errorCode, "argument_list_too_long");
});

test("spawnStreamingCommand rejects an oversized argv footprint before calling spawn", async () => {
  let spawnCalls = 0;
  const marker = "STREAM_PROMPT_SECRET_" + "x".repeat(256);
  const result = await spawnStreamingCommand({
    bin: "provider",
    args: [marker],
    env: { PRIVATE_TOKEN: "STREAM_ENV_SECRET" },
    argvBudgetBytes: 64,
    argvBudgetHint: "For review, pass --max-diff-bytes explicitly.",
    spawnImpl() {
      spawnCalls += 1;
      throw new Error("spawn must not be called");
    },
  });

  assert.equal(spawnCalls, 0);
  assert.equal(result.spawnErrorCode, "E2BIG");
  assert.equal(result.errorCode, "argument_list_too_long");
  assert.match(result.error, /--max-diff-bytes/);
  assert.doesNotMatch(result.error, /STREAM_PROMPT_SECRET|STREAM_ENV_SECRET/);
});

test("spawnStreamingCommand includes the effective environment in its argv budget preflight", async () => {
  let spawnCalls = 0;
  const result = await spawnStreamingCommand({
    bin: "provider",
    args: ["short"],
    env: { PRIVATE_TOKEN: "STREAM_ENV_ONLY_SECRET_" + "x".repeat(256) },
    argvBudgetBytes: 64,
    spawnImpl() {
      spawnCalls += 1;
      throw new Error("spawn must not be called");
    },
  });

  assert.equal(spawnCalls, 0);
  assert.equal(result.spawnErrorCode, "E2BIG");
  assert.equal(result.errorCode, "argument_list_too_long");
  assert.doesNotMatch(result.error, /STREAM_ENV_ONLY_SECRET/);
});

test("spawnStreamingCommand still calls spawn for argv inside the configured budget", async () => {
  const child = createFakeChild();
  let spawnCalls = 0;
  const resultPromise = spawnStreamingCommand({
    bin: "provider",
    args: ["short"],
    env: {},
    argvBudgetBytes: 1_024,
    spawnImpl() {
      spawnCalls += 1;
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
  });

  const result = await resultPromise;
  assert.equal(spawnCalls, 1);
  assert.equal(result.ok, true);
});

test("spawnStreamingCommand defaults provider children to their own POSIX process group", {
  skip: process.platform === "win32",
}, async () => {
  const child = createFakeChild();
  let spawnOptions;

  const result = await spawnStreamingCommand({
    bin: "provider-bin",
    args: [],
    spawnImpl(_bin, _args, options) {
      spawnOptions = options;
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(spawnOptions.detached, true);
});

test("spawnStreamingCommand timeout removes a real local descendant process tree", {
  skip: process.platform === "win32",
}, async () => {
  const descendantScript = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
  const providerScript = `
    const { spawn } = require("node:child_process");
    const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], {
      stdio: "ignore",
    });
    process.stdout.write(String(descendant.pid) + "\\n");
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  `;
  let rootPid = null;
  let descendantPid = null;

  try {
    const result = await spawnStreamingCommand({
      bin: process.execPath,
      args: ["-e", providerScript],
      timeout: 150,
      killGraceMs: 30,
      spawnImpl(bin, args, options) {
        const child = nodeSpawn(bin, args, options);
        rootPid = child.pid;
        return child;
      },
      onStdoutLine(line) {
        if (/^\d+$/.test(line)) {
          descendantPid = Number(line);
        }
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "timeout");
    assert.equal(Number.isInteger(descendantPid), true);
    assert.equal(await waitForProcessExit(descendantPid), true, `descendant ${descendantPid} survived`);
  } finally {
    if (Number.isInteger(rootPid) && rootPid > 0) {
      try { process.kill(-rootPid, "SIGKILL"); } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    if (Number.isInteger(descendantPid) && descendantPid > 0 && isProcessAlive(descendantPid)) {
      try { process.kill(descendantPid, "SIGKILL"); } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      await waitForProcessExit(descendantPid);
    }
  }
});

test("spawnStreamingCommand formats a nonzero exit when stderr is empty", async () => {
  const child = createFakeChild();

  const result = await spawnStreamingCommand({
    bin: "failing-bin",
    args: [],
    spawnImpl() {
      queueMicrotask(() => child.emit("close", 2, null));
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "process exited with code 2");
});

test("spawnStreamingCommand escalates timed out detached children to SIGKILL via process group", {
  skip: process.platform === "win32",
}, async () => {
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

test("spawnStreamingCommand settles after kill errors even when close never arrives", async () => {
  const child = createFakeChild();
  const calls = [];
  child.kill = (signal) => {
    calls.push(signal);
    const error = new Error(`kill ${signal} EPERM`);
    error.code = "EPERM";
    throw error;
  };

  const pending = Symbol("pending");
  const result = await Promise.race([
    spawnStreamingCommand({
      bin: "unkillable-bin",
      args: [],
      timeout: 5,
      killGraceMs: 5,
      spawnImpl() {
        return child;
      },
    }),
    new Promise((resolve) => setTimeout(() => resolve(pending), 100)),
  ]);

  assert.notEqual(result, pending, "spawn result must not depend on close after termination");
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "timeout");
  assert.equal(result.closeTimedOut, true);
  assert.deepEqual(calls, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(
    result.terminationErrors.map(({ signal, code }) => ({ signal, code })),
    [
      { signal: "SIGTERM", code: "EPERM" },
      { signal: "SIGKILL", code: "EPERM" },
    ]
  );
});

test("spawnStreamingCommand keeps timeout classification ahead of stderr diagnostics", async () => {
  const child = createFakeChild();
  child.kill = (signal) => {
    queueMicrotask(() => child.emit("close", null, signal));
  };

  const result = await spawnStreamingCommand({
    bin: "warning-before-timeout-bin",
    args: [],
    timeout: 5,
    spawnImpl() {
      queueMicrotask(() => child.stderr.emit("data", Buffer.from("ordinary warning\n")));
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.error, "process timed out");
  assert.equal(result.errorCode, "timeout");
  assert.equal(result.stderr, "ordinary warning\n");
});

test("spawnStreamingCommand bounds aggregate stdout capture across complete lines", async () => {
  const child = createFakeChild();
  child.kill = (signal) => {
    queueMicrotask(() => child.emit("close", null, signal));
  };

  const result = await spawnStreamingCommand({
    bin: "chatty-stdout-bin",
    args: [],
    maxCaptureBytes: 16,
    spawnImpl() {
      queueMicrotask(() => {
        for (let index = 0; index < 10_000; index += 1) {
          child.stdout.emit("data", Buffer.from("x\n"));
        }
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "output_overflow");
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stdoutBytes > 16, true);
  assert.equal(Buffer.byteLength(result.stdout), 16);
});

test("spawnStreamingCommand bounds aggregate stderr capture independently", async () => {
  const child = createFakeChild();
  child.kill = (signal) => {
    queueMicrotask(() => child.emit("close", null, signal));
  };

  const result = await spawnStreamingCommand({
    bin: "chatty-stderr-bin",
    args: [],
    maxCaptureBytes: 16,
    spawnImpl() {
      queueMicrotask(() => {
        for (let index = 0; index < 10_000; index += 1) {
          child.stderr.emit("data", Buffer.from("e\n"));
        }
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "output_overflow");
  assert.equal(result.stderrTruncated, true);
  assert.equal(result.stderrBytes > 16, true);
  assert.equal(Buffer.byteLength(result.stderr), 16);
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

test("spawnStreamingCommand terminates detached decoder overflows before settling once", {
  skip: process.platform === "win32",
}, async () => {
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
