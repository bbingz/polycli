#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED_COMMANDS = [
  "setup",
  "health",
  "ask",
  "rescue",
  "review",
  "adversarial-review",
  "status",
  "result",
  "cancel",
  "timing",
  "debug",
  "sessions",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assertSetEqual(actual, expected, label) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${label} must expose exactly: ${expected.join(", ")}`
  );
}

function parseCompanionCommands() {
  const source = read("plugins/polycli/scripts/polycli-companion.mjs");
  const commands = new Set();
  for (const match of source.matchAll(/if \(command === "([^"]+)"\)/g)) {
    const command = match[1];
    if (!command.startsWith("_")) commands.add(command);
  }
  return commands;
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
  const commands = new Set();
  for (const match of text.matchAll(/^- `([a-z-]+)(?:\s|`)/gm)) {
    commands.add(match[1]);
  }
  return commands;
}

function assertHostCommandMap() {
  const text = read("docs/host-command-map.md");
  for (const command of EXPECTED_COMMANDS) {
    assert.match(text, new RegExp(`\\| ${command.replaceAll("-", "\\-")}\\s+\\|`), `host-command-map missing row for ${command}`);
    assert.match(text, new RegExp(`/polycli:${command}\\b`), `host-command-map missing Claude invocation for ${command}`);
    assert.match(
      text,
      new RegExp(`Choose Polycli with @, then ask it to run: ${command}\\b`),
      `host-command-map missing Codex skill invocation for ${command}`
    );
    assert.match(text, new RegExp(`polycli ${command}\\b`), `host-command-map missing Copilot invocation for ${command}`);
    const row = text.split("\n").find((line) => line.startsWith(`| ${command}`));
    assert.ok(row, `host-command-map missing row for ${command}`);
    const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);
    assert.match(cells.at(-1) ?? "", new RegExp(`^\`polycli ${command}(?:\\b|\\s|\\.\\.\\.)`), `host-command-map missing Terminal CLI invocation for ${command}`);
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

function assertOpenCodeSurface() {
  const source = read("plugins/polycli-opencode/index.mjs");
  assert.match(source, /polycli_run/, "OpenCode plugin must expose polycli_run");
  assert.match(source, /polycli_timing/, "OpenCode plugin must expose polycli_timing");
  for (const command of EXPECTED_COMMANDS) {
    assert.match(source, new RegExp(`\\b${command}\\b`), `OpenCode plugin description must mention ${command}`);
  }
}

assertSetEqual(parseCompanionCommands(), EXPECTED_COMMANDS, "companion command dispatcher");
assertSetEqual(parseClaudeCommands(), EXPECTED_COMMANDS, "Claude command files");
assertSetEqual(parseSkillCommands("plugins/polycli-codex/skills/polycli/SKILL.md"), EXPECTED_COMMANDS, "Codex skill supported subcommands");
assertSetEqual(parseSkillCommands("plugins/polycli-copilot/skills/polycli/SKILL.md"), EXPECTED_COMMANDS, "Copilot skill supported subcommands");
assertOpenCodeSurface();
assertHostCommandMap();

console.log(`host command map ok: ${EXPECTED_COMMANDS.length} capabilities across 4 host adapters + Terminal CLI`);
