import test from "node:test";
import assert from "node:assert/strict";

import { matchResumeSessionIdLine, matchSessionId, resolveSessionId } from "../src/session-id.js";

test("matchResumeSessionIdLine accepts only a standalone resume UUID line", () => {
  const sessionId = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(matchResumeSessionIdLine(`resume ${sessionId}\n`), sessionId);
  assert.equal(matchResumeSessionIdLine(`  RESUME ${sessionId}  \n`), sessionId);
  assert.equal(matchResumeSessionIdLine(`warning: resume ${sessionId}`), null);
  assert.equal(matchResumeSessionIdLine(`resume ${sessionId} after reconnect`), null);
  assert.equal(matchResumeSessionIdLine(`answer mentions ${sessionId}`), null);
});

test("matchSessionId detects UUIDs in arbitrary text", () => {
  const sessionId = matchSessionId("To resume: kimi -r 123e4567-e89b-12d3-a456-426614174000");
  assert.equal(sessionId, "123e4567-e89b-12d3-a456-426614174000");
});

test("matchSessionId accepts modern UUIDv7 values", () => {
  const sessionId = matchSessionId("resume 0195f2d5-8b11-7f4a-9234-6c6f0a12abcd");
  assert.equal(sessionId, "0195f2d5-8b11-7f4a-9234-6c6f0a12abcd");
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
