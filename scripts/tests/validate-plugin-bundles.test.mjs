import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validatePluginBundles } from "../validate-plugin-bundles.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const REAL_BUNDLE_TARGETS = [
  "plugins/polycli/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-codex/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs",
  "packages/polycli-terminal/bin/polycli-companion.bundle.mjs",
];

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "polycli-bundles-test-"));
}

function writeFile(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

test("validatePluginBundles accepts byte-identical bundle targets", () => {
  const root = makeTempRoot();
  const targets = ["a/bundle.mjs", "b/bundle.mjs", "c/bundle.mjs"];
  for (const target of targets) {
    writeFile(root, target, "console.log('same');\n");
  }

  const result = validatePluginBundles({ root, targets });

  assert.deepEqual(result, {
    ok: true,
    checked: targets,
  });
});

test("validatePluginBundles rejects mismatched bundle targets", () => {
  const root = makeTempRoot();
  const targets = ["a/bundle.mjs", "b/bundle.mjs"];
  writeFile(root, targets[0], "console.log('first');\n");
  writeFile(root, targets[1], "console.log('second');\n");

  assert.throws(
    () => validatePluginBundles({ root, targets }),
    /bundle drift detected: b\/bundle\.mjs differs from a\/bundle\.mjs/
  );
});

test("validatePluginBundles validates the five real companion bundle targets", () => {
  for (const target of REAL_BUNDLE_TARGETS) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, target)),
      `expected real bundle target on disk: ${target}`,
    );
  }
  const result = validatePluginBundles({ root: REPO_ROOT, targets: REAL_BUNDLE_TARGETS });
  assert.deepEqual(result, { ok: true, checked: REAL_BUNDLE_TARGETS });
});
