#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const ENTRY = path.join(REPO_ROOT, "plugins/polycli/scripts/polycli-companion.mjs");
const TARGETS = [
  "plugins/polycli/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-codex/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs",
  "plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs",
];

async function main() {
  for (const relativeTarget of TARGETS) {
    await build({
      entryPoints: [ENTRY],
      outfile: path.join(REPO_ROOT, relativeTarget),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      legalComments: "none",
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
