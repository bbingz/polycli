#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CODEX_MANIFEST = "plugins/polycli-codex/.codex-plugin/plugin.json";
const CODEX_SKILL = "plugins/polycli-codex/skills/polycli/SKILL.md";
const CODEX_README = "plugins/polycli-codex/README.md";
const ROOT_README = "README.md";
const HOST_COMMAND_MAP = "docs/host-command-map.md";
const PROVIDERS = ["claude", "copilot", "opencode", "pi", "gemini", "kimi", "qwen", "minimax"];
const OBSERVABILITY_COMMANDS = ["health", "status", "result", "timing"];
const DAILY_COMMANDS = ["health", "ask", "review", "timing"];

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(read(root, relativePath));
}

function lower(text) {
  return String(text).toLowerCase();
}

function assertIncludes(text, expected, label) {
  assert.match(lower(text), new RegExp(`\\b${expected}\\b`), `${label} must mention ${expected}`);
}

function assertProviderTriggers(text, label) {
  for (const provider of PROVIDERS) {
    assertIncludes(text, provider, `${label} provider triggers`);
  }
}

function assertPrefersPolycli(text, label) {
  const normalized = lower(text);
  assert.match(normalized, /\bprefer\b/, `${label} must tell Codex to prefer polycli`);
  assert.match(normalized, /\bpolycli\b/, `${label} must tell Codex to prefer polycli`);
  assert.match(
    normalized,
    /\b(direct|raw|official)\b[\s\S]{0,120}\b(cli|clis|shell)\b/,
    `${label} must name direct/raw official CLI shell calls as the fallback path`
  );
  assert.match(
    normalized,
    /\b(explicit|unavailable|not installed|missing)\b/,
    `${label} must constrain raw CLI fallback to explicit user intent or unavailable plugin state`
  );
}

function assertObservability(text, label) {
  for (const command of OBSERVABILITY_COMMANDS) {
    assertIncludes(text, command, `${label} observability`);
  }
}

function assertCodexSlashExamples(text, label) {
  for (const command of DAILY_COMMANDS) {
    assert.match(
      text,
      new RegExp(`/polycli-codex:polycli ${command}\\b`),
      `${label} must include Codex slash example for ${command}`
    );
  }
}

function assertDefaultPrompts(manifest) {
  const prompts = manifest.interface?.defaultPrompt;
  assert.equal(Array.isArray(prompts), true, "Codex defaultPrompt must be an array");
  assert.ok(prompts.length >= 3, "Codex defaultPrompt must include health, ask, and timing examples");
  assert.match(prompts.join("\n"), /\/polycli-codex:polycli health\b/, "Codex defaultPrompt must use slash health");
  assert.match(prompts.join("\n"), /\/polycli-codex:polycli ask\b/, "Codex defaultPrompt must use slash ask");
  assert.match(prompts.join("\n"), /\/polycli-codex:polycli timing\b/, "Codex defaultPrompt must use slash timing");
  assert.doesNotMatch(prompts[0], /\bsetup\b/, "Codex defaultPrompt must not make setup the first-run default");
}

function assertSkillDescription(skillText) {
  const match = skillText.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, "Codex skill must have YAML front matter");
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1] ?? "";
  assert.ok(description.trim().length > 0, "Codex skill description must be non-empty");
  assertProviderTriggers(description, "Codex skill description");
  assertPrefersPolycli(description, "Codex skill description");
}

export function validateCodexAdapter({ root = REPO_ROOT } = {}) {
  const manifest = readJson(root, CODEX_MANIFEST);
  const skill = read(root, CODEX_SKILL);
  const codexReadme = read(root, CODEX_README);
  const rootReadme = read(root, ROOT_README);
  const hostCommandMap = read(root, HOST_COMMAND_MAP);

  assertDefaultPrompts(manifest);
  assertProviderTriggers(manifest.interface?.longDescription ?? "", "Codex manifest longDescription");
  assertPrefersPolycli(manifest.interface?.longDescription ?? "", "Codex manifest longDescription");
  assertObservability(manifest.interface?.longDescription ?? "", "Codex manifest longDescription");

  assertSkillDescription(skill);
  assertPrefersPolycli(skill, "Codex skill body");
  assertObservability(skill, "Codex skill body");

  for (const [text, label] of [
    [codexReadme, CODEX_README],
    [rootReadme, ROOT_README],
    [hostCommandMap, HOST_COMMAND_MAP],
  ]) {
    assertCodexSlashExamples(text, label);
    assertPrefersPolycli(text, label);
    assertObservability(text, label);
  }

  return {
    ok: true,
    checked: [CODEX_MANIFEST, CODEX_SKILL, CODEX_README, ROOT_README, HOST_COMMAND_MAP],
  };
}

function main() {
  const result = validateCodexAdapter();
  console.log(`codex adapter ok: ${result.checked.length} files checked`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
