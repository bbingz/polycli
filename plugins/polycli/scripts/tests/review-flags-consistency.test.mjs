import test from "node:test";
import assert from "node:assert/strict";

import { REVIEW_FLAG_EXPECTATIONS } from "@bbingz/polycli-runtime";

import { buildReviewRuntimeOptions } from "../lib/review.mjs";

// Providers whose review hard constraints run through buildReviewRuntimeOptions.
// (agy is review-unsupported → buildReviewRuntimeOptions throws, so it is excluded.)
const EXACT_MATCH_PROVIDERS = ["claude", "gemini", "qwen", "copilot", "opencode", "pi", "cmd", "kimi", "minimax"];

// The EXACT set of `--`-prefixed flag tokens review.mjs actually emits as extraArgs.
function emittedFlagTokens(provider) {
  const merged = buildReviewRuntimeOptions({ provider });
  const extraArgs = merged.extraArgs ?? [];
  return [...new Set(extraArgs.filter((a) => typeof a === "string" && a.startsWith("--")))].sort();
}

function declaredTokens(provider) {
  return [...REVIEW_FLAG_EXPECTATIONS[provider].extraArgTokens].sort();
}

// Exact-set rule (not subset): declared extraArgTokens must EQUAL the --flags
// review.mjs emits. This catches a token ADDED to review.mjs but not declared
// AND a declared token whose flag was REMOVED from review.mjs — the subset check
// it replaces could only catch the latter, and missed gemini/kimi entirely.
test("REVIEW_FLAG_EXPECTATIONS.extraArgTokens EXACTLY match the --flags review.mjs emits", () => {
  for (const provider of EXACT_MATCH_PROVIDERS) {
    assert.deepEqual(
      emittedFlagTokens(provider),
      declaredTokens(provider),
      `${provider}: declared extraArgTokens != the --flags review.mjs emits`,
    );
  }
});

test("the exact-match check goes RED when a declared token is added OR removed, then restores", () => {
  const emitted = emittedFlagTokens("gemini");
  // ADDED a token review.mjs does not emit → mismatch.
  assert.notDeepEqual(emitted, [...declaredTokens("gemini"), "--bogus-added-flag"].sort());
  // REMOVED a token review.mjs does emit → mismatch.
  assert.notDeepEqual(emitted, declaredTokens("gemini").filter((t) => t !== "--extensions"));
  // Live map matches.
  assert.deepEqual(emitted, declaredTokens("gemini"));
});

test("assertNoReviewConstraintOverride rejects a bad value on the declared readOnlyOptionKey", () => {
  // plan-valued guards (claude/gemini/qwen): a non-plan value is rejected.
  for (const provider of ["claude", "gemini", "qwen"]) {
    const key = REVIEW_FLAG_EXPECTATIONS[provider].readOnlyOptionKey;
    assert.throws(
      () => buildReviewRuntimeOptions({ provider, runtimeOptions: { [key]: "yolo" } }),
      /non-overridable review hard constraints/,
      `${provider} should reject ${key}=yolo`
    );
  }
  // false-only guards (opencode/cmd): a non-false value is rejected. (kimi review is prompt-only
  // under kimi-code, like minimax — it has no readOnlyOptionKey to guard.)
  for (const provider of ["opencode", "cmd"]) {
    const key = REVIEW_FLAG_EXPECTATIONS[provider].readOnlyOptionKey;
    assert.throws(
      () => buildReviewRuntimeOptions({ provider, runtimeOptions: { [key]: true } }),
      /non-overridable review hard constraints/,
      `${provider} should reject ${key}=true`
    );
  }
  // copilot guards multiple keys.
  for (const key of REVIEW_FLAG_EXPECTATIONS.copilot.readOnlyOptionKeys) {
    assert.throws(
      () => buildReviewRuntimeOptions({ provider: "copilot", runtimeOptions: { [key]: true } }),
      /non-overridable review hard constraints/,
      `copilot should reject ${key}=true`
    );
  }
});

test("assertNoReviewConstraintOverride accepts the declared read-only value", () => {
  // The sentinel value must NOT be rejected.
  assert.doesNotThrow(() => buildReviewRuntimeOptions({ provider: "claude", runtimeOptions: { permissionMode: "plan" } }));
  assert.doesNotThrow(() => buildReviewRuntimeOptions({ provider: "gemini", runtimeOptions: { approvalMode: "plan" } }));
  assert.doesNotThrow(() => buildReviewRuntimeOptions({ provider: "opencode", runtimeOptions: { skipPermissions: false } }));
  assert.doesNotThrow(() => buildReviewRuntimeOptions({ provider: "cmd", runtimeOptions: { yolo: false } }));
});
