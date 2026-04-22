import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewPrompt,
  normalizeReviewScope,
} from "../lib/review.mjs";

test("normalizeReviewScope defaults to auto and rejects bad values", () => {
  assert.equal(normalizeReviewScope(undefined), "auto");
  assert.equal(normalizeReviewScope("staged"), "staged");
  assert.throws(() => normalizeReviewScope("bad"), /Invalid --scope/);
});

test("buildReviewPrompt includes adversarial and truncation guidance", () => {
  const prompt = buildReviewPrompt({
    provider: "gemini",
    diff: "diff --git a/a b/a",
    focus: "auth",
    adversarial: true,
    truncated: true,
    truncationNotice: "Diff truncated to 100 bytes before sending to provider.",
  });

  assert.match(prompt, /adversarial code review/i);
  assert.match(prompt, /Extra focus from user: auth/);
  assert.match(prompt, /Diff truncated to 100 bytes/);
  assert.match(prompt, /diff --git a\/a b\/a/);
  assert.match(prompt, /must contain a visible final answer/i);
  assert.match(prompt, /No issues found\./);
  assert.match(prompt, /Do not run tools, commands, or tests/i);
});
