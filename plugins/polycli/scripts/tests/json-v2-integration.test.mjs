import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const companion = path.resolve(here, "..", "polycli-companion.mjs");

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [companion, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CLAUDE_PLUGIN_DATA: path.join(cwd, ".state"),
      POLYCLI_HOST_SURFACE: "terminal",
      ...env,
    },
    encoding: "utf8",
  });
}

test("--json-v2 wraps an authoritative command result with invocation metadata", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-timing-"));
  try {
    const result = run(["timing", "--json-v2"], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schemaVersion, 2);
    assert.match(payload.id, /^inv_[a-zA-Z0-9]+$/);
    assert.equal(payload.ok, true);
    assert.equal(payload.result.type, "timing.report");
    assert.ok(Array.isArray(payload.result.records));
    assert.deepEqual(payload._meta.command, ["timing"]);
    assert.equal(payload._meta.hostSurface, "terminal");
    assert.equal("error" in payload, false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("--json-v2 serializes typed parse failures and suggestions", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-error-"));
  try {
    const result = run(["ask", "--provider", "qwen", "--modle", "qwen3", "--json-v2", "hello"], cwd);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schemaVersion, 2);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "invalid_argument");
    assert.deepEqual(payload.error.data.suggestions, ["--model"]);
    assert.ok(payload.error.nextSteps.some((step) => step.includes("ask --help")));
    assert.equal("result" in payload, false);
    assert.equal(fs.existsSync(path.join(cwd, ".state")), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("legacy --json remains unwrapped and conflicting output modes are rejected", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-compat-"));
  try {
    const legacy = run(["timing", "--json"], cwd);
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.equal(JSON.parse(legacy.stdout).schemaVersion, undefined);

    const conflict = run(["timing", "--json", "--json-v2"], cwd);
    assert.equal(conflict.status, 1);
    const conflictPayload = JSON.parse(conflict.stdout);
    assert.equal(conflictPayload.schemaVersion, 2);
    assert.equal(conflictPayload.ok, false);
    assert.equal(conflictPayload.error.code, "invalid_argument");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("--json-v2 remains authoritative when an explicit legacy false flag follows or precedes it", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-false-compat-"));
  try {
    for (const args of [
      ["timing", "--json-v2", "--json=false"],
      ["timing", "--json=false", "--json-v2"],
    ]) {
      const result = run(args, cwd);
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.equal(result.stderr, "");
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.schemaVersion, 2, args.join(" "));
      assert.equal(payload.ok, true, args.join(" "));
      assert.equal(payload.result.type, "timing.report", args.join(" "));
      assert.equal(payload.result.metadata.historyLimit, 20, args.join(" "));
      assert.equal(payload.result.metadata.recordCount, 0, args.join(" "));
      assert.equal(payload.result.metadata.aggregateScope, "records", args.join(" "));
      assert.match(payload.id, /^inv_[a-zA-Z0-9]+$/, args.join(" "));
      assert.deepEqual(payload._meta.command, ["timing"], args.join(" "));
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("output mode compatibility rewriting stops at the option delimiter", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-delimiter-"));
  try {
    const argvLog = path.join(cwd, "qwen-argv.json");
    const fakeQwen = path.join(cwd, "qwen");
    fs.writeFileSync(
      fakeQwen,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.QWEN_ARGV_LOG, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "q-delimiter", model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: "delimiter-ok", is_error: false }) + "\\n");
`,
      { mode: 0o755 },
    );
    const result = run(
      ["ask", "--provider", "qwen", "--json-v2", "--", "--json=false"],
      cwd,
      { QWEN_CLI_BIN: fakeQwen, QWEN_ARGV_LOG: argvLog },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schemaVersion, 2);
    assert.equal(payload.ok, true);
    assert.equal(payload.result.type, "provider.execution");
    assert.equal(payload.result.providerResult.ok, true);
    assert.equal(payload.result.providerResult.response, "delimiter-ok");
    assert.deepEqual(payload._meta.command, ["ask"]);
    assert.equal(JSON.parse(fs.readFileSync(argvLog, "utf8")).includes("--json=false"), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("invalid run ids are typed invalid_argument errors in JSON v2", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-invalid-run-id-"));
  try {
    const result = run([
      "health", "--provider", "qwen", "--run-id", "not a valid run id", "--json-v2",
    ], cwd);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schemaVersion, 2);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "invalid_argument");
    assert.equal(payload.error.data.argument, "--run-id");
    assert.equal(fs.existsSync(path.join(cwd, ".state")), false);

    const envResult = run(
      ["health", "--provider", "qwen", "--json-v2"],
      cwd,
      { POLYCLI_RUN_ID: "TOKEN=environment-secret-marker" },
    );
    assert.equal(envResult.status, 1);
    assert.doesNotMatch(envResult.stdout, /environment-secret-marker/);
    assert.match(envResult.stdout, /<secret:redacted>/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("provider spawn paths stay redacted in JSON v2 results and debug tail", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-private-provider-path-"));
  try {
    const privateBin = path.join(cwd, "private-config", "secret-qwen-bin");
    const ask = run(
      ["ask", "--provider", "qwen", "--json-v2", "hello"],
      cwd,
      { QWEN_CLI_BIN: privateBin },
    );
    assert.equal(ask.status, 0, ask.stderr);
    const askPayload = JSON.parse(ask.stdout);
    assert.equal(askPayload.ok, true);
    assert.equal(askPayload.result.providerResult.ok, false);
    assert.doesNotMatch(JSON.stringify(askPayload), /private-config|secret-qwen-bin/);

    const tail = run(["debug", "tail", "--json-v2"], cwd);
    assert.equal(tail.status, 0, tail.stderr);
    const tailPayload = JSON.parse(tail.stdout);
    assert.doesNotMatch(JSON.stringify(tailPayload), /private-config|secret-qwen-bin/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("an invalid review base is an explicit typed argument error before provider invocation", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-invalid-review-base-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd });
    spawnSync("git", ["config", "user.email", "polycli@example.invalid"], { cwd });
    spawnSync("git", ["config", "user.name", "Polycli Test"], { cwd });
    fs.writeFileSync(path.join(cwd, "tracked.txt"), "tracked\n", "utf8");
    spawnSync("git", ["add", "tracked.txt"], { cwd });
    spawnSync("git", ["commit", "-qm", "initial"], { cwd });

    const marker = path.join(cwd, "provider-invoked");
    const fakeQwen = path.join(cwd, "qwen");
    fs.writeFileSync(
      fakeQwen,
      `#!/bin/sh\ntouch "${marker}"\nexit 0\n`,
      { mode: 0o755 },
    );
    const result = run([
      "review",
      "--provider", "qwen",
      "--scope", "branch",
      "--base", "definitely-not-a-ref",
      "--json-v2",
    ], cwd, { QWEN_CLI_BIN: fakeQwen });

    assert.equal(result.status, 1, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "invalid_argument");
    assert.equal(payload.error.data.argument, "--base");
    assert.ok(payload.error.nextSteps.some((step) => step.includes("review --help")));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
