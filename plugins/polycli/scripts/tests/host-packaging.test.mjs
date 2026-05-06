import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function assertLocalPluginEntry(marketplace, expected) {
  const plugin = marketplace.plugins.find((candidate) => candidate.name === expected.name);
  assert.ok(plugin, `missing marketplace entry for ${expected.name}`);
  if (typeof expected.source === "string") {
    assert.equal(plugin.source, expected.source);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, expected.source)), true);
    return;
  }

  assert.equal(plugin.source?.source, "local");
  assert.equal(plugin.source?.path, expected.path);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, expected.path)), true);
}

function assertNoPluginEntry(marketplace, name) {
  const plugin = marketplace.plugins.find((candidate) => candidate.name === name);
  assert.equal(plugin, undefined, `unexpected marketplace entry for ${name}`);
}

test("host marketplace files exist and are valid JSON", () => {
  const codexMarketplace = readJson(".agents/plugins/marketplace.json");
  const copilotMarketplace = readJson(".github/plugin/marketplace.json");
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json");

  assert.equal(Array.isArray(codexMarketplace.plugins), true);
  assert.equal(Array.isArray(copilotMarketplace.plugins), true);
  assert.equal(Array.isArray(claudeMarketplace.plugins), true);

  assertLocalPluginEntry(codexMarketplace, { name: "polycli-codex", path: "./plugins/polycli-codex" });
  assertLocalPluginEntry(copilotMarketplace, { name: "polycli-copilot", source: "./plugins/polycli-copilot" });
  assertLocalPluginEntry(claudeMarketplace, { name: "polycli", source: "./plugins/polycli" });
  assertNoPluginEntry(claudeMarketplace, "polycli-copilot");
});

test("host plugin manifests exist", () => {
  const codexManifest = readJson("plugins/polycli-codex/.codex-plugin/plugin.json");
  const copilotManifest = readJson("plugins/polycli-copilot/plugin.json");
  const opencodePackage = readJson("plugins/polycli-opencode/package.json");

  assert.equal(codexManifest.name, "polycli-codex");
  assert.equal(copilotManifest.name, "polycli-copilot");
  assert.equal(opencodePackage.name, "@bbingz/polycli-opencode");
});

test("release-facing marketplace versions stay aligned with host manifests", () => {
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
  const copilotMarketplace = readJson(".github/plugin/marketplace.json");
  const claudeManifest = readJson("plugins/polycli/.claude-plugin/plugin.json");
  const copilotManifest = readJson("plugins/polycli-copilot/plugin.json");

  assert.equal(claudeMarketplace.metadata.version, claudeManifest.version);
  assert.equal(copilotMarketplace.metadata.version, copilotManifest.version);

  const claudePlugin = claudeMarketplace.plugins.find((candidate) => candidate.name === "polycli");
  const copilotPlugin = copilotMarketplace.plugins.find((candidate) => candidate.name === "polycli-copilot");

  assert.equal(claudePlugin?.version, claudeManifest.version);
  assertNoPluginEntry(claudeMarketplace, "polycli-copilot");
  assert.equal(copilotPlugin?.version, copilotManifest.version);
});

test("host adapter entry files exist", () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-codex/skills/polycli/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-copilot/skills/polycli/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ".opencode/plugins/polycli.mjs")), true);
});

test("bundled companion entry files exist for all hosts", () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli/scripts/polycli-companion.bundle.mjs")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-codex/scripts/polycli-companion.bundle.mjs")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs")), true);
});

test("bundled companions execute with usage output", () => {
  const bundles = [
    "plugins/polycli/scripts/polycli-companion.bundle.mjs",
    "plugins/polycli-codex/scripts/polycli-companion.bundle.mjs",
    "plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs",
    "plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs",
  ];

  for (const relativePath of bundles) {
    const stdout = execFileSync(process.execPath, [path.join(REPO_ROOT, relativePath)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.match(stdout, /Usage:/);
  }
});

test("opencode adapter exports a plugin function", async () => {
  const moduleUrl = pathToFileURL(path.join(REPO_ROOT, "plugins/polycli-opencode/index.mjs")).href;
  const module = await import(moduleUrl);

  assert.equal(typeof module.PolycliPlugin, "function");
  const plugin = await module.PolycliPlugin();
  assert.equal(typeof plugin, "object");
  assert.equal(typeof plugin.tool.polycli_run.execute, "function");
  assert.equal(typeof plugin.tool.polycli_timing.execute, "function");
});

test("opencode adapter returns structured companion errors from stdout", async () => {
  const moduleUrl = pathToFileURL(path.join(REPO_ROOT, "plugins/polycli-opencode/index.mjs")).href;
  const module = await import(moduleUrl);
  const plugin = await module.PolycliPlugin();

  const output = await plugin.tool.polycli_run.execute({
    argv: ["timing", "--provider", "definitely-not-a-provider", "--json"],
  });
  const payload = JSON.parse(output);

  assert.equal(payload.code, "unknown_provider");
  assert.match(payload.error, /definitely-not-a-provider/);
});

test("opencode package resolves through node package resolution", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-opencode-pkg-"));
  const scopeDir = path.join(tempRoot, "node_modules", "@bbingz");
  const packageDir = path.join(scopeDir, "polycli-opencode");
  fs.mkdirSync(scopeDir, { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "plugins/polycli-opencode"), packageDir, "dir");

  try {
    const stdout = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          "import { PolycliPlugin } from '@bbingz/polycli-opencode';",
          "const plugin = await PolycliPlugin();",
          "const output = await plugin.tool.polycli_timing.execute({ json: true });",
          "console.log(output);",
        ].join("\n"),
      ],
      {
        cwd: tempRoot,
        encoding: "utf8",
      }
    );

    const payload = JSON.parse(stdout);
    assert.ok(Array.isArray(payload.records));
    assert.equal(typeof payload.aggregate, "object");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
