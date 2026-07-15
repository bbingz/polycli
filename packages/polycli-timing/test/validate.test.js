import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { validateTimingRecord } from "../src/validate.js";

const schemaPath = fileURLToPath(new URL("../timing.schema.json", import.meta.url));

test("validateTimingRecord accepts capability-aware metric statuses", () => {
  const result = validateTimingRecord({
    version: 1,
    provider: "gemini",
    runtimePersistence: "ephemeral",
    measurementScope: "request",
    completedAt: "2026-04-21T10:00:00.000Z",
    metrics: {
      cold: { status: "measured", ms: 1200 },
      ttft: { status: "missing", ms: null },
      gen: { status: "measured", ms: 2200 },
      tool: { status: "zero", ms: 0 },
      retry: { status: "unsupported", ms: null },
      tail: { status: "measured", ms: 100 },
      total: { status: "measured", ms: 3500 },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateTimingRecord rejects impossible status/ms combinations", () => {
  const result = validateTimingRecord({
    version: 1,
    provider: "minimax",
    runtimePersistence: "session",
    measurementScope: "job",
    completedAt: "2026-04-21T10:00:00.000Z",
    metrics: {
      cold: { status: "unsupported", ms: 1 },
      ttft: { status: "measured", ms: 20 },
      gen: { status: "measured", ms: 30 },
      tool: { status: "measured", ms: 10 },
      retry: { status: "measured", ms: 0 },
      tail: { status: "measured", ms: 5 },
      total: { status: "measured", ms: 66 },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /cold/);
});

test("validateTimingRecord rejects extra metric keys and invalid total status", () => {
  const result = validateTimingRecord({
    version: 1,
    provider: "claude",
    runtimePersistence: "session",
    measurementScope: "request",
    completedAt: "2026-04-21T10:00:00.000Z",
    metrics: {
      cold: { status: "unsupported", ms: null },
      ttft: { status: "measured", ms: 20 },
      gen: { status: "measured", ms: 30 },
      tool: { status: "missing", ms: null },
      retry: { status: "unsupported", ms: null },
      tail: { status: "measured", ms: 5 },
      total: { status: "missing", ms: null },
      extra: { status: "measured", ms: 1 },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /metrics\.extra is not allowed/);
  assert.match(result.errors.join("\n"), /metrics\.total\.status must be measured or zero/);
});

test("validateTimingRecord rejects negative metric milliseconds", () => {
  const result = validateTimingRecord({
    version: 1,
    provider: "claude",
    runtimePersistence: "session",
    measurementScope: "request",
    completedAt: "2026-04-21T10:00:00.000Z",
    metrics: {
      cold: { status: "unsupported", ms: null },
      ttft: { status: "measured", ms: -1 },
      gen: { status: "measured", ms: 30 },
      tool: { status: "missing", ms: null },
      retry: { status: "unsupported", ms: null },
      tail: { status: "measured", ms: 5 },
      total: { status: "measured", ms: 66 },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /metrics\.ttft\.ms must be > 0/);
});

test("validateTimingRecord rejects invalid values for declared optional schema fields", () => {
  const validRecord = {
    version: 1,
    provider: "claude",
    runtimePersistence: "session",
    measurementScope: "request",
    completedAt: "2026-04-21T10:00:00.000Z",
    providerVersion: "2.1.209",
    kind: "ask",
    outcome: "success",
    exitCode: 0,
    terminationReason: "completed",
    responseMatched: true,
    errorCode: "none",
    meta: { source: "test" },
    metrics: {
      cold: { status: "unsupported", ms: null },
      ttft: { status: "measured", ms: 20 },
      gen: { status: "measured", ms: 30 },
      tool: { status: "missing", ms: null },
      retry: { status: "unsupported", ms: null },
      tail: { status: "measured", ms: 5 },
      total: { status: "measured", ms: 66 },
    },
  };
  const invalidCases = [
    ["providerVersion", 2, /providerVersion must be a string/],
    ["kind", false, /kind must be a string/],
    ["outcome", "partial", /outcome must be one of/],
    ["exitCode", 0.5, /exitCode must be an integer/],
    ["terminationReason", "", /terminationReason must be a non-empty string/],
    ["responseMatched", "true", /responseMatched must be a boolean/],
    ["errorCode", "", /errorCode must be a non-empty string/],
    ["meta", [], /meta must be an object/],
    ["completedAt", "2026-04-21", /completedAt must be an ISO-8601 date string/],
    ["completedAt", "2026-02-30T10:00:00.000Z", /completedAt must be an ISO-8601 date string/],
  ];

  for (const [field, value, expectedError] of invalidCases) {
    const result = validateTimingRecord({ ...validRecord, [field]: value });
    assert.equal(result.ok, false, `${field} should be rejected`);
    assert.match(result.errors.join("\n"), expectedError, `${field} error should explain the mismatch`);
  }
});

test("validateTimingRecord accepts optional fields that match the timing schema", () => {
  const result = validateTimingRecord({
    version: 1,
    provider: "claude",
    runtimePersistence: "session",
    measurementScope: "request",
    completedAt: "2026-04-21T10:00:00+08:00",
    providerVersion: "2.1.209",
    kind: "ask",
    outcome: "terminated",
    exitCode: 143,
    terminationReason: "signal",
    responseMatched: false,
    errorCode: "terminated",
    meta: { source: "test" },
    metrics: {
      cold: { status: "unsupported", ms: null },
      ttft: { status: "measured", ms: 20 },
      gen: { status: "measured", ms: 30 },
      tool: { status: "missing", ms: null },
      retry: { status: "unsupported", ms: null },
      tail: { status: "measured", ms: 5 },
      total: { status: "measured", ms: 66 },
    },
  });

  assert.deepEqual(result, { ok: true, errors: [] });
});

test("timing JSON schema mirrors validator status/ms and total contracts", () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const metricBranches = schema.$defs.metric.oneOf;
  const totalBranches = schema.$defs.totalMetric.oneOf;

  assert.deepEqual(
    metricBranches.map((branch) => branch.properties.status.const),
    ["measured", "zero", "missing", "unsupported"]
  );
  assert.deepEqual(
    metricBranches.map((branch) => branch.properties.ms),
    [
      { type: "number", exclusiveMinimum: 0 },
      { const: 0 },
      { type: "null" },
      { type: "null" },
    ]
  );
  assert.deepEqual(
    totalBranches.map((branch) => branch.properties.status.const),
    ["measured", "zero"]
  );
  assert.equal(schema.properties.metrics.properties.total.$ref, "#/$defs/totalMetric");
});
