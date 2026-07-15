import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMAND_DEFINITIONS,
  COMMAND_SURFACE_VERSION,
  ERROR_DEFINITIONS,
  OUTPUT_SCHEMA_DEFINITIONS,
  assertCommandRegistry,
  getCommandDefinition,
  listCommandDefinitions,
  parseCommandArgs,
  renderCommandHelp,
  renderRootHelp,
  resolveCommandPath,
} from "../lib/command-registry.mjs";

const SHARED_TOP_LEVEL = [
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
];

test("command registry is serializable and internally valid", () => {
  assert.equal(COMMAND_SURFACE_VERSION, 1);
  assert.doesNotThrow(() => assertCommandRegistry());
  assert.doesNotThrow(() => JSON.stringify({
    commands: COMMAND_DEFINITIONS,
    errors: ERROR_DEFINITIONS,
    schemas: OUTPUT_SCHEMA_DEFINITIONS,
  }));
});

test("shared and terminal top-level command inventories derive from registry surfaces", () => {
  const shared = listCommandDefinitions({
    hostSurface: "unknown",
    topLevelOnly: true,
  }).map((entry) => entry.path[0]).sort();
  assert.deepEqual(shared, SHARED_TOP_LEVEL);

  const terminal = listCommandDefinitions({
    hostSurface: "terminal",
    topLevelOnly: true,
  }).map((entry) => entry.path[0]).sort();
  assert.deepEqual(terminal, [...SHARED_TOP_LEVEL, "tui"].sort());
  assert.ok(listCommandDefinitions({ includeInternal: true }).some((entry) => entry.id === "_job-worker"));
  assert.ok(!listCommandDefinitions().some((entry) => entry.visibility === "internal"));
});

test("resolveCommandPath chooses longest paths and registered defaults", () => {
  assert.deepEqual(resolveCommandPath(["debug", "show", "run_1", "--json"]), {
    definition: getCommandDefinition(["debug", "show"]),
    args: ["run_1", "--json"],
  });
  assert.deepEqual(resolveCommandPath(["debug"]), {
    definition: getCommandDefinition(["debug", "runs"]),
    args: [],
  });
  assert.deepEqual(resolveCommandPath(["sessions"]), {
    definition: getCommandDefinition(["sessions", "list"]),
    args: [],
  });
  assert.deepEqual(resolveCommandPath(["debug", "--help"]), {
    definition: getCommandDefinition(["debug"]),
    args: ["--help"],
  });
  assert.deepEqual(resolveCommandPath(["sessions", "-h"]), {
    definition: getCommandDefinition(["sessions"]),
    args: ["-h"],
  });
  assert.equal(resolveCommandPath(["does-not-exist"]), null);
});

test("generated help is surface-aware and command-specific", () => {
  const terminalRoot = renderRootHelp({ hostSurface: "terminal" });
  assert.match(terminalRoot, /^Usage:\n  polycli <command>/);
  assert.match(terminalRoot, /agent-context/);
  assert.match(terminalRoot, /\btui\b/);
  assert.doesNotMatch(terminalRoot, /polycli-companion\.mjs/);

  const pluginRoot = renderRootHelp({ hostSurface: "codex-skill" });
  assert.doesNotMatch(pluginRoot, /^\s+tui\s/m);

  const askHelp = renderCommandHelp(getCommandDefinition(["ask"]));
  assert.match(askHelp, /polycli ask/);
  assert.match(askHelp, /--provider/);
  assert.match(askHelp, /--model/);
  assert.match(askHelp, /Use `--` before prompt text that begins with `-`/);
  assert.match(askHelp, /Effects:/);
  assert.match(askHelp, /providerInvocation: yes/);
  assert.match(askHelp, /provider-or-prompt.*role=provider-or-prompt/);
  assert.match(askHelp, /prompt.*required, variadic, sensitive/);
  assert.doesNotMatch(askHelp, /polycli setup/);
});

test("registry validation rejects incomplete public metadata and alias collisions", () => {
  const clone = () => structuredClone(COMMAND_DEFINITIONS);

  const incomplete = clone();
  incomplete[0].errors = [];
  assert.throws(() => assertCommandRegistry({ commands: incomplete }), /incomplete public command definition/);

  const noExits = clone();
  noExits[0].exitCodes = [];
  assert.throws(() => assertCommandRegistry({ commands: noExits }), /incomplete public command definition/);

  const emptyOutputContract = clone();
  emptyOutputContract[0].outputs = {};
  assert.throws(
    () => assertCommandRegistry({ commands: emptyOutputContract }),
    /incomplete public command definition/,
  );

  const aliasCollision = clone();
  aliasCollision[0].aliases = ["json"];
  assert.throws(() => assertCommandRegistry({ commands: aliasCollision }), /command alias collides with option/);

  assert.throws(
    () => assertCommandRegistry({ handlerIds: ["setup"] }),
    /handler\/registry mismatch/,
  );
});

