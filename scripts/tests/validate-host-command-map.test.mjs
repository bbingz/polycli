import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REPO_ROOT = new URL("../../", import.meta.url);
const VALIDATOR_PATH = new URL("../validate-host-command-map.mjs", import.meta.url);

test("host inventory is derived from the canonical command registry", async () => {
  const validator = await import(VALIDATOR_PATH.href);
  assert.deepEqual(validator.deriveSharedCommandNames(), [
    "adversarial-review",
    "agent-context",
    "ask",
    "cancel",
    "debug",
    "health",
    "rescue",
    "result",
    "review",
    "sessions",
    "setup",
    "status",
    "timing",
  ]);

  const source = fs.readFileSync(VALIDATOR_PATH, "utf8");
  assert.doesNotMatch(source, /const EXPECTED_COMMANDS\s*=/);
  assert.match(source, /command-registry\.mjs/);
});

test("all host surfaces match the canonical shared inventory", () => {
  const result = spawnSync(process.execPath, [VALIDATOR_PATH.pathname], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /host command map ok: 13 capabilities/);
});
