import test from "node:test";
import assert from "node:assert/strict";

import { REVIEW_FLAG_EXPECTATIONS } from "../src/review-flags.js";

test("REVIEW_FLAG_EXPECTATIONS is frozen and keyed by every constrained provider", () => {
  assert.equal(Object.isFrozen(REVIEW_FLAG_EXPECTATIONS), true);
  assert.deepEqual(
    Object.keys(REVIEW_FLAG_EXPECTATIONS).sort(),
    ["agy", "claude", "cmd", "copilot", "gemini", "kimi", "minimax", "opencode", "pi", "qwen"]
  );
});

test("every provider declares expectFlags + extraArgTokens as `--`-flag arrays (exact-match vs review.mjs lives in the host consistency test)", () => {
  for (const provider of ["claude", "gemini", "qwen", "copilot", "opencode", "pi", "cmd", "kimi", "agy", "minimax"]) {
    const entry = REVIEW_FLAG_EXPECTATIONS[provider];
    assert.ok(Array.isArray(entry.expectFlags), `${provider} expectFlags is an array`);
    assert.ok(Array.isArray(entry.extraArgTokens), `${provider} extraArgTokens is an array`);
    for (const flag of entry.extraArgTokens) {
      assert.ok(typeof flag === "string" && flag.startsWith("--"), `${provider} extraArgToken ${flag} is a --flag`);
    }
  }
  // extraArgTokens is intentionally NOT a subset of expectFlags: gemini's
  // extraArgs carry --extensions/--allowed-mcp-server-names while its help/drift
  // flags are --approval-mode/--policy.
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.gemini.extraArgTokens, ["--extensions", "--allowed-mcp-server-names"]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.kimi.extraArgTokens, ["--no-thinking", "--max-steps-per-turn"]);
});

test("claude/gemini/qwen carry the exact drift expect tokens", () => {
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.claude.expectFlags, [
    "--tools",
    "--mcp-config",
    "--strict-mcp-config",
  ]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.gemini.expectFlags, ["--approval-mode", "--policy"]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.qwen.expectFlags, [
    "--approval-mode",
    "--exclude-tools",
    "--max-session-turns",
  ]);
});

test("read-only option keys mirror assertNoReviewConstraintOverride", () => {
  assert.equal(REVIEW_FLAG_EXPECTATIONS.claude.readOnlyOptionKey, "permissionMode");
  assert.equal(REVIEW_FLAG_EXPECTATIONS.claude.readOnlyValue, "plan");
  assert.equal(REVIEW_FLAG_EXPECTATIONS.gemini.readOnlyOptionKey, "approvalMode");
  assert.equal(REVIEW_FLAG_EXPECTATIONS.gemini.readOnlyValue, "plan");
  assert.equal(REVIEW_FLAG_EXPECTATIONS.qwen.readOnlyOptionKey, "approvalMode");
  assert.equal(REVIEW_FLAG_EXPECTATIONS.opencode.readOnlyOptionKey, "skipPermissions");
  assert.equal(REVIEW_FLAG_EXPECTATIONS.opencode.readOnlyValue, null);
  assert.equal(REVIEW_FLAG_EXPECTATIONS.cmd.readOnlyOptionKey, "yolo");
  assert.equal(REVIEW_FLAG_EXPECTATIONS.kimi.readOnlyOptionKey, "yolo");
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.copilot.readOnlyOptionKeys, [
    "allowAllTools",
    "allowAllPaths",
    "allowAllUrls",
  ]);
});

test("agy carries forbidFlags + reviewUnsupported, minimax carries two probes", () => {
  assert.equal(REVIEW_FLAG_EXPECTATIONS.agy.reviewUnsupported, true);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.agy.forbidFlags, [
    "--approval-mode",
    "--permission-mode",
    "--policy",
    "--plan",
    "--agent",
  ]);
  assert.equal(REVIEW_FLAG_EXPECTATIONS.minimax.probes.length, 2);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.minimax.probes[0].helpArgs, ["text", "chat", "--help"]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.minimax.probes[0].expect, ["--message"]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.minimax.probes[1].helpArgs, ["--help"]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.minimax.probes[1].expect, ["--output", "--non-interactive"]);
});