test("agent-facing effects describe provider and recovery side effects honestly", () => {
  const setup = getCommandDefinition(["setup"]);
  assert.equal(setup.effects.providerInvocation, true);
  assert.ok(setup.errors.includes("provider_failed"));
  assert.ok(setup.errors.includes("ledger_persist_failed"));
  for (const path of [["status"], ["result"], ["debug", "runs"], ["debug", "show"], ["debug", "explain"]]) {
    assert.equal(
      getCommandDefinition(path).effects.writesLocalState,
      true,
      `${path.join(" ")} may recover stale jobs while reading`,
    );
  }
  assert.equal(getCommandDefinition(["debug", "tail"]).effects.writesLocalState, false);
});

test("registry validation covers every declared uniqueness and safety invariant", () => {
  const clone = () => structuredClone(COMMAND_DEFINITIONS);

  const duplicateId = clone();
  duplicateId[1].id = duplicateId[0].id;
  assert.throws(() => assertCommandRegistry({ commands: duplicateId }), /duplicate command id/);

  const duplicatePath = clone();
  duplicatePath[1].path = duplicatePath[0].path;
  assert.throws(() => assertCommandRegistry({ commands: duplicatePath }), /duplicate command path/);

  const duplicateAlias = clone();
  duplicateAlias.find((entry) => entry.id === "ask").aliases = ["setup"];
  assert.throws(() => assertCommandRegistry({ commands: duplicateAlias }), /duplicate command name or alias/);

  const duplicateOption = clone();
  const ask = duplicateOption.find((entry) => entry.id === "ask");
  ask.options.push(structuredClone(ask.options.find((entry) => entry.name === "model")));
  assert.throws(() => assertCommandRegistry({ commands: duplicateOption }), /duplicate option/);

  const unresolvedSchema = clone();
  unresolvedSchema[0].outputs.text = "missing.schema";
  assert.throws(() => assertCommandRegistry({ commands: unresolvedSchema }), /unknown output schema/);

  const unresolvedError = clone();
  unresolvedError[0].errors.push("missing_error");
  assert.throws(() => assertCommandRegistry({ commands: unresolvedError }), /unknown error/);

  const missingRunId = clone();
  const tracked = missingRunId.find((entry) => entry.runTracked);
  tracked.options = tracked.options.filter((entry) => entry.name !== "run-id");
  assert.throws(() => assertCommandRegistry({ commands: missingRunId }), /run-tracked command missing run-id/);

  const terminalOptionLeak = clone();
  terminalOptionLeak.find((entry) => entry.id === "ask").options.push({
    ...structuredClone(terminalOptionLeak.find((entry) => entry.id === "tui").options.find((entry) => entry.name === "smoke")),
  });
  assert.throws(() => assertCommandRegistry({ commands: terminalOptionLeak }), /terminal-only option/);

  const destructiveWithoutConfirmation = clone();
  destructiveWithoutConfirmation.find((entry) => entry.id === "sessions.purge").constraints = [];
  assert.throws(
    () => assertCommandRegistry({ commands: destructiveWithoutConfirmation }),
    /destructive command missing confirmation constraint/,
  );
});

test("registered strict parsing rejects unknown options with command-local suggestions", () => {
  assert.throws(
    () => parseCommandArgs(getCommandDefinition(["ask"]), ["--provider", "qwen", "--modle", "x", "hello"]),
    (error) => {
      assert.equal(error.code, "invalid_argument");
      assert.equal(error.data.argument, "--modle");
      assert.ok(error.data.validFlags.includes("--model"));
      assert.deepEqual(error.data.suggestions, ["--model"]);
      return true;
    },
  );
});

test("registered strict parsing preserves literal option-looking prompt tokens after delimiter", () => {
  const parsed = parseCommandArgs(
    getCommandDefinition(["ask"]),
    ["--provider", "qwen", "--", "--modle", "is", "literal"],
  );
  assert.equal(parsed.options.provider, "qwen");
  assert.deepEqual(parsed.positionals, ["--modle", "is", "literal"]);
});
