#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCommandRegistry,
  listCommandDefinitions,
  renderCommandHelp,
  renderRootHelp,
} from "../plugins/polycli/scripts/lib/command-registry.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SHARED_HOST_SURFACES = Object.freeze([
  "claude-plugin",
  "codex-skill",
  "copilot-skill",
  "opencode-plugin",
  "terminal",
]);

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSetEqual(actual, expected, label) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${label} must expose exactly: ${[...expected].join(", ")}`
  );
}

export function deriveSharedCommandDefinitions() {
  return listCommandDefinitions({ hostSurface: "claude-plugin", topLevelOnly: true })
    .filter((entry) => SHARED_HOST_SURFACES.every((surface) => entry.surfaces.includes(surface)))
    .sort((left, right) => left.path[0].localeCompare(right.path[0]));
}

export function deriveSharedCommandNames() {
  return deriveSharedCommandDefinitions().map((entry) => entry.path[0]);
}

function parseClaudeCommands() {
  const dir = path.join(REPO_ROOT, "plugins/polycli/commands");
  return new Set(
    fs.readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -".md".length))
  );
}

function parseSkillCommands(relativePath) {
  const text = read(relativePath);
  const inventory = text.match(/Supported subcommands:\s*\n(?<body>[\s\S]*?)\nRules:/)?.groups?.body;
  assert.ok(inventory, `${relativePath} must contain a Supported subcommands inventory followed by Rules`);

  const commands = new Set();
  for (const match of inventory.matchAll(/^- `([a-z-]+)(?:\s|`)/gm)) {
    commands.add(match[1]);
  }
  return commands;
}

function parseHostMapCommands() {
  const lines = read("docs/host-command-map.md").split("\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("| capability"));
  assert.notEqual(headerIndex, -1, "host-command-map missing command mapping table");

  const commands = new Set();
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    const command = line.split("|")[1]?.trim();
    if (command) commands.add(command);
  }
  return commands;
}

function assertHostCommandMap(expectedCommands) {
  const text = read("docs/host-command-map.md");
  assertSetEqual(parseHostMapCommands(), expectedCommands, "host-command-map command rows");

  for (const command of expectedCommands) {
    assert.match(text, new RegExp(`/polycli:${escapeRegExp(command)}\\b`), `host-command-map missing Claude invocation for ${command}`);
    assert.match(
      text,
      new RegExp(`Choose Polycli with @, then ask it to run: ${escapeRegExp(command)}\\b`),
      `host-command-map missing Codex skill invocation for ${command}`
    );
    assert.match(text, new RegExp(`polycli ${escapeRegExp(command)}\\b`), `host-command-map missing Copilot invocation for ${command}`);
    const row = text.split("\n").find((line) => line.startsWith(`| ${command}`));
    assert.ok(row, `host-command-map missing row for ${command}`);
    const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);
    assert.match(
      cells.at(-1) ?? "",
      new RegExp("^`polycli " + escapeRegExp(command) + "(?:\\b|\\s|\\.\\.\\.)"),
      `host-command-map missing Terminal CLI invocation for ${command}`
    );
  }

  assert.doesNotMatch(text, /\/polycli-codex:polycli\b/, "host-command-map must not document fake Codex slash invocation");
  assert.match(text, /polycli_run\(\["timing"/, "host-command-map missing OpenCode generic timing invocation");
  assert.match(text, /polycli_timing/, "host-command-map missing OpenCode timing wrapper");
  assert.match(text, /Terminal CLI/, "host-command-map missing Terminal CLI column");
  assert.match(text, /@bbingz\/polycli/, "host-command-map missing terminal package name");
  assert.match(text, /\| Terminal CLI\s+\| `polycli health`\s+\|/, "host-command-map side-by-side examples missing Terminal CLI health row");
  assert.match(text, /\| Terminal CLI\s+\| `polycli ask --provider qwen "Reply with only: OK"`\s+\|/, "host-command-map side-by-side examples missing Terminal CLI ask row");
  assert.match(text, /\| Terminal CLI\s+\| `polycli review --provider claude --scope staged --background`/, "host-command-map side-by-side examples missing Terminal CLI background row");
  assert.match(text, /\| Terminal CLI\s+\| `polycli timing --provider qwen --history 20 --json`\s+\|/, "host-command-map side-by-side examples missing Terminal CLI timing row");
  assert.match(text, /`polycli tui` is terminal-only/, "host-command-map must document terminal-only tui command");
}

function assertOpenCodeSurface(expectedCommands, internalCommands) {
  const source = read("plugins/polycli-opencode/index.mjs");
  assert.match(source, /polycli_run/, "OpenCode plugin must expose polycli_run");
  assert.match(source, /polycli_timing/, "OpenCode plugin must expose polycli_timing");
  for (const command of expectedCommands) {
    assert.match(source, new RegExp(`\\b${escapeRegExp(command)}\\b`), `OpenCode plugin description must mention ${command}`);
  }
  for (const command of internalCommands) {
    assert.doesNotMatch(source, new RegExp(escapeRegExp(command)), `OpenCode plugin must not expose internal command ${command}`);
  }
}

function assertRegistrySurfaceRules(expectedCommands) {
  const terminalCommands = new Set(
    listCommandDefinitions({ hostSurface: "terminal", topLevelOnly: true }).map((entry) => entry.path[0])
  );
  assert.ok(terminalCommands.has("tui"), "terminal surface must include tui");
  assert.ok(!expectedCommands.includes("tui"), "shared host surface must not include terminal-only tui");

  for (const surface of SHARED_HOST_SURFACES) {
    const rootHelp = renderRootHelp({ hostSurface: surface });
    for (const definition of deriveSharedCommandDefinitions()) {
      assert.match(rootHelp, new RegExp(`\\b${escapeRegExp(definition.path[0])}\\b`), `${surface} root help missing ${definition.path[0]}`);
    }
    assert.doesNotMatch(rootHelp, /_job-worker|_stop-review-gate/, `${surface} root help leaks internal commands`);
    if (surface !== "terminal") assert.doesNotMatch(rootHelp, /^\s*tui\b/m, `${surface} root help leaks terminal-only tui`);
  }

  for (const definition of listCommandDefinitions()) {
    const commandHelp = renderCommandHelp(definition);
    assert.match(commandHelp, new RegExp(escapeRegExp(definition.usage)), `${definition.id} help missing canonical usage`);
    assert.match(commandHelp, new RegExp(escapeRegExp(definition.summary)), `${definition.id} help missing canonical summary`);
  }
}

function assertCompanionBindingsAndRootHelp(expectedCommands) {
  const companionPath = path.join(REPO_ROOT, "plugins/polycli/scripts/polycli-companion.mjs");
  const result = spawnSync(process.execPath, [companionPath, "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      POLYCLI_HOST_SURFACE: "unknown",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "companion --help failed");
  for (const command of expectedCommands) {
    assert.match(result.stdout, new RegExp(`\\b${escapeRegExp(command)}\\b`), `companion root help missing ${command}`);
  }
  assert.doesNotMatch(result.stdout, /_job-worker|_stop-review-gate/, "companion root help leaks internal commands");
  assert.doesNotMatch(result.stdout, /^\s*tui\b/m, "companion shared root help leaks terminal-only tui");
}

export function validateHostCommandMap() {
  assertCommandRegistry();
  const expectedCommands = deriveSharedCommandNames();
  const internalCommands = listCommandDefinitions({ includeInternal: true, topLevelOnly: true })
    .filter((entry) => entry.visibility === "internal")
    .map((entry) => entry.path[0]);

  assertCompanionBindingsAndRootHelp(expectedCommands);
  assertSetEqual(parseClaudeCommands(), expectedCommands, "Claude command files");
  assertSetEqual(parseSkillCommands("plugins/polycli-codex/skills/polycli/SKILL.md"), expectedCommands, "Codex skill supported subcommands");
  assertSetEqual(parseSkillCommands("plugins/polycli-copilot/skills/polycli/SKILL.md"), expectedCommands, "Copilot skill supported subcommands");
  assertOpenCodeSurface(expectedCommands, internalCommands);
  assertHostCommandMap(expectedCommands);
  assertRegistrySurfaceRules(expectedCommands);
  return expectedCommands;
}

function main() {
  const commands = validateHostCommandMap();
  console.log(`host command map ok: ${commands.length} capabilities across 4 host adapters + Terminal CLI`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
