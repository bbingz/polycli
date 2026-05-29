import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function run(command, args, options = {}) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error) {
    console.error(`${label} failed: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${label} exited with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function packageSpec(packageDir) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, packageDir, "package.json"), "utf8"));
  return `${packageJson.name}@${packageJson.version}`;
}

function npmPackageVersionExists(spec) {
  const result = spawnSync("npm", ["view", spec, "version"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

function checkPublishable(packageDir) {
  const spec = packageSpec(packageDir);
  if (npmPackageVersionExists(spec)) {
    run("npm", ["pack", packageDir, "--dry-run"]);
  } else {
    run("npm", ["publish", packageDir, "--dry-run", "--access", "public"]);
  }
}

// Ordered release-gate steps. Deterministic validators run first so a
// contributor without provider CLIs still gets a clean run; check:review-drift
// runs after them and self-skips absent CLIs (exit 0), only exit-2ing on a
// real installed-CLI flag drift. Exported so the gate composition is testable.
export const RELEASE_STEPS = [
  ["npm", ["test"]],
  ["npm", ["run", "validate:bundles"]],
  ["npm", ["run", "validate:fixtures"]],
  ["npm", ["run", "validate:manifests"]],
  ["npm", ["run", "validate:host-map"]],
  ["npm", ["run", "validate:codex-adapter"]],
  ["npm", ["run", "check:review-drift"]],
  ["claude", ["plugin", "validate", ".claude-plugin/marketplace.json"]],
  ["claude", ["plugin", "validate", "plugins/polycli/.claude-plugin/plugin.json"]],
];

// Only run the gate when invoked directly (`node scripts/check-release.mjs`),
// not when imported for its exported step list.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [command, args] of RELEASE_STEPS) {
    run(command, args);
  }

  checkPublishable("./plugins/polycli-opencode");
  checkPublishable("./packages/polycli-utils");
  checkPublishable("./packages/polycli-timing");
  checkPublishable("./packages/polycli-terminal");
}
