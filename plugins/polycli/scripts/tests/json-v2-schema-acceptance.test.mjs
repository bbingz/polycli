import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  COMMAND_DEFINITIONS,
  OUTPUT_SCHEMA_DEFINITIONS,
  assertCommandRegistry,
  getCommandDefinition,
} from "../lib/command-registry.mjs";
import {
  PolycliCliError,
  createV2ErrorEnvelope,
  createV2SuccessEnvelope,
  serializeV2Result,
} from "../lib/cli-contract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const companion = path.resolve(here, "..", "polycli-companion.mjs");
const INVOCATION_ID = "inv_0123456789abcdefabcd";
const PRIVATE_KEYS = new Set([
  "argv",
  "configfile",
  "configpath",
  "env",
  "environment",
  "pid",
  "rawstderr",
  "rawstdout",
  "stderr",
  "stdout",
  "workerargv",
  "workercommand",
  "workercommandline",
  "workerpid",
  "workspaceroot",
]);

const activeJob = {
  jobId: "review-active123",
  provider: "qwen",
  kind: "review",
  status: "running",
  model: null,
  defaultModel: "qwen-default",
  promptPreview: "review staged changes",
  hostSessionId: "host-session",
  providerSessionId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:01.000Z",
  finishedAt: null,
  logFile: "/bounded/workspace-state/jobs/review-active123.log",
  error: null,
  pid: 4321,
  workerPid: 4321,
  workspaceRoot: "/private/workspace-marker",
  configFile: "/private/config-marker.json",
  env: { PRIVATE_TOKEN: "environment-secret-marker" },
};

