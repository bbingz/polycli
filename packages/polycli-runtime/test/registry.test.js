import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_IDS,
  PROVIDER_OPERATION_NAMES,
  getProviderRuntime,
  listProviderRuntimes,
} from "../src/index.js";

test("provider registry exposes the eight integrated runtimes", () => {
  assert.deepEqual(PROVIDER_IDS, ["gemini", "kimi", "qwen", "minimax", "claude", "copilot", "opencode", "pi"]);
  assert.deepEqual(PROVIDER_OPERATION_NAMES, ["prompt"]);

  const runtimes = listProviderRuntimes();
  assert.deepEqual(runtimes.map((runtime) => runtime.id), PROVIDER_IDS);

  for (const runtime of runtimes) {
    assert.equal(typeof runtime.getAvailability, "function");
    assert.equal(typeof runtime.getAuthStatus, "function");
    assert.equal(typeof runtime.runPrompt, "function");
    assert.equal(typeof runtime.runPromptStreaming, "function");
    assert.equal(typeof runtime.capabilities.streaming, "boolean");
    assert.deepEqual(runtime.capabilities.operations, PROVIDER_OPERATION_NAMES);
  }
});

test("getProviderRuntime returns a stable runtime for each provider id", () => {
  for (const providerId of PROVIDER_IDS) {
    const runtime = getProviderRuntime(providerId);
    assert.equal(runtime.id, providerId);
  }
});
