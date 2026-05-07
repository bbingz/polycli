import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildReviewPrompt,
  buildReviewRuntimeOptions,
  collectReviewContext,
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
    diff: "diff --git a/a b/a\n@@ -1 +1 @@\n+import x from \"@scope/pkg\";",
    focus: "auth",
    adversarial: true,
    truncated: true,
    truncationNotice: "Diff truncated to 100 bytes before sending to provider.",
  });

  assert.match(prompt, /adversarial code review/i);
  assert.match(prompt, /Extra focus from user: auth/);
  assert.match(prompt, /Diff truncated to 100 bytes/);
  assert.match(prompt, /diff --git a\/a b\/a/);
  assert.match(prompt, /\\@\\@ -1 \+1 \\@\\@/);
  assert.match(prompt, /"\\@scope\/pkg"/);
  assert.match(prompt, /must contain a visible final answer/i);
  assert.match(prompt, /No issues found\./);
  assert.match(prompt, /Do not run tools, commands, or tests/i);
});

test("buildReviewPrompt leaves non-gemini diff at signs unescaped", () => {
  const prompt = buildReviewPrompt({
    provider: "qwen",
    diff: "@@ -1 +1 @@\n+import x from \"@scope/pkg\";",
  });

  assert.match(prompt, /@@ -1 \+1 @@/);
  assert.match(prompt, /"@scope\/pkg"/);
});

test("buildReviewRuntimeOptions applies claude hard constraints", () => {
  const options = buildReviewRuntimeOptions({
    provider: "claude",
    cwd: process.cwd(),
  });

  assert.equal(options.maxTurns, 1);
  assert.deepEqual(options.extraArgs, ["--tools", "", "--mcp-config", "{\"mcpServers\":{}}", "--strict-mcp-config"]);
});

test("buildReviewRuntimeOptions keeps qwen multi-turn but excludes tools", () => {
  const options = buildReviewRuntimeOptions({
    provider: "qwen",
    cwd: process.cwd(),
  });

  assert.equal(options.approvalMode, "plan");
  assert.equal(options.maxSteps, undefined);
  assert.equal(options.appendSystem.includes("visible final markdown answer"), true);
  assert.equal(options.extraArgs.filter((arg) => arg === "--exclude-tools").length > 0, true);
  assert.equal(options.extraArgs.includes("exit_plan_mode"), true);
  assert.equal(options.extraArgs.includes("read_file"), true);
});

test("buildReviewRuntimeOptions isolates gemini review without policy", () => {
  const options = buildReviewRuntimeOptions({
    provider: "gemini",
    cwd: process.cwd(),
  });

  assert.equal(options.approvalMode, "plan");
  assert.notEqual(options.cwd, process.cwd());
  assert.equal(fs.statSync(options.cwd).isDirectory(), true);
  assert.deepEqual(options.cleanupPaths, [options.cwd]);
  const extensionsIndex = options.extraArgs.indexOf("--extensions");
  assert.notEqual(extensionsIndex, -1);
  assert.equal(options.extraArgs[extensionsIndex + 1], "");
  const mcpIndex = options.extraArgs.indexOf("--allowed-mcp-server-names");
  assert.notEqual(mcpIndex, -1);
  assert.equal(options.extraArgs[mcpIndex + 1], "__polycli_review_no_mcp__");
  assert.equal(options.extraArgs.includes("--policy"), false);
});

test("buildReviewRuntimeOptions applies copilot tool-exclusion hard constraints", () => {
  const options = buildReviewRuntimeOptions({
    provider: "copilot",
    cwd: process.cwd(),
  });

  assert.equal(options.allowAllTools, false);
  assert.equal(options.allowAllPaths, false);
  assert.equal(options.allowAllUrls, false);
  const excludedIndex = options.extraArgs.indexOf("--excluded-tools");
  assert.notEqual(excludedIndex, -1);
  assert.match(options.extraArgs[excludedIndex + 1], /apply_patch/);
  assert.match(options.extraArgs[excludedIndex + 1], /ask_user/);
});

test("buildReviewRuntimeOptions applies opencode plan agent and deny-all config", () => {
  const options = buildReviewRuntimeOptions({
    provider: "opencode",
    cwd: process.cwd(),
  });

  assert.equal(options.skipPermissions, false);
  assert.deepEqual(options.extraArgs, ["--agent", "plan"]);
  assert.deepEqual(JSON.parse(options.env.OPENCODE_CONFIG_CONTENT), {
    "$schema": "https://opencode.ai/config.json",
    permission: "deny",
  });
});

test("buildReviewRuntimeOptions does not persist parent env for opencode review jobs", () => {
  const options = buildReviewRuntimeOptions({
    provider: "opencode",
    cwd: process.cwd(),
    env: {
      PATH: "/bin",
      SECRET_TOKEN: "do-not-persist",
    },
  });

  assert.deepEqual(Object.keys(options.env).sort(), ["OPENCODE_CONFIG_CONTENT"]);
});