const terminalJob = {
  ...activeJob,
  jobId: "review-terminal123",
  status: "completed",
  hostSessionId: null,
  providerSessionId: "provider-session",
  finishedAt: "2026-07-15T00:00:02.000Z",
};

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function schemaErrors(value, schema, location = "$", schemas = OUTPUT_SCHEMA_DEFINITIONS) {
  if (schema === true || schema == null) return [];
  if (schema === false) return [`${location}: false schema rejected value`];
  if (schema.$ref) {
    const target = schemas[schema.$ref];
    return target
      ? schemaErrors(value, target, location, schemas)
      : [`${location}: unresolved $ref ${schema.$ref}`];
  }

  const errors = [];
  const actualType = valueType(value);
  const acceptedTypes = schema.type == null
    ? null
    : (Array.isArray(schema.type) ? schema.type : [schema.type]);
  if (acceptedTypes && !acceptedTypes.includes(actualType)) {
    return [`${location}: expected ${acceptedTypes.join("|")}, got ${actualType}`];
  }

  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    errors.push(`${location}: expected const ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    errors.push(`${location}: value is not in enum`);
  }
  if (typeof value === "string" && schema.pattern && !(new RegExp(schema.pattern)).test(value)) {
    errors.push(`${location}: string does not match ${schema.pattern}`);
  }
  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) {
    errors.push(`${location}: value is below minimum ${schema.minimum}`);
  }
  if (typeof value === "number" && schema.maximum != null && value > schema.maximum) {
    errors.push(`${location}: value is above maximum ${schema.maximum}`);
  }

  if (schema.not && schemaErrors(value, schema.not, location, schemas).length === 0) {
    errors.push(`${location}: value matched forbidden schema`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => (
      schemaErrors(value, candidate, location, schemas).length === 0
    )).length;
    if (matches !== 1) errors.push(`${location}: expected exactly one oneOf match, got ${matches}`);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}: missing required property ${key}`);
    }
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        errors.push(...schemaErrors(child, properties[key], `${location}.${key}`, schemas));
      } else if (schema.additionalProperties === false) {
        errors.push(`${location}: unexpected property ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...schemaErrors(child, schema.additionalProperties, `${location}.${key}`, schemas));
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => {
      errors.push(...schemaErrors(entry, schema.items, `${location}[${index}]`, schemas));
    });
  }
  return errors;
}

function assertSchemaValid(value, schemaId, message = schemaId) {
  const schema = OUTPUT_SCHEMA_DEFINITIONS[schemaId];
  assert.ok(schema, `missing schema ${schemaId}`);
  assert.deepEqual(schemaErrors(value, schema), [], message);
}

function collectRefs(value, refs = []) {
  if (!value || typeof value !== "object") return refs;
  if (typeof value.$ref === "string") refs.push(value.$ref);
  for (const child of Object.values(value)) collectRefs(child, refs);
  return refs;
}

function assertNoPrivateRuntimeData(value) {
  const visit = (entry, location = "$", seen = new WeakSet()) => {
    if (!entry || typeof entry !== "object") return;
    if (seen.has(entry)) return;
    seen.add(entry);
    for (const [key, child] of Object.entries(entry)) {
      assert.equal(PRIVATE_KEYS.has(key.toLowerCase()), false, `${location}.${key} is private`);
      visit(child, `${location}.${key}`, seen);
    }
  };
  visit(value);
  assert.doesNotMatch(
    JSON.stringify(value),
    /environment-secret-marker|private\/workspace-marker|private\/config-marker|raw-stdout-secret/i,
  );
}

function fixtureCases() {
  return [
    ["setup", [{ provider: "qwen", available: false, pid: 4321, stopReviewGateWorkspace: "/private/workspace-marker" }]],
    ["health", {
      results: [{ provider: "qwen", ok: false, stdout: "raw-stdout-secret" }],
      healthyProviders: [],
      unhealthyProviders: ["qwen"],
      allHealthy: false,
      anyHealthy: false,
    }],
    ["ask", {
      provider: "qwen",
      kind: "ask",
      model: "qwen3",
      promptPreview: "hello",
      ok: false,
      error: "normal provider failure",
      sessionId: "provider-session",
      pid: 4321,
      configPath: "/private/config-marker.json",
      stdout: "raw-stdout-secret",
    }],
    ["rescue", { job: activeJob }, { background: true }],
    ["status", { totalJobs: 2, running: [activeJob], recent: [terminalJob] }],
    ["status", {
      totalJobs: 1,
      running: [activeJob],
      recent: [],
      waitTimedOut: true,
    }],
    ["status", { job: terminalJob }, {
      wait: { for: "completed", satisfied: true, timedOut: false, terminalMismatch: false },
    }],
    ["result", { job: terminalJob, providerResult: { ok: true, response: "done", pid: 4321 } }],
    ["cancel", { jobId: activeJob.jobId, cancelled: false, reason: "not_cancellable", pid: 4321 }],
    ["timing", { records: [], aggregate: {}, metadata: {} }],
    ["debug.runs", { runs: [{ runId: "run_a", pid: 4321 }] }],
    ["debug.show", { runId: "run_a", events: [{ eventId: "evt_1", pid: 4321, stdout: "raw-stdout-secret" }] }],
    ["debug.explain", { runId: "run_a", verdict: "completed", text: "done", configPath: "/private/config-marker" }],
    ["debug.tail", {
      runId: "run_a",
      events: [{ eventId: "evt_2", pid: 4321 }],
      cursor: { requested: "evt_1", oldest: "evt_1", latest: "evt_2", next: "evt_2" },
      limited: false,
      cursorExpired: false,
      waitTimedOut: false,
    }],
    ["sessions.list", {
      recorded: [{ provider: "qwen", sessionId: "session-a", pid: 4321 }],
      nonPurgeable: [],
    }],
    ["sessions.purge", {
      confirmed: false,
      plan: { deletable: [], skipped: [] },
      nonPurgeable: [],
      summary: { confirmed: false, deleted: 0 },
    }],
  ];
}

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
    timeout: 15_000,
  });
}

function createFakeQwenBin(root) {
  const bin = path.join(root, "qwen-fixture");
  fs.writeFileSync(bin, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("qwen 0.0.0-acceptance\\n");
  process.exit(0);
}
const sessionId = "00000000-0000-4000-8000-000000000399";
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "assistant", session_id: sessionId, message: { content: [{ type: "text", text: "ACCEPTANCE_OK" }] } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: sessionId, is_error: false, result: "ACCEPTANCE_OK", permission_denials: [] }) + "\\n");
`, { mode: 0o755 });
  return bin;
}

