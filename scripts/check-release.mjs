import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

run("npm", ["test"]);
run("npm", ["run", "validate:bundles"]);
run("npm", ["run", "validate:fixtures"]);
run("npm", ["run", "validate:manifests"]);
run("npm", ["run", "validate:host-map"]);
run("npm", ["run", "validate:codex-adapter"]);
run("claude", ["plugin", "validate", ".claude-plugin/marketplace.json"]);
run("claude", ["plugin", "validate", "plugins/polycli/.claude-plugin/plugin.json"]);

checkPublishable("./plugins/polycli-opencode");
checkPublishable("./packages/polycli-utils");
checkPublishable("./packages/polycli-timing");
