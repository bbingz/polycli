import test from "node:test";
import assert from "node:assert/strict";

import { isHardCompanionFailure } from "../../plugins/polycli-opencode/index.mjs";

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
