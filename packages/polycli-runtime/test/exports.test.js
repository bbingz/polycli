import test from "node:test";
import assert from "node:assert/strict";

import * as runtime from "../src/index.js";

test("runtime index exports expected surface", () => {
  assert.deepEqual(Object.keys(runtime).sort(), [
    "PROVIDER_IDS",
    "PROVIDER_OPERATION_NAMES",
    "buildGeminiInvocation",
    "buildKimiInvocation",
    "buildMiniMaxInvocation",
    "buildQwenEnv",
    "buildQwenInvocation",
    "extractGeminiText",
    "extractKimiText",
    "extractMiniMaxEventText",
    "extractMiniMaxLogPath",
    "extractMiniMaxResponseFromLogText",
    "extractQwenText",
    "getGeminiAuthStatus",
    "getGeminiAvailability",
    "getKimiAuthStatus",
    "getKimiAvailability",
    "getMiniMaxAuthStatus",
    "getMiniMaxAvailability",
    "getProviderRuntime",
    "getQwenAuthStatus",
    "getQwenAvailability",
    "listProviderRuntimes",
    "parseGeminiStreamText",
    "parseKimiStreamText",
    "parseMiniMaxResponseBlocks",
    "parseQwenStreamText",
    "runGeminiPrompt",
    "runGeminiPromptStreaming",
    "runKimiPrompt",
    "runKimiPromptStreaming",
    "runMiniMaxPrompt",
    "runMiniMaxPromptStreaming",
    "runProviderPrompt",
    "runProviderPromptStreaming",
    "runQwenPrompt",
    "runQwenPromptStreaming",
    "stripAnsiSgr",
  ]);
});
