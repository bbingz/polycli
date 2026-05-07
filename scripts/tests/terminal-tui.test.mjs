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

import { applyKey } from "../../packages/polycli-terminal/lib/tui/view-model.mjs";

test("applyKey down/j moves selection to next run; up/k moves back", () => {
  const state = {
    runs: [{ runId: "a" }, { runId: "b" }, { runId: "c" }],
    selectedRunId: "a",
  };
  assert.equal(applyKey(state, "down").selectedRunId, "b");
  assert.equal(applyKey(state, "j").selectedRunId, "b");
  assert.equal(applyKey({ ...state, selectedRunId: "c" }, "up").selectedRunId, "b");
  assert.equal(applyKey({ ...state, selectedRunId: "c" }, "k").selectedRunId, "b");
  assert.equal(applyKey({ ...state, selectedRunId: "a" }, "up").selectedRunId, "a");
  assert.equal(applyKey({ ...state, selectedRunId: "c" }, "down").selectedRunId, "c");
});

test("applyKey enter opens detail view; b returns to list", () => {
  assert.equal(applyKey({ view: "list" }, "enter").view, "detail");
  assert.equal(applyKey({ view: "detail" }, "b").view, "list");
});

test("applyKey tab cycles focused pane runs->providers->events->repro->runs", () => {
  let state = { focusedPane: "runs" };
  state = applyKey(state, "tab");
  assert.equal(state.focusedPane, "providers");
  state = applyKey(state, "tab");
  assert.equal(state.focusedPane, "events");
  state = applyKey(state, "tab");
  assert.equal(state.focusedPane, "repro");
  state = applyKey(state, "tab");
  assert.equal(state.focusedPane, "runs");
});

test("applyKey ? toggles showHelp", () => {
  assert.equal(applyKey({ showHelp: false }, "?").showHelp, true);
  assert.equal(applyKey({ showHelp: true }, "?").showHelp, false);
});

test("applyKey on empty runs leaves selection untouched", () => {
  const state = { runs: [], selectedRunId: null };
  assert.equal(applyKey(state, "down").selectedRunId, null);
  assert.equal(applyKey(state, "up").selectedRunId, null);
});

test("after applyKey down, render frame shows the new selection's providers", () => {
  const data = {
    runs: [{ runId: "run-a", commands: ["ask"] }, { runId: "run-b", commands: ["health"] }],
    events: [
      { runId: "run-a", provider: "qwen", phase: "provider_decision", status: "adopted" },
      { runId: "run-b", provider: "pi", phase: "provider_decision", status: "skipped", reason: "health_failed" },
    ],
    width: 96, height: 28,
  };
  const before = renderTuiFrame({ ...data, selectedRunId: "run-a" });
  const next = applyKey({ ...data, selectedRunId: "run-a" }, "down");
  const after = renderTuiFrame({ ...data, selectedRunId: next.selectedRunId });
  assert.match(before, /qwen adopted/);
  assert.equal(before.includes("pi skipped"), false);
  assert.match(after, /pi skipped/);
  assert.equal(after.includes("qwen adopted"), false);
});

test("after applyKey enter, detail view exposes explanation text not present in list view", () => {
  const data = {
    runs: [{ runId: "run-a", commands: ["ask"] }],
    events: [{ runId: "run-a", provider: "qwen", phase: "provider_decision", status: "adopted" }],
    explanationText: "EXPL_UNIQUE_TOKEN",
    width: 96, height: 28,
  };
  const list = renderTuiFrame({ ...data, selectedRunId: "run-a", view: "list" });
  const next = applyKey({ ...data, selectedRunId: "run-a", view: "list" }, "enter");
  const detail = renderTuiFrame({ ...data, selectedRunId: "run-a", view: next.view });
  assert.equal(next.view, "detail");
  assert.equal(list.includes("EXPL_UNIQUE_TOKEN"), false);
  assert.match(detail, /EXPL_UNIQUE_TOKEN/);
});

test("renderTuiFrame Help line appears only when showHelp=true", () => {
  const data = {
    runs: [{ runId: "run-a", commands: ["ask"] }],
    events: [{ runId: "run-a", provider: "qwen", phase: "provider_decision", status: "adopted" }],
    selectedRunId: "run-a", width: 96, height: 28,
  };
  const off = renderTuiFrame({ ...data, showHelp: false });
  const on = renderTuiFrame({ ...data, showHelp: true });
  assert.equal(off.includes("Help:"), false);
  assert.match(on, /Help:/);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tuiBin = path.join(repoRoot, "packages/polycli-terminal/bin/polycli-tui.mjs");

test("polycli tui smoke mode renders one frame from fixture debug json", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-fixture-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({
      ok: true,
      runs: [{ runId: "run-smoke", commands: ["ask"], startedAt: "now", adoptedCount: 1, skippedCount: 0, failedCount: 0 }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "show-run-smoke.json"), JSON.stringify({
      ok: true,
      runId: "run-smoke",
      events: [
        { runId: "run-smoke", provider: "qwen", phase: "provider_decision", status: "adopted", argv: ["ask", "--provider", "qwen", "<prompt:redacted>"] },
      ],
    }));
    fs.writeFileSync(path.join(fixtureDir, "explain-run-smoke.json"), JSON.stringify({
      ok: true,
      runId: "run-smoke",
      found: true,
      text: "qwen adopted",
      events: [],
    }));

    const result = spawnSync(process.execPath, [tuiBin, "--smoke", "--fixture-dir", fixtureDir, "--run-id", "run-smoke"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /polycli tui inspector/);
    assert.match(result.stdout, /run-smoke/);
    assert.match(result.stdout, /qwen adopted/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

const terminalBin = path.join(repoRoot, "packages/polycli-terminal/bin/polycli.mjs");

test("terminal wrapper routes tui to tui runtime smoke mode", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-wrapper-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({
      ok: true,
      runs: [{ runId: "run-wrapper", commands: ["health"], startedAt: "now", adoptedCount: 0, skippedCount: 1, failedCount: 0 }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "show-run-wrapper.json"), JSON.stringify({
      ok: true,
      runId: "run-wrapper",
      events: [{ runId: "run-wrapper", provider: "pi", phase: "provider_decision", status: "skipped", reason: "health_failed" }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "explain-run-wrapper.json"), JSON.stringify({
      ok: true,
      runId: "run-wrapper",
      found: true,
      text: "pi skipped (health_failed)",
      events: [],
    }));

    const result = spawnSync(process.execPath, [terminalBin, "tui", "--smoke", "--fixture-dir", fixtureDir, "--run-id", "run-wrapper"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /run-wrapper/);
    assert.match(result.stdout, /pi skipped/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});
