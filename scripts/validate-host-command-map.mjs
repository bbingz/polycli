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
    assert.match(text, new RegExp(`/polycli-codex:polycli ${command}\\b`), `host-command-map missing Codex invocation for ${command}`);
    assert.match(text, new RegExp(`polycli ${command}\\b`), `host-command-map missing Copilot invocation for ${command}`);
  }
  assert.match(text, /polycli_run\(\["timing"/, "host-command-map missing OpenCode generic timing invocation");
  assert.match(text, /polycli_timing/, "host-command-map missing OpenCode timing wrapper");
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

console.log(`host command map ok: ${EXPECTED_COMMANDS.length} capabilities across 4 hosts`);
