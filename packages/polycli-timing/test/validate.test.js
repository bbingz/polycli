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
