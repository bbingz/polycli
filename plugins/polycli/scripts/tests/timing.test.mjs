import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateTimingRecord } from "@bbingz/polycli-timing";

import {
  appendTimingRecord,
  listTimingRecords,
  resolveTimingHistoryFile,
  summarizeTimingRecords,
} from "../lib/timing.mjs";

function withPluginData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-timing-test-"));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dir;
  try {
    return fn(dir);
  } finally {
    if (previous == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeRecord(provider, totalMs, completedAt) {
  return {
    version: 1,
    provider,
    runtimePersistence: "ephemeral",
    measurementScope: "request",
    completedAt,
    kind: "ask",
    metrics: {
      cold: { status: "unsupported", ms: null },
      ttft: { status: "missing", ms: null },
      gen: { status: "missing", ms: null },
      tool: { status: "unsupported", ms: null },
      retry: { status: "unsupported", ms: null },
      tail: { status: "unsupported", ms: null },
      total: { status: "measured", ms: totalMs },
    },
  };
}

test("appendTimingRecord persists validated NDJSON history", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-timing";
    const record = makeRecord("qwen", 1234, "2026-04-22T00:00:00.000Z");
    assert.equal(validateTimingRecord(record).ok, true);

    appendTimingRecord(workspaceRoot, record);

    const file = resolveTimingHistoryFile(workspaceRoot);
    assert.ok(fs.existsSync(file));
    const saved = listTimingRecords(workspaceRoot);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].metrics.total.ms, 1234);
  });
});

test("summarizeTimingRecords aggregates by provider", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-timing-summary";
    appendTimingRecord(workspaceRoot, makeRecord("qwen", 1000, "2026-04-22T00:00:00.000Z"));
    appendTimingRecord(workspaceRoot, makeRecord("qwen", 1500, "2026-04-22T00:00:01.000Z"));
    appendTimingRecord(workspaceRoot, makeRecord("kimi", 2000, "2026-04-22T00:00:02.000Z"));

    const records = listTimingRecords(workspaceRoot);
    const summary = summarizeTimingRecords(records);

    assert.equal(summary.recordCount, 3);
    assert.equal(summary.byProvider.qwen.recordCount, 2);
    assert.equal(summary.byProvider.qwen.metrics.total.p50, 1000);
    assert.equal(summary.byProvider.kimi.metrics.total.p50, 2000);
  });
});
