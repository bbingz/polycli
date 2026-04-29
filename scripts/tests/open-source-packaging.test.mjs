import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const PUBLIC_PACKAGES = [
  "packages/polycli-utils",
  "packages/polycli-timing",
  "plugins/polycli-opencode",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function packFileList(packageDir) {
  const output = execFileSync("npm", ["pack", `./${packageDir}`, "--dry-run", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const [packed] = JSON.parse(output);
  return new Set(packed.files.map((file) => file.path));
}

test("public npm packages include every exported target", () => {
  for (const packageDir of PUBLIC_PACKAGES) {
    const packageJson = readJson(`${packageDir}/package.json`);
    const packedFiles = packFileList(packageDir);

    for (const [subpath, target] of Object.entries(packageJson.exports ?? {})) {
      if (typeof target !== "string") continue;
      const packedPath = target.replace(/^\.\//, "");
      assert.equal(
        packedFiles.has(packedPath),
        true,
        `${packageJson.name} export ${subpath} points at unpacked file ${target}`
      );
    }
  }
});

test("public npm packages include MIT license text", () => {
  for (const packageDir of PUBLIC_PACKAGES) {
    const packageJson = readJson(`${packageDir}/package.json`);
    const packedFiles = packFileList(packageDir);
    assert.equal(
      packedFiles.has("LICENSE") || packedFiles.has("LICENSE.md"),
      true,
      `${packageJson.name} tarball must include a LICENSE file`
    );
  }
});

