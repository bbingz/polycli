import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPromptRuntimeOptions,
  PROMPT_FINAL_ANSWER_APPEND_SYSTEM,
} from "../lib/prompt-runtime.mjs";

test("buildPromptRuntimeOptions constrains kimi ask to visible plan-mode text", () => {
  const options = buildPromptRuntimeOptions({
    provider: "kimi",
    kind: "ask",
  });

  assert.deepEqual(options.extraArgs, ["--plan", "--no-thinking", "--max-steps-per-turn", "1"]);
});

test("buildPromptRuntimeOptions leaves kimi rescue unconstrained", () => {
  const options = buildPromptRuntimeOptions({
    provider: "kimi",
    kind: "rescue",
  });

  assert.deepEqual(options, {});
});

test("buildPromptRuntimeOptions keeps qwen ask multi-step but excludes tools", () => {
  const options = buildPromptRuntimeOptions({
    provider: "qwen",
    kind: "ask",
  });

  assert.equal(options.maxSteps, 20);
  assert.equal(options.appendSystem, PROMPT_FINAL_ANSWER_APPEND_SYSTEM);
  assert.equal(options.approvalMode, "plan");
  assert.equal(options.extraArgs.filter((arg) => arg === "--exclude-tools").length > 0, true);
  assert.equal(options.extraArgs.includes("read_file"), true);
});

test("buildPromptRuntimeOptions uses conservative one-shot defaults for ask", () => {
  assert.deepEqual(buildPromptRuntimeOptions({ provider: "claude", kind: "ask" }), {
    permissionMode: "plan",
    maxTurns: 1,
    extraArgs: ["--tools", "", "--mcp-config", "{\"mcpServers\":{}}", "--strict-mcp-config"],
  });

  const gemini = buildPromptRuntimeOptions({ provider: "gemini", kind: "ask" });
  assert.equal(gemini.approvalMode, "plan");
  assert.deepEqual(gemini.extraArgs, [
    "--extensions",
    "",
    "--allowed-mcp-server-names",
    "__polycli_prompt_no_mcp__",
  ]);

  const copilot = buildPromptRuntimeOptions({ provider: "copilot", kind: "ask" });
  assert.equal(copilot.allowAllTools, false);
  assert.equal(copilot.allowAllPaths, false);
  assert.equal(copilot.allowAllUrls, false);
  assert.equal(copilot.noAskUser, true);
  assert.equal(copilot.extraArgs.includes("--excluded-tools"), true);

  assert.deepEqual(buildPromptRuntimeOptions({ provider: "opencode", kind: "ask" }), {
    skipPermissions: false,
    extraArgs: ["--agent", "plan"],
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        permission: "deny",
      }),
    },
  });

  assert.deepEqual(buildPromptRuntimeOptions({ provider: "pi", kind: "ask" }), {
    noSession: true,
    extraArgs: ["--no-tools", "--no-extensions", "--no-skills", "--no-context-files"],
  });

  assert.deepEqual(buildPromptRuntimeOptions({ provider: "cmd", kind: "ask" }), {
    yolo: false,
    extraArgs: ["--permission-mode", "plan"],
  });
});

test("buildPromptRuntimeOptions keeps qwen rescue multi-step but still requires visible final text", () => {
  const options = buildPromptRuntimeOptions({
    provider: "qwen",
    kind: "rescue",
  });

  assert.equal(options.maxSteps, undefined);
  assert.equal(options.appendSystem, PROMPT_FINAL_ANSWER_APPEND_SYSTEM);
});
