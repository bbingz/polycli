import test from "node:test";
import assert from "node:assert/strict";

import { validateTimingRecord } from "@bbingz/polycli-timing";

import { buildPromptTimingRecord, extractProviderEventText } from "../src/timing.js";
import { getProviderRuntime, runProviderPrompt } from "../src/index.js";

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

test("buildPromptTimingRecord preserves outcome diagnostics", () => {
  const record = buildPromptTimingRecord({
    provider: "qwen",
    kind: "ask",
    completedAt: "2026-04-22T00:00:00.000Z",
    totalMs: 1000,
    outcome: "failure",
    exitCode: 1,
    terminationReason: "qwen_max_session_turns",
    responseMatched: false,
    errorCode: "qwen_max_session_turns",
  });

  const validation = validateTimingRecord(record);
  assert.equal(validation.ok, true);
  assert.equal(record.outcome, "failure");
  assert.equal(record.exitCode, 1);
  assert.equal(record.terminationReason, "qwen_max_session_turns");
  assert.equal(record.responseMatched, false);
  assert.equal(record.errorCode, "qwen_max_session_turns");
});

test("buildPromptTimingRecord degrades negative derived metrics to missing instead of throwing", () => {
  const record = buildPromptTimingRecord({
    provider: "gemini",
    kind: "prompt",
    completedAt: "2026-04-22T00:00:00.000Z",
    totalMs: 100,
    ttftMs: 120,
    tailMs: -1,
    supportedMetrics: {
      ttft: true,
      gen: true,
      tail: true,
    },
  });

  assert.equal(record.metrics.ttft.status, "measured");
  assert.equal(record.metrics.gen.status, "missing");
  assert.equal(record.metrics.tail.status, "missing");
});

test("runProviderPrompt attaches failure diagnostics to timing", async () => {
  const result = await runProviderPrompt({
    provider: "qwen",
    prompt: "ping",
    cwd: process.cwd(),
    nowMs: (() => {
      const values = [1000, 2500];
      return () => values.shift() ?? 2500;
    })(),
    runtime: {
      runPrompt: async () => ({
        ok: false,
        response: "",
        error: "qwen exited with code 124",
        status: 124,
      }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.timing.outcome, "timeout");
  assert.equal(result.timing.exitCode, 124);
  assert.equal(result.timing.terminationReason, "timeout");
});

test("runProviderPrompt preserves session persistence capability when a run omits sessionId", async () => {
  const result = await runProviderPrompt({
    provider: "gemini",
    prompt: "ping",
    cwd: process.cwd(),
    meta: { source: "test" },
    runtime: {
      runPrompt: async () => ({
        ok: true,
        response: "pong",
      }),
    },
  });

  assert.equal(result.timing.runtimePersistence, "session");
  assert.equal(result.timing.meta.source, "test");
  assert.equal(result.timing.meta.sessionIdMissing, true);
});

test("extractProviderEventText handles provider-specific assistant/result payloads", () => {
  assert.equal(
    extractProviderEventText("qwen", { type: "result", result: "No issues found." }),
    "No issues found."
  );
  assert.equal(
    extractProviderEventText("kimi", { role: "assistant", content: "final review body" }),
    "final review body"
  );
  assert.equal(
    extractProviderEventText("claude", {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "claude " },
          { type: "tool_use", name: "Read", input: { file: "README.md" } },
          { type: "text", text: "reply" },
        ],
      },
    }),
    "claude reply"
  );
  assert.equal(
    extractProviderEventText("copilot", {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "copilot ok" }] },
    }),
    "copilot ok"
  );
  assert.equal(
    extractProviderEventText("opencode", {
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "opencode ok" }],
    }),
    "opencode ok"
  );
  assert.equal(
    extractProviderEventText("pi", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "pi ok" },
    }),
    "pi ok"
  );
});

test("extractProviderEventText ignores qwen error result events", () => {
  assert.equal(
    extractProviderEventText("qwen", { type: "result", subtype: "error", is_error: true, result: "permission denied" }),
    ""
  );
});
