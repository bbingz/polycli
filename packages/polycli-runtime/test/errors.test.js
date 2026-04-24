import test from "node:test";
import assert from "node:assert/strict";

import { formatProviderExitError } from "../src/errors.js";

test("formatProviderExitError maps special exit codes to semantic messages", () => {
  assert.equal(formatProviderExitError("claude", 124), "claude timed out");
  assert.equal(formatProviderExitError("claude", 130), "claude interrupted");
  assert.equal(formatProviderExitError("claude", 143), "claude terminated");
  assert.equal(formatProviderExitError("claude", 2), "claude exited with code 2");
});
