import test from "node:test";
import assert from "node:assert/strict";

import { spawn } from "node:child_process";

import {
  binaryAvailable,
  calculateArgvFootprint,
  formatCommandFailure,
  getSafeArgvBudgetBytes,
  runCommand,
  terminateProcessTree,
} from "../src/process.js";

test("calculateArgvFootprint counts UTF-8 strings, NUL terminators, and conservative pointers", () => {
  assert.deepEqual(
    calculateArgvFootprint({ command: "x", args: ["a", "bc"], env: { A: "1" } }),
    {
      totalBytes: 59,
      stringBytes: 11,
      pointerBytes: 48,
      argvBytes: 7,
      envBytes: 4,
      argvCount: 3,
      envCount: 1,
    }
  );

  assert.deepEqual(
    calculateArgvFootprint({ command: "你", args: ["好"], env: { "键": "值" } }),
    {
      totalBytes: 56,
      stringBytes: 16,
      pointerBytes: 40,
      argvBytes: 8,
      envBytes: 8,
      argvCount: 2,
      envCount: 1,
    }
  );
});

test("getSafeArgvBudgetBytes uses conservative application budgets by platform", () => {
  assert.equal(getSafeArgvBudgetBytes("win32"), 24 * 1024);
  assert.equal(getSafeArgvBudgetBytes("darwin"), 96 * 1024);
  assert.equal(getSafeArgvBudgetBytes("linux"), 96 * 1024);
});

test("runCommand rejects oversized argv before resolving a missing binary without leaking values", () => {
  const marker = "PROMPT_SECRET_MARKER_" + "x".repeat(256);
  const result = runCommand("__polycli_missing_argv_binary__", [marker], {
    env: { PRIVATE_TOKEN: "ENV_SECRET_MARKER" },
    argvBudgetBytes: 64,
    argvBudgetHint: "For review, pass --max-diff-bytes explicitly.",
  });

  assert.equal(result.status, null);
  assert.equal(result.spawnErrorCode, "E2BIG");
  assert.equal(result.error?.code, "E2BIG");
  assert.match(result.error?.message ?? "", /argvCount=2/);
  assert.match(result.error?.message ?? "", /envCount=1/);
  assert.match(result.error?.message ?? "", /--max-diff-bytes/);
  assert.doesNotMatch(result.error?.message ?? "", /PROMPT_SECRET_MARKER|ENV_SECRET_MARKER/);
});

test("runCommand includes the effective environment in its argv budget preflight", () => {
  let spawnCalls = 0;
  const result = runCommand("provider", ["short"], {
    env: { PRIVATE_TOKEN: "ENV_ONLY_SECRET_" + "x".repeat(256) },
    argvBudgetBytes: 64,
    spawnImpl() {
      spawnCalls += 1;
      throw new Error("spawn must not be called");
    },
  });

  assert.equal(spawnCalls, 0);
  assert.equal(result.spawnErrorCode, "E2BIG");
  assert.doesNotMatch(result.error?.message ?? "", /ENV_ONLY_SECRET/);
});

test("runCommand captures stdout and exit status", () => {
  const result = runCommand(process.execPath, ["-e", "console.log('pong')"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "pong");
});

test("runCommand can preserve null status for signaled children", () => {
  const result = runCommand(
    process.execPath,
    ["-e", "process.kill(process.pid, 'SIGTERM')"],
    { preserveNullStatus: true }
  );
  assert.equal(result.status, null);
  assert.equal(result.signal, "SIGTERM");
});

test("runCommand surfaces a signal kill as an error so it is not read as success", () => {
  const result = runCommand(
    process.execPath,
    ["-e", "process.stdout.write('partial'); process.kill(process.pid, 'SIGKILL')"]
  );
  // status is coerced to 0 by default, but the synthetic error prevents a false success.
  assert.equal(result.signal, "SIGKILL");
  assert.ok(result.error, "a signal-killed child must surface an error");
  assert.match(result.error.message, /signal/i);
});

test("binaryAvailable reports missing binaries as unavailable", () => {
  const result = binaryAvailable("__polycli_missing_binary__");
  assert.equal(result.available, false);
});

test("binaryAvailable keeps only the first non-empty detail line", () => {
  const result = binaryAvailable(process.execPath, [
    "-e",
    "process.stdout.write('\\ncli 1.0\\nupdate available\\n')",
  ]);
  assert.equal(result.available, true);
  assert.equal(result.detail, "cli 1.0");
});

test("binaryAvailable keeps only the first non-empty error detail line", () => {
  const result = binaryAvailable(process.execPath, [
    "-e",
    "process.stderr.write('\\nfirst error\\nsecond error\\n'); process.exit(2)",
  ]);
  assert.equal(result.available, false);
  assert.equal(result.detail, "first error");
});

test("formatCommandFailure includes exit and stderr", () => {
  const message = formatCommandFailure({
    command: "demo",
    args: ["--flag"],
    status: 2,
    signal: null,
    stdout: "",
    stderr: "boom",
  });
  assert.match(message, /exit=2/);
  assert.match(message, /boom/);
});

test("terminateProcessTree kills a normal non-detached child process", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));

  try {
    const terminated = await terminateProcessTree(child.pid, { forceAfterMs: 0 });
    assert.equal(terminated, true);
  } finally {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {}
  }

  const { signal } = await closed;
  assert.equal(signal, "SIGTERM");
});

test("terminateProcessTree rejects pid 1 without sending any signal", async (t) => {
  const kill = t.mock.method(process, "kill", () => {
    throw new Error("process.kill should not be called for pid 1");
  });

  await assert.rejects(
    () => terminateProcessTree(1, { forceAfterMs: 0 }),
    /Invalid pid/
  );
  assert.equal(kill.mock.callCount(), 0);
});
