import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function assertPluginEntry(marketplace, expected) {
  const plugin = marketplace.plugins.find((candidate) => candidate.name === expected.name);
  assert.ok(plugin, `missing marketplace entry for ${expected.name}`);
  if (expected.path) {
    assert.equal(plugin.source?.path ?? plugin.source, expected.path);
  }
  if (expected.version) {
    assert.equal(plugin.version, expected.version);
  }
}

const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
const copilotMarketplace = readJson(".github/plugin/marketplace.json");
const codexManifest = readJson("plugins/polycli-codex/.codex-plugin/plugin.json");
const claudeManifest = readJson("plugins/polycli/.claude-plugin/plugin.json");
const copilotManifest = readJson("plugins/polycli-copilot/plugin.json");
const opencodeManifest = readJson("plugins/polycli-opencode/package.json");
const utilsPackage = readJson("packages/polycli-utils/package.json");
const timingPackage = readJson("packages/polycli-timing/package.json");
const runtimePackage = readJson("packages/polycli-runtime/package.json");

assertPluginEntry(codexMarketplace, {
  name: codexManifest.name,
  path: "./plugins/polycli-codex",
});
assertPluginEntry(claudeMarketplace, {
  name: claudeManifest.name,
  path: "./plugins/polycli",
  version: claudeManifest.version,
});
assertPluginEntry(copilotMarketplace, {
  name: copilotManifest.name,
  path: "./plugins/polycli-copilot",
  version: copilotManifest.version,
});

assert.equal(codexManifest.version, claudeManifest.version);
assert.equal(copilotManifest.version, claudeManifest.version);
assert.equal(opencodeManifest.version, claudeManifest.version);
assert.match(utilsPackage.version, /^1\.\d+\.\d+$/, `${utilsPackage.name} must stay on the v1 line`);
assert.match(timingPackage.version, /^1\.\d+\.\d+$/, `${timingPackage.name} must stay on the v1 line`);
assert.equal(runtimePackage.dependencies?.["@bbingz/polycli-utils"], utilsPackage.version);
assert.equal(runtimePackage.dependencies?.["@bbingz/polycli-timing"], timingPackage.version);
assert.equal(runtimePackage.private, true, `${runtimePackage.name} must remain private`);
assert.equal(Array.isArray(codexMarketplace.plugins), true);
assert.equal(Array.isArray(claudeMarketplace.plugins), true);
assert.equal(Array.isArray(copilotMarketplace.plugins), true);

console.log(`release manifests ok: ${claudeManifest.version}`);
