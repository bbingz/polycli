import test from "node:test";
import assert from "node:assert/strict";

import { isHardCompanionFailure, runCompanion } from "../../plugins/polycli-opencode/index.mjs";

function fakeSpawn(status, stdout, stderr = "") {
  return () => ({ status, stdout, stderr });
}

test("opencode host treats companion exit 2 as a soft signal, not a hard failure", () => {
  // Exit 2 is the companion's documented soft signal: `health` with no healthy provider and
  // `status --wait` timeouts both exit 2 while still emitting a valid JSON envelope on stdout.
  // The adapter must surface that envelope instead of throwing a tool error.
  assert.equal(isHardCompanionFailure(2), false);
  // Exit 0 is success; every other non-zero exit is a real failure that must propagate.
  assert.equal(isHardCompanionFailure(0), false);
  assert.equal(isHardCompanionFailure(1), true);
  assert.equal(isHardCompanionFailure(4), true);
  assert.equal(isHardCompanionFailure(5), true);
});

test("runCompanion returns the stdout envelope on a companion exit 2 (execution path)", () => {
  const envelope = JSON.stringify({ waitTimedOut: true, jobs: [] });
  const stdout = runCompanion(["status", "--all", "--wait", "--json"], { spawn: fakeSpawn(2, envelope) });
  assert.equal(stdout, envelope);
});

test("runCompanion throws with the stdout attached on a hard exit 1 (execution path)", () => {
  const envelope = JSON.stringify({ error: "boom", code: "unknown_provider" });
  assert.throws(
    () => runCompanion(["timing", "--provider", "nope", "--json"], { spawn: fakeSpawn(1, envelope) }),
    (error) => {
      assert.equal(error.status, 1);
      assert.equal(error.stdout, envelope);
      assert.equal(JSON.parse(error.stdout).code, "unknown_provider");
      return true;
    },
  );
});
