import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { runAgyPromptStreaming } from "../src/agy.js";
import { runClaudePromptStreaming } from "../src/claude.js";
import { runCmdPromptStreaming } from "../src/cmd.js";
import { runCopilotPromptStreaming } from "../src/copilot.js";
import { runGeminiPromptStreaming } from "../src/gemini.js";
import { runGrokPromptStreaming } from "../src/grok.js";
import { runKimiPromptStreaming } from "../src/kimi.js";
import { runMiniMaxPromptStreaming } from "../src/minimax.js";
import { runOpenCodePromptStreaming } from "../src/opencode.js";
import { runPiPromptStreaming } from "../src/pi.js";
import { runQwenPromptStreaming } from "../src/qwen.js";

function createSpawnErrorChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  return child;
}

const streamingAdapters = [
  ["agy", runAgyPromptStreaming, {}],
  ["claude", runClaudePromptStreaming, {}],
  ["cmd", runCmdPromptStreaming, {}],
  ["copilot", runCopilotPromptStreaming, {}],
  ["gemini", runGeminiPromptStreaming, {}],
  ["grok", runGrokPromptStreaming, {}],
  ["kimi", runKimiPromptStreaming, { defaultModel: "test-model" }],
  ["minimax", runMiniMaxPromptStreaming, {}],
  ["opencode", runOpenCodePromptStreaming, {}],
  ["pi", runPiPromptStreaming, {}],
  ["qwen", runQwenPromptStreaming, {}],
];

for (const [provider, runner, providerOptions] of streamingAdapters) {
  test(`${provider} streaming preserves a structured common runtime errorCode`, async () => {
    const child = createSpawnErrorChild();
    const result = await runner({
      prompt: "ping",
      ...providerOptions,
      spawnImpl() {
        queueMicrotask(() => {
          const error = new Error("opaque spawn failure");
          error.code = "E2BIG";
          child.emit("error", error);
        });
        return child;
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "opaque spawn failure");
    assert.equal(result.spawnErrorCode, "E2BIG");
    assert.equal(result.errorCode, "argument_list_too_long");
  });
}
