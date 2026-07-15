import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const companion = path.resolve(here, "..", "polycli-companion.mjs");

function run(args, { cwd, env = {} } = {}) {
  return spawnSync(process.execPath, [companion, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    },
    encoding: "utf8",
  });
}

test("source companion renders command-specific and nested help from the registry", () => {
  const ask = run(["ask", "--help"]);
  assert.equal(ask.status, 0, ask.stderr);
  assert.match(ask.stdout, /polycli ask/);
  assert.match(ask.stdout, /--model/);
  assert.doesNotMatch(ask.stdout, /polycli setup/);

  const nested = run(["debug", "show", "--help"]);
  assert.equal(nested.status, 0, nested.stderr);
  assert.match(nested.stdout, /polycli debug show/);
  assert.doesNotMatch(nested.stdout, /polycli debug explain/);

  const parent = run(["debug", "--help"]);
  assert.equal(parent.status, 0, parent.stderr);
  assert.match(parent.stdout, /polycli debug <runs\|show\|explain\|tail>/);
  assert.doesNotMatch(parent.stdout, /polycli debug runs \[--json/);

  const sessionsParent = run(["sessions", "-h"]);
  assert.equal(sessionsParent.status, 0, sessionsParent.stderr);
  assert.match(sessionsParent.stdout, /polycli sessions <list\|purge>/);
});

test("unknown command and subcommand suggestions stay public and path-local", () => {
  const unknownCommand = run(["askk", "--json-v2"]);
  assert.equal(unknownCommand.status, 1);
  const commandPayload = JSON.parse(unknownCommand.stdout);
  assert.equal(commandPayload.error.code, "unknown_command");
  assert.deepEqual(commandPayload.error.data.suggestions, ["ask"]);
  assert.equal(commandPayload.error.data.suggestions.includes("_job-worker"), false);

  const unknownSubcommand = run(["debug", "shwo", "--json-v2"]);
  assert.equal(unknownSubcommand.status, 1);
  const subcommandPayload = JSON.parse(unknownSubcommand.stdout);
  assert.equal(subcommandPayload.error.code, "unknown_subcommand");
  assert.deepEqual(subcommandPayload.error.data.suggestions, ["show"]);
});

test("invalid registered options fail before provider or state access", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-strict-cwd-"));
  const stateRoot = path.join(cwd, "state-must-not-exist");
  const providerMarker = path.join(cwd, "provider-must-not-run");
  try {
    const result = run(
      ["ask", "--provider", "qwen", "--modle", "qwen3", "--json", "hello"],
      {
        cwd,
        env: {
          CLAUDE_PLUGIN_DATA: stateRoot,
          QWEN_CLI_BIN: providerMarker,
        },
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.code, "invalid_argument");
    assert.match(payload.error, /--modle/);
    assert.match(payload.error, /--model/);
    assert.equal(fs.existsSync(stateRoot), false);
    assert.equal(fs.existsSync(providerMarker), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("semantic argument failures are rejected before any run ledger write", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-semantic-cwd-"));
  const stateRoot = path.join(cwd, "state-must-not-exist");
  const env = { CLAUDE_PLUGIN_DATA: stateRoot };
  try {
    const cases = [
      [["review", "--provider", "qwen", "--scope", "definitely-invalid", "--json"], "invalid_scope"],
      [["health", "--provider", "qwen", "--timeout-ms", "abc", "--json"], "invalid_argument"],
      [["ask", "--json"], "missing_provider"],
    ];
    for (const [args, expectedCode] of cases) {
      const result = run(args, { cwd, env });
      assert.equal(result.status, 1, `${args.join(" ")}: ${result.stderr}`);
      assert.equal(JSON.parse(result.stdout).code, expectedCode);
      assert.equal(fs.existsSync(stateRoot), false, args.join(" "));
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("strict parsing and help honor the option delimiter", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-delimiter-cwd-"));
  const stateRoot = path.join(cwd, "state");
  try {
    const hiddenTypo = run(["ask", "--provider", "qwen", "--modle", "x", "--help"], { cwd });
    assert.equal(hiddenTypo.status, 1);
    assert.doesNotMatch(hiddenTypo.stdout, /Usage:/);
    assert.match(hiddenTypo.stderr, /--modle/);

    const literalHelp = run(["ask", "--provider", "qwen", "--json", "--", "--help"], {
      cwd,
      env: { QWEN_CLI_BIN: path.join(cwd, "missing-qwen") },
    });
    assert.doesNotMatch(literalHelp.stdout, /Usage:/);

    for (const falseHelp of ["--help=false", "-h=false"]) {
      const status = run(["status", falseHelp, "--json"], {
        cwd,
        env: { CLAUDE_PLUGIN_DATA: stateRoot },
      });
      assert.equal(status.status, 0, `${falseHelp}: ${status.stderr}`);
      const payload = JSON.parse(status.stdout);
      assert.ok(Array.isArray(payload.running), falseHelp);
      assert.ok(Array.isArray(payload.recent), falseHelp);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("agent-context is deterministic, offline, and does not create state", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-agent-context-cwd-"));
  const stateRoot = path.join(cwd, "state-must-not-exist");
  const fakeBinDir = path.join(cwd, "fake-bin");
  const gitMarker = path.join(cwd, "git-must-not-run");
  fs.mkdirSync(fakeBinDir);
  fs.writeFileSync(
    path.join(fakeBinDir, "git"),
    `#!/bin/sh\nprintf called > "${gitMarker}"\n\nexit 99\n`,
    { mode: 0o755 },
  );
  fs.mkdirSync(path.join(cwd, "parent-repository", ".git"), { recursive: true });
  const nestedCwd = path.join(cwd, "parent-repository", "deep", "nested");
  fs.mkdirSync(nestedCwd, { recursive: true });
  const env = {
    PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
    CLAUDE_PLUGIN_DATA: stateRoot,
    QWEN_CLI_BIN: path.join(cwd, "missing-qwen"),
    CLAUDE_CLI_BIN: path.join(cwd, "missing-claude"),
  };
  try {
    const first = run(["agent-context", "--json"], { cwd: nestedCwd, env });
    const second = run(["agent-context", "--json"], { cwd: nestedCwd, env });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    const payload = JSON.parse(first.stdout);
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.offline, true);
    assert.equal(payload.build.version, "0.0.0-dev");
    assert.equal(payload.build.versionSource, "development");
    assert.ok(payload.commands.some((entry) => entry.id === "agent-context"));
    assert.ok(payload.providers.some((entry) => entry.id === "qwen"));
    assert.equal(payload.providers.some((entry) => "available" in entry), false);
    assert.equal(payload.features.jsonEnvelopeV2, true);
    assert.equal(payload.features.ledgerCursor, true);
    assert.equal(fs.existsSync(stateRoot), false);
    assert.equal(fs.existsSync(gitMarker), false, "agent-context must not spawn git or discover parent repositories");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("Claude setup defaults to legacy JSON without blocking explicit JSON v2", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-claude-setup-output-"));
  const stateRoot = path.join(cwd, "state");
  const missingQwen = path.join(cwd, "missing-qwen");
  const env = {
    POLYCLI_HOST_SURFACE: "claude-plugin",
    CLAUDE_PLUGIN_DATA: stateRoot,
    QWEN_CLI_BIN: missingQwen,
  };
  try {
    const legacyDefault = run(["setup", "--provider", "qwen"], { cwd, env });
    assert.equal(legacyDefault.status, 0, legacyDefault.stderr);
    assert.ok(Array.isArray(JSON.parse(legacyDefault.stdout)));

    const explicitV2 = run(["setup", "--provider", "qwen", "--json-v2"], { cwd, env });
    assert.equal(explicitV2.status, 0, explicitV2.stderr);
    assert.equal(JSON.parse(explicitV2.stdout).schemaVersion, 2);

    const falseV2 = run(["setup", "--provider", "qwen", "--json-v2=false"], { cwd, env });
    assert.equal(falseV2.status, 0, falseV2.stderr);
    assert.ok(Array.isArray(JSON.parse(falseV2.stdout)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("statically unsupported review safety fails before provider dispatch or run-ledger creation", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-unsupported-"));
  const stateRoot = path.join(cwd, "state-must-not-exist");
  const providerMarker = path.join(cwd, "agy-must-not-run");
  const providerBin = path.join(cwd, "agy");
  fs.writeFileSync(
    providerBin,
    `#!/bin/sh\nprintf called > "${providerMarker}"\n\nexit 0\n`,
    { mode: 0o755 },
  );
  try {
    const result = run(["review", "--provider", "agy", "--json-v2"], {
      cwd,
      env: {
        CLAUDE_PLUGIN_DATA: stateRoot,
        AGY_CLI_BIN: providerBin,
      },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schemaVersion, 2);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "invalid_argument");
    assert.equal(payload.error.data.provider, "agy");
    assert.equal(payload.error.data.reviewSafety, "unsupported");
    assert.equal(fs.existsSync(providerMarker), false);
    assert.equal(fs.existsSync(stateRoot), false);

    const legacy = run(["review", "--provider", "agy", "--json"], {
      cwd,
      env: { CLAUDE_PLUGIN_DATA: stateRoot, AGY_CLI_BIN: providerBin },
    });
    assert.equal(legacy.status, 1);
    assert.deepEqual(JSON.parse(legacy.stdout).code, "error");
    assert.equal(fs.existsSync(providerMarker), false);
    assert.equal(fs.existsSync(stateRoot), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
