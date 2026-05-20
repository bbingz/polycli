import test from "node:test";
import assert from "node:assert/strict";

import { resolveProvider } from "../lib/providers.mjs";

test("resolveProvider accepts explicit option", () => {
  assert.deepEqual(
    resolveProvider({ provider: "qwen", positionals: ["hello"] }),
    { provider: "qwen", remainingPositionals: ["hello"] }
  );
  assert.deepEqual(
    resolveProvider({ provider: "claude", positionals: ["hello"] }),
    { provider: "claude", remainingPositionals: ["hello"] }
  );
  assert.deepEqual(
    resolveProvider({ provider: "copilot", positionals: ["hello"] }),
    { provider: "copilot", remainingPositionals: ["hello"] }
  );
  assert.deepEqual(
    resolveProvider({ provider: "opencode", positionals: ["hello"] }),
    { provider: "opencode", remainingPositionals: ["hello"] }
  );
  assert.deepEqual(
    resolveProvider({ provider: "pi", positionals: ["hello"] }),
    { provider: "pi", remainingPositionals: ["hello"] }
  );
  assert.deepEqual(
    resolveProvider({ provider: "agy", positionals: ["hello"] }),
    { provider: "agy", remainingPositionals: ["hello"] }
  );
});

test("resolveProvider accepts provider as first positional", () => {
  assert.deepEqual(
    resolveProvider({ positionals: ["kimi", "hello"] }),
    { provider: "kimi", remainingPositionals: ["hello"] }
  );
});

test("resolveProvider rejects missing or unknown providers", () => {
  assert.throws(() => resolveProvider({ positionals: ["hello"] }), /Missing provider/);
  assert.throws(() => resolveProvider({ provider: "bad-provider" }), /Unknown provider/);
});
