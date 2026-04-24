import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validatePluginBundles } from "../validate-plugin-bundles.mjs";

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
