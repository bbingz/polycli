import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMAND_SURFACE_VERSION,
  TERMINAL_COMMAND_DEFINITIONS,
  getTerminalCommandDefinition,
} from "../../packages/polycli-terminal/lib/command-surface.generated.mjs";

test("generated terminal command metadata includes shared commands and delegated tui", () => {
  assert.equal(COMMAND_SURFACE_VERSION, 1);
  assert.ok(TERMINAL_COMMAND_DEFINITIONS.some((entry) => entry.id === "agent-context"));
  assert.equal(getTerminalCommandDefinition(["tui"]).dispatchTarget, "terminal-wrapper");
  assert.equal(getTerminalCommandDefinition(["_job-worker"]), null);
});

test("terminal package declares the parser utility used by generated metadata consumers", async () => {
  const pkg = (await import("../../packages/polycli-terminal/package.json", { with: { type: "json" } })).default;
  const utils = (await import("../../packages/polycli-utils/package.json", { with: { type: "json" } })).default;
  assert.equal(utils.version, "1.0.4", "strict parser extension requires a new publishable utils version");
  assert.equal(pkg.dependencies?.["@bbingz/polycli-utils"], utils.version);
});
