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
