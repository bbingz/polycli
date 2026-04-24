import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPromptRuntimeOptions,
  PROMPT_FINAL_ANSWER_APPEND_SYSTEM,
} from "../lib/prompt-runtime.mjs";

test("buildPromptRuntimeOptions constrains kimi ask to one visible non-thinking turn", () => {
  const options = buildPromptRuntimeOptions({
    provider: "kimi",
    kind: "ask",
  });

  assert.deepEqual(options.extraArgs, ["--no-thinking", "--max-steps-per-turn", "1"]);
});

test("buildPromptRuntimeOptions leaves kimi rescue unconstrained", () => {
  const options = buildPromptRuntimeOptions({
    provider: "kimi",
    kind: "rescue",
  });

  assert.deepEqual(options, {});
});

test("buildPromptRuntimeOptions constrains qwen ask to a visible one-shot answer", () => {
  const options = buildPromptRuntimeOptions({
    provider: "qwen",
    kind: "ask",
  });

  assert.equal(options.maxSteps, 1);
  assert.equal(options.appendSystem, PROMPT_FINAL_ANSWER_APPEND_SYSTEM);
});

test("buildPromptRuntimeOptions keeps qwen rescue multi-step but still requires visible final text", () => {
  const options = buildPromptRuntimeOptions({
    provider: "qwen",
    kind: "rescue",
  });

  assert.equal(options.maxSteps, undefined);
  assert.equal(options.appendSystem, PROMPT_FINAL_ANSWER_APPEND_SYSTEM);
});
