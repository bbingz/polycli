# TUI Inspector MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `polycli tui` inspector that renders run-ledger/debug data as navigable terminal panes.

**Architecture:** The terminal wrapper routes `polycli tui` to a terminal-package-owned TUI module. The TUI consumes existing companion debug commands (`debug runs/show/explain --json`) and uses a pure view-model layer for classification/layout so tests can verify behavior without an interactive terminal.

**Tech Stack:** Node.js >=20 ESM, built-in `readline`, ANSI terminal sequences, existing `node --test`, existing package/build/release validation.

---

## File Structure

- Create `packages/polycli-terminal/lib/tui/view-model.mjs`
  - Pure functions for state classification, reproduction command formatting, truncation, pane layout, and render frame construction.
- Create `packages/polycli-terminal/bin/polycli-tui.mjs`
  - Terminal runtime, keyboard loop, companion debug command calls, one-frame smoke mode.
- Modify `packages/polycli-terminal/bin/polycli.mjs`
  - Route `tui` to `polycli-tui.mjs`; delegate all other commands to the companion as today.
- Modify `packages/polycli-terminal/package.json`
  - Include `bin/polycli-tui.mjs` and `lib/**/*.mjs` in `files`.
- Create `scripts/tests/terminal-tui.test.mjs`
  - Unit and smoke tests for the TUI view model and terminal command routing.
- Modify `scripts/tests/open-source-packaging.test.mjs`
  - Assert the terminal package tarball includes TUI files.
- Modify `docs/host-command-map.md`
  - Add terminal-only `tui` row or note without claiming host plugin slash support.
- Modify `docs/polycli-v1-public-surface.md`
  - Document `polycli tui` as read-only terminal surface.
- Modify `packages/polycli-terminal/README.md`
  - Add concise TUI usage.
- Modify `tasks/terminal-cli-tui-observability.md`
  - Mark the TUI MVP task complete when implementation lands; leave killed-worker recovery open.
- Modify generated bundles only if the companion command surface changes. This plan keeps `tui` terminal-owned, so companion bundles should not need changes.

## Task 1: Add View-Model Tests First

**Files:**
- Create: `scripts/tests/terminal-tui.test.mjs`
- Create: `packages/polycli-terminal/lib/tui/view-model.mjs`

- [ ] **Step 1: Write failing classification tests**

Add this initial test file:

```js
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
```

- [ ] **Step 2: Create the empty module so the test fails on missing exports**

Create `packages/polycli-terminal/lib/tui/view-model.mjs` with:

```js
// View-model functions are added task by task.
```