test("all installed operational JSON v2 outputs and every schema ref resolve", () => {
  assert.doesNotThrow(() => assertCommandRegistry());
  for (const [schemaId, schema] of Object.entries(OUTPUT_SCHEMA_DEFINITIONS)) {
    for (const ref of collectRefs(schema)) {
      assert.ok(OUTPUT_SCHEMA_DEFINITIONS[ref], `${schemaId} has unresolved $ref ${ref}`);
    }
  }

  for (const command of COMMAND_DEFINITIONS) {
    if (command.visibility !== "public" || !command.executable) continue;
    if (["agent-context", "tui"].includes(command.id)) continue;
    assert.equal(typeof command.outputs.jsonV2, "string", `${command.id} must declare JSON v2`);
    assert.ok(OUTPUT_SCHEMA_DEFINITIONS[command.outputs.jsonV2], `${command.id} JSON v2 schema must resolve`);
  }
});

test("representative cli-contract results validate against each command declaration and the envelope", () => {
  for (const [commandId, payload, context = {}] of fixtureCases()) {
    const result = serializeV2Result(commandId, payload, context);
    const command = getCommandDefinition(commandId.split("."));
    assertSchemaValid(result, command.outputs.jsonV2, `${commandId} result must match ${command.outputs.jsonV2}`);
    assertNoPrivateRuntimeData(result);

    const envelope = createV2SuccessEnvelope(result, {
      invocationId: INVOCATION_ID,
      command: command.path,
      hostSurface: "terminal",
      workspaceSlug: "polycli-abc123",
    });
    assertSchemaValid(envelope, "polycli.envelope.v2", `${commandId} envelope must validate`);
    assert.equal(envelope.ok, true);
    assert.equal("result" in envelope, true);
    assert.equal("error" in envelope, false);
    assertNoPrivateRuntimeData(envelope);
  }
});

test("success and error envelopes are schema-level mutually exclusive", () => {
  const result = serializeV2Result("timing", { records: [], aggregate: {}, metadata: {} });
  const success = createV2SuccessEnvelope(result, {
    invocationId: INVOCATION_ID,
    command: ["timing"],
    hostSurface: "terminal",
  });
  const failure = createV2ErrorEnvelope(new PolycliCliError({
    code: "invalid_argument",
    message: "Unknown option '--modle'.",
    data: { suggestions: ["--model"] },
    nextSteps: ["Run `polycli ask --help`."],
  }), {
    invocationId: INVOCATION_ID,
    command: ["ask"],
    hostSurface: "terminal",
  });

  assertSchemaValid(success, "polycli.envelope.v2");
  assertSchemaValid(failure, "polycli.envelope.v2");
  assert.equal("error" in success, false);
  assert.equal("result" in failure, false);
  assert.notDeepEqual(schemaErrors({ ...success, error: failure.error }, OUTPUT_SCHEMA_DEFINITIONS["polycli.envelope.v2"]), []);
  assert.notDeepEqual(schemaErrors({ ...failure, result }, OUTPUT_SCHEMA_DEFINITIONS["polycli.envelope.v2"]), []);
});

