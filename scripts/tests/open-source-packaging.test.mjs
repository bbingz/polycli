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

test("public npm packages declare an explicit publish surface", () => {
  for (const packageDir of PUBLIC_PACKAGES) {
    const packageJson = readJson(`${packageDir}/package.json`);

    assert.equal(packageJson.engines?.node, ">=20", `${packageJson.name} must declare Node >=20`);
    assert.equal(Array.isArray(packageJson.files), true, `${packageJson.name} must declare files`);
    assert.notEqual(packageJson.files.length, 0, `${packageJson.name} files must not be empty`);
    assert.equal(typeof packageJson.exports?.["."], "string", `${packageJson.name} must export its root entry`);
    assert.equal(Array.isArray(packageJson.keywords), true, `${packageJson.name} must declare keywords`);
    assert.ok(packageJson.keywords.includes("polycli"), `${packageJson.name} keywords must include polycli`);
  }
});

test("terminal package exposes polycli bin and keeps runtime private", () => {
  const pkg = readJson("packages/polycli-terminal/package.json");
  assert.equal(pkg.name, "@bbingz/polycli");
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.bin?.polycli, "./bin/polycli.mjs");
  assert.ok(Array.isArray(pkg.files), "terminal package must declare files");
  assert.ok(pkg.files.includes("bin/polycli.mjs"), "terminal package must publish bin/polycli.mjs");
  assert.ok(
    pkg.files.includes("bin/polycli-companion.bundle.mjs"),
    "terminal package must publish bin/polycli-companion.bundle.mjs",
  );
  assert.equal(pkg.engines?.node, ">=20", "terminal package must require Node >=20");
});
