#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_TARGETS = [
  "plugins/polycli/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-codex/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs",
  "packages/polycli-terminal/bin/polycli-companion.bundle.mjs",
];

function readTarget(root, relativePath) {
  const filePath = path.join(root, relativePath);
  assert.ok(fs.existsSync(filePath), `missing bundle target: ${relativePath}`);
  return fs.readFileSync(filePath);
}

export function validatePluginBundles({ root = REPO_ROOT, targets = DEFAULT_TARGETS } = {}) {
  assert.ok(Array.isArray(targets) && targets.length > 1, "at least two bundle targets are required");

  const [referenceTarget, ...otherTargets] = targets;
  const referenceBytes = readTarget(root, referenceTarget);
  for (const target of otherTargets) {
    const bytes = readTarget(root, target);
    if (!bytes.equals(referenceBytes)) {
      throw new Error(`bundle drift detected: ${target} differs from ${referenceTarget}`);
    }
  }

  return {
    ok: true,
    checked: targets,
  };
}

function main() {
  const result = validatePluginBundles();
  console.log(`plugin bundles ok: ${result.checked.length} checked`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