test("buildReviewRuntimeOptions applies pi hard constraints", () => {
  const options = buildReviewRuntimeOptions({
    provider: "pi",
    cwd: process.cwd(),
  });

  assert.equal(options.noSession, true);
  assert.deepEqual(options.extraArgs, ["--no-tools", "--no-extensions", "--no-skills", "--no-context-files"]);
});

test("buildReviewRuntimeOptions applies cmd plan-mode hard constraints", () => {
  const options = buildReviewRuntimeOptions({
    provider: "cmd",
    cwd: process.cwd(),
  });

  assert.deepEqual(options.extraArgs, ["--permission-mode", "plan"]);
});

test("buildReviewRuntimeOptions leaves minimax on mmx text chat defaults", () => {
  const options = buildReviewRuntimeOptions({
    provider: "minimax",
    cwd: process.cwd(),
    env: {
      SECRET_TOKEN: "do-not-persist",
    },
  });

  assert.deepEqual(options, {});
});

test("buildReviewRuntimeOptions rejects conflicting user overrides", () => {
  assert.throws(
    () => buildReviewRuntimeOptions({
      provider: "claude",
      cwd: process.cwd(),
      runtimeOptions: { extraArgs: ["--max-turns", "5"] },
    }),
    /non-overridable review hard constraints/i
  );
});

test("collectReviewContext auto scope returns warnings when branch fallback fails in a single-commit repo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-git-"));
  execFileSync("git", ["init", "-b", "scratch"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  fs.writeFileSync(path.join(root, "file.txt"), "hello\n", "utf8");
  execFileSync("git", ["add", "file.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });

  const context = collectReviewContext({ cwd: root, scope: "auto" });

  assert.equal(context.ok, true);
  assert.equal(context.diff, "");
  assert.equal(context.scope, "auto");
  assert.equal(context.baseRef, "HEAD~1");
  assert.ok(Array.isArray(context.warnings));
  assert.match(context.warnings.join("\n"), /branch diff failed/i);
});

test("collectReviewContext does not truncate by default for any diff size", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  fs.writeFileSync(path.join(root, "seed.txt"), "seed\n", "utf8");
  execFileSync("git", ["add", "seed.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: root });
  const big = "x".repeat(250_000);
  fs.writeFileSync(path.join(root, "big.txt"), big, "utf8");
  execFileSync("git", ["add", "big.txt"], { cwd: root });

  const context = collectReviewContext({ cwd: root, scope: "staged" });

  assert.equal(context.ok, true);
  assert.equal(context.truncated, false);
  assert.equal(context.truncationNotice, null);
  assert.ok(Buffer.byteLength(context.diff, "utf8") > 200_000);
});

test("collectReviewContext truncates when caller passes a positive maxDiffBytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  fs.writeFileSync(path.join(root, "seed.txt"), "seed\n", "utf8");
  execFileSync("git", ["add", "seed.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: root });
  const big = "x".repeat(50_000);
  fs.writeFileSync(path.join(root, "big.txt"), big, "utf8");
  execFileSync("git", ["add", "big.txt"], { cwd: root });

  const context = collectReviewContext({ cwd: root, scope: "staged", maxDiffBytes: 1024 });

  assert.equal(context.ok, true);
  assert.equal(context.truncated, true);
  assert.match(context.truncationNotice, /Diff truncated to 1024 bytes/);
  assert.equal(Buffer.byteLength(context.diff, "utf8"), 1024);
});

test("collectReviewContext treats zero or negative maxDiffBytes as no cap", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  fs.writeFileSync(path.join(root, "seed.txt"), "seed\n", "utf8");
  execFileSync("git", ["add", "seed.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: root });
  fs.writeFileSync(path.join(root, "big.txt"), "x".repeat(50_000), "utf8");
  execFileSync("git", ["add", "big.txt"], { cwd: root });

  for (const maxDiffBytes of [0, -1]) {
    const context = collectReviewContext({ cwd: root, scope: "staged", maxDiffBytes });
    assert.equal(context.truncated, false, `cap=${maxDiffBytes} should be treated as no cap`);
    assert.equal(context.truncationNotice, null);
  }
});

test("collectReviewContext auto scope stays warning-free for a clean repo when branch diff succeeds", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  fs.writeFileSync(path.join(root, "file.txt"), "hello\n", "utf8");
  execFileSync("git", ["add", "file.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  fs.writeFileSync(path.join(root, "file.txt"), "hello\nworld\n", "utf8");
  execFileSync("git", ["commit", "-am", "second"], { cwd: root });

  const context = collectReviewContext({ cwd: root, scope: "auto" });

  assert.equal(context.ok, true);
  assert.equal(context.diff, "");
  assert.equal(context.scope, "auto");
  assert.equal(context.warnings, undefined);
});
