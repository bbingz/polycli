import test from "node:test";
import assert from "node:assert/strict";

import { aggregateTimingRecords } from "../src/aggregate.js";

test("aggregateTimingRecords keeps unsupported, missing, and zero separate", () => {
  const summary = aggregateTimingRecords([
    {
      version: 1,
      provider: "gemini",
      runtimePersistence: "ephemeral",
      measurementScope: "request",
      completedAt: "2026-04-21T10:00:00.000Z",
      metrics: {
        cold: { status: "measured", ms: 1000 },
        ttft: { status: "measured", ms: 500 },
        gen: { status: "measured", ms: 2000 },
        tool: { status: "zero", ms: 0 },
        retry: { status: "zero", ms: 0 },
        tail: { status: "measured", ms: 100 },
        total: { status: "measured", ms: 3600 },
      },
    },
    {
      version: 1,
      provider: "gemini",
      runtimePersistence: "ephemeral",
      measurementScope: "request",
      completedAt: "2026-04-21T10:02:00.000Z",
      metrics: {
        cold: { status: "missing", ms: null },
        ttft: { status: "measured", ms: 450 },
        gen: { status: "measured", ms: 2100 },
        tool: { status: "zero", ms: 0 },
        retry: { status: "zero", ms: 0 },
        tail: { status: "measured", ms: 120 },
        total: { status: "measured", ms: 3670 },
      },
    },
    {
      version: 1,
      provider: "minimax",
      runtimePersistence: "session",
      measurementScope: "job",
      completedAt: "2026-04-21T10:03:00.000Z",
      metrics: {
        cold: { status: "unsupported", ms: null },
        ttft: { status: "unsupported", ms: null },
        gen: { status: "measured", ms: 9000 },
        tool: { status: "missing", ms: null },
        retry: { status: "unsupported", ms: null },
        tail: { status: "measured", ms: 700 },
        total: { status: "measured", ms: 9700 },
      },
    },
  ]);

  assert.equal(summary.recordCount, 3);
  assert.equal(summary.byProvider.gemini.metrics.cold.contributingCount, 1);
  assert.equal(summary.byProvider.gemini.metrics.cold.missingCount, 1);
  assert.equal(summary.byProvider.gemini.metrics.tool.zeroCount, 2);
  assert.deepEqual(summary.byProvider.gemini.runtimePersistenceCounts, {
    ephemeral: 2,
    session: 0,
    daemon: 0,
  });
  assert.deepEqual(summary.byProvider.gemini.measurementScopeCounts, {
    request: 2,
    turn: 0,
    job: 0,
  });
  assert.equal(summary.byProvider.minimax.metrics.cold.unsupportedCount, 1);
  assert.equal(summary.byProvider.minimax.metrics.tool.missingCount, 1);
  assert.deepEqual(summary.byProvider.minimax.runtimePersistenceCounts, {
    ephemeral: 0,
    session: 1,
    daemon: 0,
  });
  assert.deepEqual(summary.byProvider.minimax.measurementScopeCounts, {
    request: 0,
    turn: 0,
    job: 1,
  });
});

test("aggregateTimingRecords excludes zero values from measured percentiles", () => {
  const summary = aggregateTimingRecords([
    {
      version: 1,
      provider: "qwen",
      runtimePersistence: "session",
      measurementScope: "request",
      completedAt: "2026-04-21T10:00:00.000Z",
      metrics: {
        cold: { status: "unsupported", ms: null },
        ttft: { status: "measured", ms: 100 },
        gen: { status: "measured", ms: 200 },
        tool: { status: "zero", ms: 0 },
        retry: { status: "unsupported", ms: null },
        tail: { status: "measured", ms: 30 },
        total: { status: "measured", ms: 330 },
      },
    },
    {
      version: 1,
      provider: "qwen",
      runtimePersistence: "session",
      measurementScope: "request",
      completedAt: "2026-04-21T10:01:00.000Z",
      metrics: {
        cold: { status: "unsupported", ms: null },
        ttft: { status: "measured", ms: 200 },
        gen: { status: "measured", ms: 300 },
        tool: { status: "measured", ms: 40 },
        retry: { status: "unsupported", ms: null },
        tail: { status: "measured", ms: 20 },
        total: { status: "measured", ms: 520 },
      },
    },
  ]);

  const tool = summary.byProvider.qwen.metrics.tool;
  assert.equal(tool.measuredCount, 1);
  assert.equal(tool.zeroCount, 1);
  assert.equal(tool.p50, 40);
  assert.equal(tool.avg, 40);
  assert.equal(tool.capability, "supported");
});
