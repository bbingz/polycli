import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as bundleBuilder from "../build-plugin-bundles.mjs";
import { validatePluginBundles } from "../validate-plugin-bundles.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const REAL_BUNDLE_TARGETS = [
  "plugins/polycli/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-codex/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs",
  "packages/polycli-terminal/bin/polycli-companion.bundle.mjs",
];
const REAL_GENERATED_SURFACE = "packages/polycli-terminal/lib/command-surface.generated.mjs";

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-bundles-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function readFiles(root, relativePaths) {
  return new Map(relativePaths.map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(root, relativePath)),
  ]));
}

function assertFilesEqual(actual, expected) {
  assert.deepEqual([...actual.keys()], [...expected.keys()]);
  for (const [relativePath, actualBytes] of actual) {
    assert.ok(actualBytes.equals(expected.get(relativePath)), `${relativePath} changed unexpectedly`);
  }
}

function fixtureRenderOptions(root, targets, generatedSurface = null) {
  return {
    entry: path.join(root, "src/entry.mjs"),
    targets,
    generatedSurface,
    version: "0.0.0-test",
  };
}

test("source-derived validation rejects five mutually identical stale bundles without rewriting them", async (t) => {
  const root = makeTempRoot(t);
  const targets = [
    "targets/one.mjs",
    "targets/two.mjs",
    "targets/three.mjs",
    "targets/four.mjs",
    "targets/five.mjs",
  ];
  writeFile(root, "src/entry.mjs", "export const value = 'old';\n");
  const oldArtifacts = await bundleBuilder.renderExpectedPluginArtifacts({
    root,
    ...fixtureRenderOptions(root, targets),
  });
  for (const [relativePath, bytes] of oldArtifacts) writeFile(root, relativePath, bytes);

  writeFile(root, "src/entry.mjs", "export const value = 'fresh';\n");
  const before = readFiles(root, targets);
  assert.ok([...before.values()].every((bytes) => bytes.equals(before.get(targets[0]))));

  await assert.rejects(
    validatePluginBundles({
      root,
      renderOptions: fixtureRenderOptions(root, targets),
    }),
    /stale generated artifact: targets\/one\.mjs/,
  );

  assertFilesEqual(readFiles(root, targets), before);
});

test("source-derived validation rejects drift in a single bundle target", async (t) => {
  const root = makeTempRoot(t);
  const targets = ["targets/only.mjs"];
  writeFile(root, "src/entry.mjs", "export const value = 'fresh';\n");
  writeFile(root, targets[0], "export const value = 'stale';\n");

  await assert.rejects(
    validatePluginBundles({
      root,
      renderOptions: fixtureRenderOptions(root, targets),
    }),
    /stale generated artifact: targets\/only\.mjs/,
  );
});

test("source-derived validation rejects stale generated terminal command metadata", async (t) => {
  const root = makeTempRoot(t);
  const targets = ["targets/only.mjs"];
  const generatedSurface = {
    relativePath: "terminal/generated.mjs",
    contents: Buffer.from("fresh metadata\n"),
  };
  writeFile(root, "src/entry.mjs", "export const value = 'fresh';\n");
  const expected = await bundleBuilder.renderExpectedPluginArtifacts({
    root,
    ...fixtureRenderOptions(root, targets, generatedSurface),
  });
  writeFile(root, targets[0], expected.get(targets[0]));
  writeFile(root, generatedSurface.relativePath, "stale metadata\n");

  await assert.rejects(
    validatePluginBundles({
      root,
      renderOptions: fixtureRenderOptions(root, targets, generatedSurface),
    }),
    /stale generated artifact: terminal\/generated\.mjs/,
  );
});

test("source-derived validation accepts matching generated artifacts", async (t) => {
  const root = makeTempRoot(t);
  const targets = ["targets/one.mjs", "targets/two.mjs"];
  const generatedSurface = {
    relativePath: "terminal/generated.mjs",
    contents: Buffer.from("fresh metadata\n"),
  };
  const renderOptions = fixtureRenderOptions(root, targets, generatedSurface);
  writeFile(root, "src/entry.mjs", "export const value = 'fresh';\n");
  const expected = await bundleBuilder.renderExpectedPluginArtifacts({ root, ...renderOptions });
  for (const [relativePath, bytes] of expected) writeFile(root, relativePath, bytes);

  const result = await validatePluginBundles({ root, renderOptions });

  assert.deepEqual(result, {
    ok: true,
    checked: [...targets, generatedSurface.relativePath],
  });
});

test("real repository target manifest contains exactly five bundles and one generated metadata file", () => {
  assert.deepEqual(bundleBuilder.PLUGIN_BUNDLE_TARGETS, REAL_BUNDLE_TARGETS);
  assert.equal(bundleBuilder.TERMINAL_COMMAND_SURFACE_TARGET, REAL_GENERATED_SURFACE);
  assert.equal(new Set(bundleBuilder.PLUGIN_BUNDLE_TARGETS).size, 5);
});

test("CI validates source-derived artifacts after install and before npm test", () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const installIndex = workflow.indexOf("run: npm ci");
  const freshnessIndex = workflow.indexOf("run: npm run validate:bundles");
  const testIndex = workflow.indexOf("run: npm test");

  assert.ok(installIndex >= 0, "CI must install dependencies");
  assert.ok(freshnessIndex > installIndex, "freshness validation must run after npm ci");
  assert.ok(testIndex > freshnessIndex, "freshness validation must run before npm test");
});
