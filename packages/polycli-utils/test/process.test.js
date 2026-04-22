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

test("binaryAvailable reports missing binaries as unavailable", () => {
  const result = binaryAvailable("__polycli_missing_binary__");
  assert.equal(result.available, false);
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
