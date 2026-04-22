import test from "node:test";
import assert from "node:assert/strict";

import { resolveProvider } from "../lib/providers.mjs";

test("resolveProvider accepts explicit option", () => {
  assert.deepEqual(
    resolveProvider({ provider: "qwen", positionals: ["hello"] }),
    { provider: "qwen", remainingPositionals: ["hello"] }
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
