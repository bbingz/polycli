import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyProviderStates,
  formatReproductionCommand,
  truncateMiddle,
} from "../../packages/polycli-terminal/lib/tui/view-model.mjs";

test("tui view model classifies provider decisions and unfinished worker attempts", () => {
  const events = [
    { runId: "run-a", provider: "qwen", phase: "provider_decision", status: "adopted", jobId: "job-q" },
    { runId: "run-a", provider: "cmd", phase: "provider_decision", status: "failed", reason: "ask_failed", jobId: "job-c" },
    { runId: "run-a", provider: "pi", phase: "provider_decision", status: "skipped", reason: "health_failed" },
    { runId: "run-a", provider: "kimi", phase: "attempt_started", status: "started", jobId: "job-k", logFile: "/tmp/job-k.log" },
  ];

  const states = classifyProviderStates(events);

  assert.equal(states.qwen.status, "adopted");
  assert.equal(states.cmd.status, "failed");
  assert.equal(states.cmd.reason, "ask_failed");
  assert.equal(states.pi.status, "skipped");
  assert.equal(states.kimi.status, "unfinished");
  assert.equal(states.kimi.jobId, "job-k");
  assert.equal(states.kimi.logFile, "/tmp/job-k.log");
});

test("tui view model renders unknown when provider has no terminal evidence", () => {
  const states = classifyProviderStates([
    { runId: "run-a", provider: "minimax", phase: "run_started", status: "started" },
  ]);

  assert.equal(states.minimax.status, "unknown");
});

test("formatReproductionCommand uses sanitized argv and quotes shell-sensitive tokens", () => {
  assert.equal(
    formatReproductionCommand(["ask", "--provider", "qwen", "<prompt:redacted>", "--run-id", "run a"]),
    "polycli ask --provider qwen '<prompt:redacted>' --run-id 'run a'",
  );
});

test("truncateMiddle keeps fixed-width text stable", () => {
  assert.equal(truncateMiddle("run_abcdefghijklmnopqrstuvwxyz", 12), "run_a...wxyz");
  assert.equal(truncateMiddle("short", 12), "short");
});

import {
  buildTuiModel,
  renderTuiFrame,
} from "../../packages/polycli-terminal/lib/tui/view-model.mjs";

test("buildTuiModel creates run list, matrix, timeline, and detail panes", () => {
  const model = buildTuiModel({
    runs: [
      { runId: "run-a", commands: ["ask"], startedAt: "2026-05-07T00:00:00.000Z", adoptedCount: 1, skippedCount: 1, failedCount: 1 },
    ],
    events: [
      { runId: "run-a", at: "2026-05-07T00:00:00.000Z", command: "ask", phase: "run_started", status: "started", hostSurface: "terminal", argv: ["ask", "--provider", "qwen", "<prompt:redacted>"] },
      { runId: "run-a", at: "2026-05-07T00:00:01.000Z", provider: "qwen", phase: "provider_decision", status: "adopted", preview: "ok" },
      { runId: "run-a", at: "2026-05-07T00:00:02.000Z", provider: "cmd", phase: "provider_decision", status: "failed", reason: "ask_failed" },
      { runId: "run-a", at: "2026-05-07T00:00:03.000Z", provider: "kimi", phase: "attempt_started", status: "started", jobId: "job-k" },
    ],
    explanationText: "qwen adopted\ncmd failed (ask_failed)",
    selectedRunId: "run-a",
    width: 96,
    height: 28,
  });

  assert.equal(model.mode, "wide");
  assert.equal(model.runs[0].runId, "run-a");
  assert.equal(model.providers.qwen.status, "adopted");
  assert.equal(model.providers.cmd.status, "failed");
  assert.equal(model.providers.kimi.status, "unfinished");
  assert.ok(model.reproductionCommands.includes("polycli ask --provider qwen '<prompt:redacted>'"));
});

test("renderTuiFrame includes unfinished state and footer controls", () => {
  const frame = renderTuiFrame({
    runs: [{ runId: "run-a", commands: ["ask"], startedAt: "now" }],
    events: [
      { runId: "run-a", provider: "kimi", phase: "attempt_started", status: "started", jobId: "job-k" },
    ],
    selectedRunId: "run-a",
    width: 80,
    height: 20,
  });

  assert.match(frame, /run-a/);
  assert.match(frame, /kimi/);
  assert.match(frame, /unfinished/);
  assert.match(frame, /q quit/);
});
