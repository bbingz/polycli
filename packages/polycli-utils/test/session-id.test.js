import test from "node:test";
import assert from "node:assert/strict";

import { matchSessionId, resolveSessionId } from "../src/session-id.js";

test("matchSessionId detects UUIDs in arbitrary text", () => {
  const sessionId = matchSessionId("To resume: kimi -r 123e4567-e89b-12d3-a456-426614174000");
  assert.equal(sessionId, "123e4567-e89b-12d3-a456-426614174000");
});

test("resolveSessionId respects source priority", () => {
  const resolved = resolveSessionId({
    stdout: "session 123e4567-e89b-12d3-a456-426614174000",
    stderr: "session 223e4567-e89b-12d3-a456-426614174000",
    fileValue: "323e4567-e89b-12d3-a456-426614174000",
    priority: ["stderr", "stdout", "file"],
  });

  assert.deepEqual(resolved, {
    sessionId: "223e4567-e89b-12d3-a456-426614174000",
    source: "stderr",
  });
});
