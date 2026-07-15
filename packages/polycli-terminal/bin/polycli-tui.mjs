#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

import { parseArgs as parseRegisteredArgs } from "@bbingz/polycli-utils/args";
import { getTerminalCommandDefinition } from "../lib/command-surface.generated.mjs";
import { applyKey, renderTuiFrame } from "../lib/tui/view-model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companionPath = path.join(__dirname, "polycli-companion.bundle.mjs");

function parseArgs(argv) {
  const definition = getTerminalCommandDefinition(["tui"]);
  const valueOptions = definition.options.filter((entry) => entry.type !== "boolean").map((entry) => entry.name);
  const booleanOptions = definition.options.filter((entry) => entry.type === "boolean").map((entry) => entry.name);
  const aliasMap = Object.fromEntries(
    definition.options.flatMap((entry) => entry.aliases.map((alias) => [alias, entry.name])),
  );
  const parsed = parseRegisteredArgs(argv, {
    valueOptions,
    booleanOptions,
    aliasMap,
    unknownOptionMode: "error",
    rejectDuplicateOptions: true,
  });
  return {
    history: parsed.options.history ?? null,
    runId: parsed.options["run-id"] ?? null,
    smoke: Boolean(parsed.options.smoke),
    fixtureDir: parsed.options["fixture-dir"] ?? null,
    scriptKeys: parseScriptKeys(parsed.options["script-keys"]),
    help: Boolean(parsed.options.help),
  };
}

function renderTuiHelp() {
  const definition = getTerminalCommandDefinition(["tui"]);
  const options = definition.options
    .filter((entry) => entry.visibility !== "internal")
    .map((entry) => `  ${entry.forms.join(", ").padEnd(30)} ${entry.description}`.trimEnd());
  return ["Usage:", `  ${definition.usage}`, "", definition.summary, "", "Options:", ...options].join("\n");
}

function parseScriptKeys(value) {
  if (!value) return [];
  return String(value).split(",").map((token) => token.trim()).filter(Boolean);
}

function parseHistoryArg(value) {
  if (value == null) return null;
  if (!/^\d+$/.test(String(value))) {
    throw new Error("--history must be a non-negative integer.");
  }
  return Number.parseInt(value, 10);
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

function loadRunsIndex(options) {
  const limit = parseHistoryArg(options.history);
  let allRuns;
  if (options.fixtureDir) {
    const runs = readFixtureJson(options.fixtureDir, "runs.json");
    allRuns = runs.runs || [];
  } else {
    const runs = runCompanionJson(["debug", "runs"]);
    allRuns = runs.runs || [];
  }
  return limit == null ? allRuns : allRuns.slice(0, limit);
}

function loadRunDetail(options, runId) {
  if (!runId) return { events: [], explanationText: "" };
  if (options.fixtureDir) {
    const show = readFixtureJson(options.fixtureDir, `show-${runId}.json`);
    const explain = readFixtureJson(options.fixtureDir, `explain-${runId}.json`);
    return { events: show.events || [], explanationText: explain.text || "" };
  }
  const show = runCompanionJson(["debug", "show", runId]);
  const explain = runCompanionJson(["debug", "explain", runId]);
  return { events: show.events || [], explanationText: explain.text || "" };
}

function buildInitialState(options) {
  const runs = loadRunsIndex(options);
  const selectedRunId = options.runId || runs[0]?.runId || null;
  const detail = loadRunDetail(options, selectedRunId);
  return {
    runs,
    selectedRunId,
    events: detail.events,
    explanationText: detail.explanationText,
    view: "list",
    focusedPane: "runs",
    showHelp: false,
  };
}

function dispatchKey(state, keyId, options) {
  const previousRunId = state.selectedRunId;
  const next = applyKey(state, keyId);
  if (next.selectedRunId !== previousRunId && next.selectedRunId) {
    const detail = loadRunDetail(options, next.selectedRunId);
    return { ...next, events: detail.events, explanationText: detail.explanationText };
  }
  return next;
}

function refreshState(state, options) {
  const runs = loadRunsIndex(options);
  const stillExists = runs.some((run) => run.runId === state.selectedRunId);
  const nextSelected = stillExists ? state.selectedRunId : (runs[0]?.runId || null);
  const detail = loadRunDetail(options, nextSelected);
  return {
    ...state,
    runs,
    selectedRunId: nextSelected,
    events: detail.events,
    explanationText: detail.explanationText,
  };
}

function mapKey(str, key) {
  if (key.name === "up" || key.name === "k") return "up";
  if (key.name === "down" || key.name === "j") return "down";
  if (key.name === "return" || key.name === "enter") return "enter";
  if (key.name === "tab") return "tab";
  if (key.name === "b") return "b";
  if (str === "?") return "?";
  return null;
}

async function interactive(options) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("polycli tui requires an interactive TTY. Use debug runs/show/explain for non-interactive output.");
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let restored = false;
  let keypressHandler = null;
  const restoreRawMode = () => {
    if (restored) return;
    restored = true;
    if (keypressHandler) {
      try { process.stdin.removeListener("keypress", keypressHandler); } catch {}
    }
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    try { process.stdin.pause(); } catch {}
    process.stdout.write("\n");
  };
  process.once("SIGINT", restoreRawMode);
  process.once("exit", restoreRawMode);

  try {
    let state = buildInitialState(options);
    const writeFrame = () => {
      const frame = renderTuiFrame({
        ...state,
        width: process.stdout.columns || 100,
        height: process.stdout.rows || 30,
      });
      process.stdout.write("\x1b[2J\x1b[H" + frame);
    };
    writeFrame();

    await new Promise((resolve, reject) => {
      keypressHandler = (str, key = {}) => {
        try {
          if (key.name === "q" || (key.ctrl && key.name === "c")) {
            resolve();
            return;
          }
          if (key.name === "r") {
            try {
              state = refreshState(state, options);
              writeFrame();
            } catch (error) {
              process.stdout.write(`\x1b[2J\x1b[HError refreshing: ${error.message}\nPress q to quit.\n`);
            }
            return;
          }
          const keyId = mapKey(str, key);
          if (keyId) {
            try {
              state = dispatchKey(state, keyId, options);
              writeFrame();
            } catch (error) {
              process.stdout.write(`\x1b[2J\x1b[HError loading run ${state.selectedRunId}: ${error.message}\nPress q to quit.\n`);
            }
          }
        } catch (error) {
          reject(error);
        }
      };
      process.stdin.on("keypress", keypressHandler);
    });
  } finally {
    restoreRawMode();
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${renderTuiHelp()}\n`);
  } else if (options.smoke) {
    let state = buildInitialState(options);
    for (const keyId of options.scriptKeys) {
      state = dispatchKey(state, keyId, options);
    }
    const frame = renderTuiFrame({
      ...state,
      width: process.stdout.columns || 100,
      height: process.stdout.rows || 30,
    });
    process.stdout.write(`${frame}\n`);
  } else {
    await interactive(options);
  }
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
