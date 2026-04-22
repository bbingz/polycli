import test from "node:test";
import assert from "node:assert/strict";

import { validateTimingRecord } from "@bbingz/polycli-timing";

import { buildPromptTimingRecord, extractProviderEventText } from "../src/timing.js";

test("buildPromptTimingRecord emits a valid request-scoped record for one-shot runs", () => {
  const record = buildPromptTimingRecord({
    provider: "qwen",
    kind: "ask",
    completedAt: "2026-04-22T00:00:00.000Z",
    totalMs: 1200,
  });

  const validation = validateTimingRecord(record);
  assert.equal(validation.ok, true);
  assert.equal(record.measurementScope, "request");
  assert.equal(record.metrics.total.status, "measured");
  assert.equal(record.metrics.total.ms, 1200);
  assert.equal(record.metrics.ttft.status, "unsupported");
});

test("buildPromptTimingRecord derives ttft/gen for streaming runs", () => {
  const record = buildPromptTimingRecord({
    provider: "gemini",
    kind: "rescue",
    runtimePersistence: "session",
    measurementScope: "job",
    completedAt: "2026-04-22T00:00:00.000Z",
    totalMs: 2200,
    ttftMs: 700,
    tailMs: 120,
    supportedMetrics: {
      ttft: true,
      gen: true,
      tail: true,
    },
  });

  const validation = validateTimingRecord(record);
  assert.equal(validation.ok, true);
  assert.equal(record.runtimePersistence, "session");
  assert.equal(record.measurementScope, "job");
  assert.equal(record.metrics.ttft.status, "measured");
  assert.equal(record.metrics.ttft.ms, 700);
  assert.equal(record.metrics.gen.status, "measured");
  assert.equal(record.metrics.gen.ms, 1500);
  assert.equal(record.metrics.tail.status, "measured");
  assert.equal(record.metrics.tail.ms, 120);
  assert.equal(record.metrics.tool.status, "unsupported");
});

test("buildPromptTimingRecord keeps supported-but-missing metrics separate from unsupported ones", () => {
  const record = buildPromptTimingRecord({
    provider: "qwen",
    kind: "ask",
    runtimePersistence: "session",
    completedAt: "2026-04-22T00:00:00.000Z",
    totalMs: 1000,
    supportedMetrics: {
      ttft: true,
      gen: true,
      tool: true,
      tail: true,
    },
  });

  const validation = validateTimingRecord(record);
  assert.equal(validation.ok, true);
  assert.equal(record.metrics.ttft.status, "missing");
  assert.equal(record.metrics.gen.status, "missing");
  assert.equal(record.metrics.tool.status, "missing");
  assert.equal(record.metrics.tail.status, "missing");
  assert.equal(record.metrics.retry.status, "unsupported");
});

test("extractProviderEventText handles qwen result-only and kimi string content events", () => {
  assert.equal(
    extractProviderEventText("qwen", { type: "result", result: "No issues found." }),
    "No issues found."
  );
  assert.equal(
    extractProviderEventText("kimi", { role: "assistant", content: "final review body" }),
    "final review body"
  );
});

test("extractProviderEventText ignores qwen error result events", () => {
  assert.equal(
    extractProviderEventText("qwen", { type: "result", subtype: "error", is_error: true, result: "permission denied" }),
    ""
  );
});