test("agent-context advertises the completed v2 schema surface deterministically and offline", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-context-"));
  const stateRoot = path.join(cwd, "must-not-exist");
  const missing = path.join(cwd, "provider-must-not-run");
  try {
    const env = {
      CLAUDE_PLUGIN_DATA: stateRoot,
      QWEN_CLI_BIN: missing,
      CLAUDE_CLI_BIN: missing,
      GEMINI_CLI_BIN: missing,
    };
    const first = run(["agent-context", "--json"], cwd, env);
    const second = run(["agent-context", "--json"], cwd, env);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);

    const context = JSON.parse(first.stdout);
    assertSchemaValid(context, "polycli.agent-context.v1");
    assert.equal(context.offline, true);
    assert.equal(context.features.jsonEnvelopeV2, true);
    assert.equal(context.features.ledgerCursor, true);
    assert.deepEqual(context.compatibility.legacyJobSessionId, {
      field: "sessionId",
      semantics: "ambiguous",
      deprecated: true,
      replacements: ["hostSessionId", "providerSessionId"],
    });
    assert.ok(context.commands.some((command) => command.id === "debug.tail"));
    assert.ok(context.commands.every((command) => (
      !command.executable
      || command.outputs.jsonV2
      || ["agent-context", "tui"].includes(command.id)
    )));
    assert.deepEqual(context.outputSchemas, OUTPUT_SCHEMA_DEFINITIONS);
    assert.equal(fs.existsSync(stateRoot), false);
    assert.doesNotMatch(first.stdout, /provider-must-not-run/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("deterministic operational commands emit schema-valid private-data-free JSON v2", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-v2-operational-"));
  const fakeQwen = createFakeQwenBin(cwd);
  const missingQwen = path.join(cwd, "missing-qwen");
  try {
    const successfulCases = [
      { name: "setup", args: ["setup", "--provider", "qwen", "--json-v2"], type: "provider.setup", env: { QWEN_CLI_BIN: missingQwen } },
      { name: "health-none", args: ["health", "--provider", "qwen", "--json-v2"], type: "provider.health", status: 2, env: { QWEN_CLI_BIN: missingQwen } },
      { name: "ask", args: ["ask", "--provider", "qwen", "--json-v2", "Return ACCEPTANCE_OK"], type: "provider.execution", env: { QWEN_CLI_BIN: fakeQwen } },
      { name: "timing", args: ["timing", "--json-v2"], type: "timing.report" },
      { name: "status", args: ["status", "--json-v2"], type: "job.status-list" },
      { name: "debug runs", args: ["debug", "runs", "--json-v2"], type: "ledger.run-list" },
      { name: "debug show", args: ["debug", "show", "run_missing", "--json-v2"], type: "ledger.run-events" },
      { name: "debug explain", args: ["debug", "explain", "run_missing", "--json-v2"], type: "ledger.explanation" },
      { name: "debug tail", args: ["debug", "tail", "--json-v2"], type: "ledger.tail" },
      { name: "sessions list", args: ["sessions", "list", "--json-v2"], type: "session.list" },
      { name: "sessions purge dry-run", args: ["sessions", "purge", "--json-v2"], type: "session.purge" },
    ];

    for (const entry of successfulCases) {
      await t.test(entry.name, () => {
        const execution = run(entry.args, cwd, entry.env);
        assert.equal(execution.status, entry.status ?? 0, execution.stderr || execution.stdout);
        assert.equal(execution.stderr, "");
        const envelope = JSON.parse(execution.stdout);
        assertSchemaValid(envelope, "polycli.envelope.v2");
        assert.equal(envelope.ok, true);
        assert.equal(envelope.result.type, entry.type);
        assert.equal("error" in envelope, false);
        assertNoPrivateRuntimeData(envelope);
      });
    }

    const failureCases = [
      { name: "missing terminal job", args: ["result", "--job", "latest-terminal", "--json-v2"], code: "no_completed_job" },
      { name: "missing active job", args: ["cancel", "--job", "latest-active", "--json-v2"], code: "no_active_job" },
      { name: "invalid option", args: ["ask", "--provider", "qwen", "--modle", "bad", "--json-v2", "hello"], code: "invalid_argument" },
    ];
    for (const entry of failureCases) {
      await t.test(entry.name, () => {
        const execution = run(entry.args, cwd, { QWEN_CLI_BIN: fakeQwen });
        assert.equal(execution.status, 1, execution.stderr || execution.stdout);
        assert.equal(execution.stderr, "");
        const envelope = JSON.parse(execution.stdout);
        assertSchemaValid(envelope, "polycli.envelope.v2");
        assert.equal(envelope.ok, false);
        assert.equal(envelope.error.code, entry.code);
        assert.equal("result" in envelope, false);
        assertNoPrivateRuntimeData(envelope);
      });
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
