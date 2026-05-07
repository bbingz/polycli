#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

import { applyKey, renderTuiFrame } from "../lib/tui/view-model.mjs";

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
    process.stdout.write("\n");
  };
  process.once("SIGINT", restoreRawMode);
  process.once("exit", restoreRawMode);

  try {
    let state = {
      ...loadData(options),
      view: "list",
      focusedPane: "runs",
      showHelp: false,
    };
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
              const data = loadData(options);
              state = { ...state, ...data };
              writeFrame();
            } catch (error) {
              process.stdout.write(`\x1b[2J\x1b[HError refreshing: ${error.message}\nPress q to quit.\n`);
            }
            return;
          }
          const keyId = mapKey(str, key);
          if (keyId) {
            state = applyKey(state, keyId);
            writeFrame();
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
  if (options.smoke) {
    process.stdout.write(`${renderOnce(options)}\n`);
  } else {
    await interactive(options);
  }
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
