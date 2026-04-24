const PROMPT_FINAL_ANSWER_APPEND_SYSTEM =
  "Always emit a visible final answer in assistant text. Never finish with reasoning blocks only.";

export function buildPromptRuntimeOptions({
  provider,
  kind,
  runtimeOptions = {},
} = {}) {
  if (kind === "ask" && provider === "kimi") {
    return {
      ...runtimeOptions,
      extraArgs: [...(runtimeOptions.extraArgs || []), "--no-thinking", "--max-steps-per-turn", "1"],
    };
  }

  if (provider === "qwen") {
    const merged = {
      ...runtimeOptions,
      appendSystem: runtimeOptions.appendSystem || PROMPT_FINAL_ANSWER_APPEND_SYSTEM,
    };
    if (kind === "ask") {
      merged.maxSteps = 1;
    }
    return merged;
  }

  return runtimeOptions;
}

export { PROMPT_FINAL_ANSWER_APPEND_SYSTEM };
