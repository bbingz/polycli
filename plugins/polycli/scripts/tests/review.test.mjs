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

function buildMiniMaxReviewConfig(baseConfigText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-minimax-base-"));
  const baseConfigPath = path.join(root, "config.yaml");
  fs.writeFileSync(baseConfigPath, baseConfigText, "utf8");
  const options = buildReviewRuntimeOptions({
    provider: "minimax",
    cwd: process.cwd(),
    env: { ...process.env, MINI_AGENT_CONFIG_PATH: baseConfigPath },
  });
  return fs.readFileSync(options.env.MINI_AGENT_CONFIG_PATH, "utf8");
}

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

  assert.deepEqual(options.extraArgs, ["--max-turns", "1", "--tools", ""]);
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

test("buildReviewRuntimeOptions applies pi hard constraints", () => {
  const options = buildReviewRuntimeOptions({
    provider: "pi",
    cwd: process.cwd(),
  });

  assert.deepEqual(options.extraArgs, ["--no-tools"]);
});

test("buildReviewRuntimeOptions applies cmd plan-mode hard constraints", () => {
  const options = buildReviewRuntimeOptions({
    provider: "cmd",
    cwd: process.cwd(),
  });

  assert.deepEqual(options.extraArgs, ["--permission-mode", "plan"]);
});

test("buildReviewRuntimeOptions writes a tool-disabled minimax config override", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-minimax-"));
  const baseConfigPath = path.join(root, "config.yaml");
  fs.writeFileSync(
    baseConfigPath,
    [
      'api_key: "test-key"',
      'api_base: "https://api.example.test"',
      'model: "MiniMax-M1"',
      'provider: "anthropic"',
    ].join("\n"),
    "utf8"
  );

  const options = buildReviewRuntimeOptions({
    provider: "minimax",
    cwd: process.cwd(),
    env: { ...process.env, MINI_AGENT_CONFIG_PATH: baseConfigPath },
  });

  const configText = fs.readFileSync(options.env.MINI_AGENT_CONFIG_PATH, "utf8");
  assert.match(configText, /enable_file_tools: false/);
  assert.match(configText, /enable_bash: false/);
  assert.match(configText, /enable_note: false/);
  assert.match(configText, /enable_skills: false/);
  assert.match(configText, /enable_mcp: false/);
});

test("buildReviewRuntimeOptions reads minimax YAML scalar forms", () => {
  const configText = buildMiniMaxReviewConfig([
    "# comment before scalar",
    "api_key: plain-key",
    'api_base: "https://api with spaces.example.test"',
    "model: 'MiniMax M2'",
    "provider: anthropic",
  ].join("\n"));

  assert.match(configText, /api_key: "plain-key"/);
  assert.match(configText, /api_base: "https:\/\/api with spaces\.example\.test"/);
  assert.match(configText, /model: "MiniMax M2"/);
  assert.match(configText, /provider: "anthropic"/);
});

test("buildReviewRuntimeOptions rejects unsupported minimax YAML block scalars", () => {
  assert.throws(
    () => buildMiniMaxReviewConfig([
      "api_key: |",
      "  secret",
    ].join("\n")),
    /Unsupported YAML block scalar for 'api_key'/i
  );
});

test("buildReviewRuntimeOptions rejects malformed minimax YAML lines", () => {
  assert.throws(
    () => buildMiniMaxReviewConfig([
      "api_key: plain-key",
      "this is not yaml",
    ].join("\n")),
    /Malformed YAML line/i
  );
});

test("review temp files are removed on process exit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-child-base-"));
  const baseConfigPath = path.join(root, "config.yaml");
  fs.writeFileSync(baseConfigPath, "api_key: test-key\n", "utf8");
  const reviewModulePath = path.resolve("plugins/polycli/scripts/lib/review.mjs");
  const script = `
import { pathToFileURL } from "node:url";
const { buildReviewRuntimeOptions } = await import(pathToFileURL(${JSON.stringify(reviewModulePath)}).href);
const options = buildReviewRuntimeOptions({
  provider: "minimax",
  cwd: process.cwd(),
  env: { ...process.env, MINI_AGENT_CONFIG_PATH: process.env.TEST_MINIMAX_CONFIG_PATH },
});
console.log(options.env.MINI_AGENT_CONFIG_PATH);
`;

  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, TEST_MINIMAX_CONFIG_PATH: baseConfigPath },
    encoding: "utf8",
  });
  const generatedConfigPath = stdout.trim().split(/\r?\n/).at(-1);
  assert.equal(fs.existsSync(path.dirname(generatedConfigPath)), false);
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
