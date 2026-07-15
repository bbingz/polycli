#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderExpectedPluginArtifacts } from "./build-plugin-bundles.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function readTarget(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`missing generated artifact: ${relativePath}`);
  return fs.readFileSync(filePath);
}

export async function validatePluginBundles({
  root = REPO_ROOT,
  renderOptions = {},
  renderArtifacts = renderExpectedPluginArtifacts,
} = {}) {
  const expectedArtifacts = await renderArtifacts({ ...renderOptions, root });
  if (!(expectedArtifacts instanceof Map) || expectedArtifacts.size === 0) {
    throw new Error("artifact renderer returned no expected outputs");
  }

  for (const [relativePath, expectedBytes] of expectedArtifacts) {
    const actualBytes = readTarget(root, relativePath);
    if (!actualBytes.equals(expectedBytes)) {
      throw new Error(`stale generated artifact: ${relativePath}`);
    }
  }

  return {
    ok: true,
    checked: [...expectedArtifacts.keys()],
  };
}

async function main() {
  const result = await validatePluginBundles();
  console.log(`plugin bundles ok: ${result.checked.length} checked`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
