import test from "node:test";
import assert from "node:assert/strict";

import { REVIEW_FLAG_EXPECTATIONS } from "../src/review-flags.js";

test("REVIEW_FLAG_EXPECTATIONS is frozen and keyed by every constrained provider", () => {
  assert.equal(Object.isFrozen(REVIEW_FLAG_EXPECTATIONS), true);
  assert.deepEqual(
    Object.keys(REVIEW_FLAG_EXPECTATIONS).sort(),
    ["agy", "claude", "cmd", "copilot", "gemini", "grok", "kimi", "minimax", "opencode", "pi", "qwen"]
  );
});

test("every provider declares expectFlags + extraArgTokens as `--`-flag arrays (exact-match vs review.mjs lives in the host consistency test)", () => {
  for (const provider of ["claude", "gemini", "qwen", "copilot", "opencode", "pi", "cmd", "kimi", "agy", "minimax", "grok"]) {
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
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.kimi.extraArgTokens, []);
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
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.qwen.probes, [
    {
      helpArgs: ["--approval-mode", "plan", "--help"],
      expect: ["--exclude-tools", "--max-session-turns"],
    },
    {
      helpArgs: ["--max-session-turns", "1", "--help"],
      expect: ["--approval-mode"],
    },
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
  // kimi review is prompt-only under kimi-code (no flag-based read-only lever), like minimax.
  assert.equal(REVIEW_FLAG_EXPECTATIONS.kimi.readOnlyOptionKey, undefined);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.copilot.readOnlyOptionKeys, [
    "allowAllTools",
    "allowAllPaths",
    "allowAllUrls",
  ]);
});

test("agy detects its plan-mode surface but remains reviewUnsupported, minimax carries two probes", () => {
  assert.equal(REVIEW_FLAG_EXPECTATIONS.agy.reviewUnsupported, true);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.agy.expectFlags, ["--mode"]);
  assert.equal(REVIEW_FLAG_EXPECTATIONS.agy.forbidFlags, undefined);
  assert.equal(REVIEW_FLAG_EXPECTATIONS.minimax.probes.length, 2);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.minimax.probes[0].helpArgs, ["text", "chat", "--help"]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.minimax.probes[0].expect, ["--message"]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.minimax.probes[1].helpArgs, ["--help"]);
  assert.deepEqual(REVIEW_FLAG_EXPECTATIONS.minimax.probes[1].expect, ["--output", "--non-interactive"]);
});

test("stop-review gate only permits providers with enforced runtime constraints", () => {
  const bySafety = { enforced: [], prompt_only: [], unsupported: [] };
  for (const [provider, entry] of Object.entries(REVIEW_FLAG_EXPECTATIONS)) {
    bySafety[entry.stopReviewGateSafety]?.push(provider);
  }

  assert.deepEqual(
    bySafety.enforced.sort(),
    ["claude", "cmd", "copilot", "gemini", "grok", "opencode", "pi", "qwen"],
  );
  assert.deepEqual(
    bySafety.prompt_only.sort(),
    ["kimi", "minimax"],
  );
  assert.deepEqual(bySafety.unsupported, ["agy"]);
});

test("review safety is explicit and consistent with review and stop-gate support", () => {
  const bySafety = { enforced: [], prompt_only: [], unsupported: [] };

  for (const [provider, entry] of Object.entries(REVIEW_FLAG_EXPECTATIONS)) {
    assert.match(entry.reviewSafety, /^(enforced|prompt_only|unsupported)$/, provider);
    bySafety[entry.reviewSafety].push(provider);
    assert.equal(
      Boolean(entry.reviewUnsupported),
      entry.reviewSafety === "unsupported",
      `${provider} reviewUnsupported agrees with reviewSafety`,
    );
    assert.equal(
      entry.stopReviewGateSafety,
      entry.reviewSafety,
      `${provider} stopReviewGateSafety agrees with reviewSafety`,
    );
  }

  assert.deepEqual(
    bySafety.enforced.sort(),
    ["claude", "cmd", "copilot", "gemini", "grok", "opencode", "pi", "qwen"],
  );
  assert.deepEqual(bySafety.prompt_only.sort(), ["kimi", "minimax"]);
  assert.deepEqual(bySafety.unsupported, ["agy"]);
});
