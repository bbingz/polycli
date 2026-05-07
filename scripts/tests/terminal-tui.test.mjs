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

test("polycli tui without --smoke and without TTY exits with TTY error", () => {
  const result = spawnSync(process.execPath, [tuiBin], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an interactive TTY/);
});

test("polycli tui smoke mode surfaces fixture failure cleanly", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-bad-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({
      ok: true,
      runs: [{ runId: "run-missing", commands: ["ask"] }],
    }));
    const result = spawnSync(process.execPath, [tuiBin, "--smoke", "--fixture-dir", fixtureDir, "--run-id", "run-missing"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^Error:/m);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("polycli tui --history=1 only renders one run from fixtures", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-history-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({
      ok: true,
      runs: [
        { runId: "run-newer", commands: ["ask"], startedAt: "2026-05-07T00:00:01Z" },
        { runId: "run-older", commands: ["health"], startedAt: "2026-05-07T00:00:00Z" },
      ],
    }));
    fs.writeFileSync(path.join(fixtureDir, "show-run-newer.json"), JSON.stringify({
      ok: true,
      runId: "run-newer",
      events: [{ runId: "run-newer", provider: "qwen", phase: "provider_decision", status: "adopted" }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "explain-run-newer.json"), JSON.stringify({
      ok: true, runId: "run-newer", found: true, text: "qwen adopted", events: [],
    }));
    const result = spawnSync(process.execPath, [tuiBin, "--smoke", "--fixture-dir", fixtureDir, "--history", "1"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /run-newer/);
    assert.equal(result.stdout.includes("run-older"), false, "run-older must not render when --history=1");
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("polycli tui --history=abc rejects non-integer with clear error", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-history-bad-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({ ok: true, runs: [] }));
    const result = spawnSync(process.execPath, [tuiBin, "--smoke", "--fixture-dir", fixtureDir, "--history", "abc"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-negative integer/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("polycli tui --history=-1 rejects negative integer", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-history-neg-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({ ok: true, runs: [] }));
    const result = spawnSync(process.execPath, [tuiBin, "--smoke", "--fixture-dir", fixtureDir, "--history=-1"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-negative integer/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("polycli tui --script-keys down loads selected run's detail, not the initial run's", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-script-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({
      ok: true,
      runs: [
        { runId: "run-a", commands: ["ask"], startedAt: "2026-05-07T00:00:00Z" },
        { runId: "run-b", commands: ["ask"], startedAt: "2026-05-07T00:00:01Z" },
      ],
    }));
    fs.writeFileSync(path.join(fixtureDir, "show-run-a.json"), JSON.stringify({
      ok: true, runId: "run-a",
      events: [{ runId: "run-a", provider: "qwen", phase: "provider_decision", status: "adopted" }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "show-run-b.json"), JSON.stringify({
      ok: true, runId: "run-b",
      events: [{ runId: "run-b", provider: "kimi", phase: "provider_decision", status: "adopted" }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "explain-run-a.json"), JSON.stringify({
      ok: true, runId: "run-a", found: true, text: "qwen adopted", events: [],
    }));
    fs.writeFileSync(path.join(fixtureDir, "explain-run-b.json"), JSON.stringify({
      ok: true, runId: "run-b", found: true, text: "kimi adopted", events: [],
    }));
    const result = spawnSync(
      process.execPath,
      [tuiBin, "--smoke", "--fixture-dir", fixtureDir, "--script-keys", "down"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /kimi adopted/);
    assert.equal(
      result.stdout.includes("qwen adopted"),
      false,
      "after down, frame must not show the previous run's provider",
    );
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

function ptyWrapperAvailable() {
  if (os.platform() === "win32") return false;
  const probe = spawnSync("python3", ["-c", "import pty"], { encoding: "utf8" });
  return probe.status === 0;
}

const PTY_PUMP = `
import os, pty, sys, threading
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
def pump_out():
    try:
        while True:
            data = os.read(fd, 4096)
            if not data: break
            os.write(1, data)
    except OSError: pass
def pump_in():
    try:
        while True:
            data = os.read(0, 4096)
            if not data: break
            os.write(fd, data)
    except OSError: pass
t1 = threading.Thread(target=pump_out, daemon=True)
t2 = threading.Thread(target=pump_in, daemon=True)
t1.start(); t2.start()
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;

test("polycli tui exits cleanly when q is pressed under a real pty", { skip: !ptyWrapperAvailable() }, async () => {
  const { spawn } = await import("node:child_process");
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-pty-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({
      ok: true,
      runs: [{ runId: "run-pty", commands: ["ask"], startedAt: "2026-05-07T00:00:00Z" }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "show-run-pty.json"), JSON.stringify({
      ok: true, runId: "run-pty",
      events: [{ runId: "run-pty", provider: "qwen", phase: "provider_decision", status: "adopted" }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "explain-run-pty.json"), JSON.stringify({
      ok: true, runId: "run-pty", found: true, text: "qwen adopted", events: [],
    }));

    const child = spawn("python3", ["-c", PTY_PUMP, process.execPath, tuiBin, "--fixture-dir", fixtureDir], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    const start = Date.now();
    while (!stdout.includes("polycli tui inspector") && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      stdout.includes("polycli tui inspector"),
      `initial frame missing within 5s\nstdout=${stdout}\nstderr=${stderr}`,
    );

    child.stdin.write("q");

    const exitCode = await Promise.race([
      new Promise((resolve) => child.on("exit", (code) => resolve(code))),
      new Promise((_, reject) => setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error(`polycli tui did not exit within 5s after q\nstdout=${stdout.slice(-400)}\nstderr=${stderr.slice(-400)}`));
      }, 5000)),
    ]);
    assert.equal(exitCode, 0, `exit ${exitCode}\nstdout=${stdout.slice(-400)}\nstderr=${stderr.slice(-400)}`);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("polycli tui --script-keys down,enter shows detail explanation for the new run", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-tui-script-detail-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "runs.json"), JSON.stringify({
      ok: true,
      runs: [
        { runId: "run-a", commands: ["ask"], startedAt: "2026-05-07T00:00:00Z" },
        { runId: "run-b", commands: ["ask"], startedAt: "2026-05-07T00:00:01Z" },
      ],
    }));
    fs.writeFileSync(path.join(fixtureDir, "show-run-a.json"), JSON.stringify({
      ok: true, runId: "run-a",
      events: [{ runId: "run-a", provider: "qwen", phase: "provider_decision", status: "adopted" }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "show-run-b.json"), JSON.stringify({
      ok: true, runId: "run-b",
      events: [{ runId: "run-b", provider: "kimi", phase: "provider_decision", status: "adopted" }],
    }));
    fs.writeFileSync(path.join(fixtureDir, "explain-run-a.json"), JSON.stringify({
      ok: true, runId: "run-a", found: true, text: "EXPL_RUN_A", events: [],
    }));
    fs.writeFileSync(path.join(fixtureDir, "explain-run-b.json"), JSON.stringify({
      ok: true, runId: "run-b", found: true, text: "EXPL_RUN_B", events: [],
    }));
    const result = spawnSync(
      process.execPath,
      [tuiBin, "--smoke", "--fixture-dir", fixtureDir, "--script-keys", "down,enter"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /EXPL_RUN_B/);
    assert.equal(result.stdout.includes("EXPL_RUN_A"), false);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
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