- [ ] **Step 3: Run tests to confirm failure**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs
```

Expected: FAIL with missing named exports from `view-model.mjs`.

- [ ] **Step 4: Commit the failing test**

```bash
git add scripts/tests/terminal-tui.test.mjs packages/polycli-terminal/lib/tui/view-model.mjs
git commit -m "test: add tui view model expectations"
```

## Task 2: Implement Provider State Classification

**Files:**
- Modify: `packages/polycli-terminal/lib/tui/view-model.mjs`
- Test: `scripts/tests/terminal-tui.test.mjs`

- [ ] **Step 1: Implement classification and formatting helpers**

Replace `view-model.mjs` with:

```js
const TERMINAL_DECISION_STATUSES = new Set(["adopted", "failed", "skipped", "cancelled"]);
const TERMINAL_ATTEMPT_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function truncateMiddle(value, width) {
  const text = String(value ?? "");
  if (!Number.isFinite(width) || width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return ".".repeat(width);
  const left = Math.ceil((width - 3) / 2);
  const right = Math.floor((width - 3) / 2);
  return `${text.slice(0, left)}...${text.slice(text.length - right)}`;
}

function shellQuote(token) {
  const text = String(token);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function formatReproductionCommand(argv = []) {
  if (!Array.isArray(argv) || argv.length === 0) return "not recorded";
  return ["polycli", ...argv].map(shellQuote).join(" ");
}

function emptyState(provider) {
  return {
    provider,
    status: "unknown",
    reason: null,
    jobId: null,
    logFile: null,
    model: null,
    timingRef: null,
    preview: null,
    lastEventAt: null,
  };
}

function mergeEvent(state, event) {
  return {
    ...state,
    jobId: event.jobId ?? state.jobId,
    logFile: event.logFile ?? state.logFile,
    model: event.model ?? state.model,
    timingRef: event.timingRef ?? state.timingRef,
    preview: event.preview ?? state.preview,
    lastEventAt: event.at ?? state.lastEventAt,
  };
}

export function classifyProviderStates(events = []) {
  const states = {};
  const hasTerminal = new Set();
  const hasStarted = new Set();

  for (const event of events) {
    if (!event?.provider) continue;
    const provider = event.provider;
    states[provider] = mergeEvent(states[provider] || emptyState(provider), event);

    if (event.phase === "provider_decision" && TERMINAL_DECISION_STATUSES.has(event.status)) {
      hasTerminal.add(provider);
      states[provider] = {
        ...states[provider],
        status: event.status,
        reason: event.reason ?? null,
      };
      continue;
    }

    if (event.phase === "attempt_result" && TERMINAL_ATTEMPT_STATUSES.has(event.status)) {
      hasTerminal.add(provider);
      states[provider] = {
        ...states[provider],
        status: event.status === "completed" ? "completed" : event.status,
        reason: event.reason ?? states[provider].reason,
      };
      continue;
    }

    if (event.phase === "job_started" || event.phase === "attempt_started") {
      hasStarted.add(provider);
    }
  }

  for (const provider of hasStarted) {
    if (!hasTerminal.has(provider)) {
      states[provider] = {
        ...(states[provider] || emptyState(provider)),
        status: "unfinished",
      };
    }
  }

  return states;
}
```

- [ ] **Step 2: Run view-model tests**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs
```

Expected: PASS for the first four tests.

- [ ] **Step 3: Commit**

```bash
git add packages/polycli-terminal/lib/tui/view-model.mjs scripts/tests/terminal-tui.test.mjs
git commit -m "feat: classify tui provider states"
```

## Task 3: Add Layout And Frame Rendering Tests

**Files:**
- Modify: `scripts/tests/terminal-tui.test.mjs`
- Modify: `packages/polycli-terminal/lib/tui/view-model.mjs`

- [ ] **Step 1: Add failing render tests**

Append to `scripts/tests/terminal-tui.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs
```

Expected: FAIL with missing `buildTuiModel` and `renderTuiFrame`.

- [ ] **Step 3: Implement layout/model rendering**

Append these exports to `view-model.mjs`:

```js
function line(width, char = "-") {
  return char.repeat(Math.max(0, width));
}

function fit(value, width) {
  return truncateMiddle(value, width).padEnd(Math.max(0, width), " ");
}

function layoutMode(width, height) {
  if (width < 60 || height < 18) return "compact";
  if (width < 100) return "medium";
  return "wide";
}

function eventLabel(event) {
  return [
    event.at ? String(event.at).slice(11, 19) : "--:--:--",
    event.provider || event.command || "run",
    event.phase || "event",
    event.status || "",
    event.reason ? `(${event.reason})` : "",
  ].filter(Boolean).join(" ");
}

export function buildTuiModel({
  runs = [],
  events = [],
  explanationText = "",
  selectedRunId = null,
  width = 100,
  height = 30,
} = {}) {
  const selected = selectedRunId || runs[0]?.runId || null;
  const selectedEvents = selected ? events.filter((event) => event.runId === selected) : [];
  const providers = classifyProviderStates(selectedEvents);
  const reproductionCommands = [...new Set(
    selectedEvents
      .filter((event) => Array.isArray(event.argv) && event.argv.length > 0)
      .map((event) => formatReproductionCommand(event.argv)),
  )];

  return {
    mode: layoutMode(width, height),
    width,
    height,
    selectedRunId: selected,
    runs,
    events: selectedEvents,
    providers,
    explanationText,
    reproductionCommands,
  };
}

export function renderTuiFrame(input = {}) {
  const model = buildTuiModel(input);
  const width = Math.max(40, model.width);
  const bodyHeight = Math.max(8, model.height - 3);
  const lines = [];

  lines.push(fit("polycli tui inspector", width));
  lines.push(line(width));

  if (model.mode === "compact") {
    lines.push(fit(`run ${model.selectedRunId || "none"}`, width));
  } else {
    lines.push(fit("runs", Math.floor(width / 3)) + fit("provider matrix", width - Math.floor(width / 3)));
  }

  for (const run of model.runs.slice(0, Math.max(2, Math.floor(bodyHeight / 4)))) {
    const marker = run.runId === model.selectedRunId ? ">" : " ";
    lines.push(fit(`${marker} ${run.runId} ${(run.commands || []).join(",")}`, width));
  }

  lines.push(line(width));
  for (const state of Object.values(model.providers).slice(0, 8)) {
    lines.push(fit(`${state.provider} ${state.status}${state.reason ? ` ${state.reason}` : ""}${state.jobId ? ` ${state.jobId}` : ""}`, width));
  }

  lines.push(line(width));
  for (const event of model.events.slice(0, Math.max(3, Math.floor(bodyHeight / 3)))) {
    lines.push(fit(eventLabel(event), width));
  }

  if (model.reproductionCommands.length > 0) {
    lines.push(line(width));
    lines.push(fit(`repro: ${model.reproductionCommands[0]}`, width));
  }

  while (lines.length < model.height - 1) lines.push("");
  lines.push(fit("q quit  up/down select  enter open  b back  r refresh  tab pane  ? help", width));
  return lines.slice(0, model.height).join("\n");
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/polycli-terminal/lib/tui/view-model.mjs scripts/tests/terminal-tui.test.mjs
git commit -m "feat: render tui view model frames"
```

## Task 4: Add Terminal TUI Runtime

**Files:**
- Create: `packages/polycli-terminal/bin/polycli-tui.mjs`
- Modify: `scripts/tests/terminal-tui.test.mjs`

- [ ] **Step 1: Add smoke runtime test**

Append to `scripts/tests/terminal-tui.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to confirm failure**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs
```

Expected: FAIL because `polycli-tui.mjs` does not exist.

- [ ] **Step 3: Implement smoke-capable runtime**

Create `packages/polycli-terminal/bin/polycli-tui.mjs`:

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

import { renderTuiFrame } from "../lib/tui/view-model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companionPath = path.join(__dirname, "polycli-companion.bundle.mjs");

function parseArgs(argv) {
  const options = { history: null, runId: null, smoke: false, fixtureDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-id") options.runId = argv[++i] || null;
    else if (arg.startsWith("--run-id=")) options.runId = arg.slice("--run-id=".length);
    else if (arg === "--history") options.history = argv[++i] || null;
    else if (arg.startsWith("--history=")) options.history = arg.slice("--history=".length);
    else if (arg === "--smoke") options.smoke = true;
    else if (arg === "--fixture-dir") options.fixtureDir = argv[++i] || null;
    else throw new Error(`Unknown tui option: ${arg}`);
  }
  return options;
}

function readFixtureJson(fixtureDir, name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8"));
}

function runCompanionJson(args) {
  const result = spawnSync(process.execPath, [companionPath, ...args, "--json"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `companion exited ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function loadData(options) {
  if (options.fixtureDir) {
    const runs = readFixtureJson(options.fixtureDir, "runs.json");
    const selectedRunId = options.runId || runs.runs?.[0]?.runId || null;
    const show = selectedRunId
      ? readFixtureJson(options.fixtureDir, `show-${selectedRunId}.json`)
      : { events: [] };
    const explain = selectedRunId
      ? readFixtureJson(options.fixtureDir, `explain-${selectedRunId}.json`)
      : { text: "" };
    return { runs: runs.runs || [], selectedRunId, events: show.events || [], explanationText: explain.text || "" };
  }

  const runsArgs = ["debug", "runs"];
  if (options.history) runsArgs.push("--history", options.history);
  const runs = runCompanionJson(runsArgs);
  const selectedRunId = options.runId || runs.runs?.[0]?.runId || null;
  const show = selectedRunId ? runCompanionJson(["debug", "show", selectedRunId]) : { events: [] };
  const explain = selectedRunId ? runCompanionJson(["debug", "explain", selectedRunId]) : { text: "" };
  return { runs: runs.runs || [], selectedRunId, events: show.events || [], explanationText: explain.text || "" };
}

function renderOnce(options) {
  const data = loadData(options);
  return renderTuiFrame({
    ...data,
    width: process.stdout.columns || 100,
    height: process.stdout.rows || 30,
  });
}

async function interactive(options) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("polycli tui requires an interactive TTY. Use debug runs/show/explain for non-interactive output.");
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  let frame = renderOnce(options);
  process.stdout.write("\x1b[2J\x1b[H" + frame);

  await new Promise((resolve) => {
    process.stdin.on("keypress", (_str, key = {}) => {
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        resolve();
        return;
      }
      if (key.name === "r") {
        frame = renderOnce(options);
        process.stdout.write("\x1b[2J\x1b[H" + frame);
      }
    });
  });

  process.stdin.setRawMode(false);
  process.stdout.write("\n");
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.smoke) {
    process.stdout.write(`${renderOnce(options)}\n`);
  } else {
    await interactive(options);
  }
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 4: Run smoke tests**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/polycli-terminal/bin/polycli-tui.mjs scripts/tests/terminal-tui.test.mjs
git commit -m "feat: add tui terminal runtime"
```

## Task 5: Route `polycli tui` Through Terminal Wrapper

**Files:**
- Modify: `packages/polycli-terminal/bin/polycli.mjs`
- Modify: `scripts/tests/terminal-tui.test.mjs`

- [ ] **Step 1: Read existing wrapper**

Run:

```bash
sed -n '1,220p' packages/polycli-terminal/bin/polycli.mjs
```

Expected: wrapper currently delegates all args to the companion bundle.

- [ ] **Step 2: Add routing test**

Append to `scripts/tests/terminal-tui.test.mjs`:

```js
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
```

- [ ] **Step 3: Run test to confirm failure**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs
```

Expected: FAIL because wrapper still delegates `tui` to companion.

- [ ] **Step 4: Implement wrapper routing**

Modify `packages/polycli-terminal/bin/polycli.mjs` so the command selection has this shape:

```js
const args = process.argv.slice(2);
const command = args[0];
const target = command === "tui"
  ? path.join(__dirname, "polycli-tui.mjs")
  : companionPath;
const forwardedArgs = command === "tui" ? args.slice(1) : args;

const child = spawn(process.execPath, [target, ...forwardedArgs], {
  stdio: "inherit",
  env: {
    ...process.env,
    POLYCLI_HOST_SURFACE: process.env.POLYCLI_HOST_SURFACE || "terminal",
  },
});
```

Preserve existing signal/exit-code handling from the wrapper.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/polycli-terminal/bin/polycli.mjs scripts/tests/terminal-tui.test.mjs
git commit -m "feat: route terminal tui command"
```

## Task 6: Package And Public Surface Docs

**Files:**
- Modify: `packages/polycli-terminal/package.json`
- Modify: `scripts/tests/open-source-packaging.test.mjs`
- Modify: `packages/polycli-terminal/README.md`
- Modify: `docs/host-command-map.md`
- Modify: `docs/polycli-v1-public-surface.md`
- Modify: `tasks/terminal-cli-tui-observability.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update terminal package files**

Update `packages/polycli-terminal/package.json`:

```json
"files": [
  "bin/polycli.mjs",
  "bin/polycli-tui.mjs",
  "bin/polycli-companion.bundle.mjs",
  "lib/**/*.mjs",
  "README.md",
  "LICENSE"
]
```

- [ ] **Step 2: Add packaging assertion**

In `scripts/tests/open-source-packaging.test.mjs`, extend the terminal package tarball assertion so `npm pack ./packages/polycli-terminal --dry-run --json` must include:

```text
bin/polycli-tui.mjs
lib/tui/view-model.mjs
```

Use the existing tarball file-list helper in that test file rather than shelling out a second time.

- [ ] **Step 3: Document terminal usage**

Add concise text to `packages/polycli-terminal/README.md`:

    ### TUI inspector

    ```bash
    polycli tui
    polycli tui --run-id run_abc123
    ```

    The TUI is read-only. It renders recent run-ledger data from the same debug commands used by `polycli debug runs/show/explain`. Jobs with `started` or `attempt_started` but no terminal result are shown as `unfinished` / `unknown`.

- [ ] **Step 4: Update command surface docs**

In `docs/host-command-map.md`, add a terminal-only note:

```markdown
`polycli tui` is terminal-only. Host plugins continue to use `debug runs/show/explain`; no Claude/Codex/Copilot/OpenCode command is added for the TUI.
```

In `docs/polycli-v1-public-surface.md`, add:

```markdown
### `polycli tui`

Read-only terminal inspector over run-ledger data. Supports `--run-id <id>` and `--history <count>`. It does not run, cancel, retry, or mutate provider jobs.
```

- [ ] **Step 5: Update task/changelog**

In `tasks/terminal-cli-tui-observability.md`, mark the first TUI item complete only after tests pass:

```markdown
- [x] First TUI must render started/attempt_started-without-final-event as unfinished/unknown; recovery remains follow-up.
```

Add a top CHANGELOG entry:

```markdown
## 2026-05-07 — Claude — TUI inspector MVP

- Added terminal-only `polycli tui` as a read-only inspector over existing debug/run-ledger data.
- Renders run list, provider states, event timeline, detail/reproduction command panel, and explicit `unfinished` / `unknown` states for non-terminal background jobs.
- No provider execution, retry, cancel, daemon, watch mode, full log viewer, version bump, tag, or publish in this slice.
```

- [ ] **Step 6: Run docs/package tests**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs scripts/tests/open-source-packaging.test.mjs
git diff --check
```

Expected: PASS and no whitespace issues.

- [ ] **Step 7: Commit**

```bash
git add packages/polycli-terminal/package.json packages/polycli-terminal/README.md scripts/tests/open-source-packaging.test.mjs docs/host-command-map.md docs/polycli-v1-public-surface.md tasks/terminal-cli-tui-observability.md CHANGELOG.md
git commit -m "docs: document terminal tui surface"
```

## Task 7: Final Verification

**Files:**
- No new source files unless verification exposes a bug.

- [ ] **Step 1: Run focused TUI and packaging tests**

Run:

```bash
node --test scripts/tests/terminal-tui.test.mjs scripts/tests/open-source-packaging.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass. Note that `npm test` rebuilds plugin bundles first.

- [ ] **Step 3: Run release gate**

Run:

```bash
npm run release:check
```

Expected: release gate passes, including terminal npm pack dry-run with TUI files present.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: only intentional TUI commits are ahead of `origin/main`.

- [ ] **Step 5: Report**

Report:

```text
Changed files:
Tests first failed:
Final verification:
Deviations:
Remaining open work:
```

Do not push, tag, bump version, publish npm packages, or edit GitHub releases unless the user explicitly starts release prep.
