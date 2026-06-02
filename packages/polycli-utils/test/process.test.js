import test from "node:test";
import assert from "node:assert/strict";

import { binaryAvailable, formatCommandFailure, runCommand } from "../src/process.js";

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
