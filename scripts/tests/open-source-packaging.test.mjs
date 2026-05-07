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

const PUBLIC_BIN_PACKAGES = [
  "packages/polycli-terminal",
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
  assert.match(pkg.bin?.polycli ?? "", /^(?:\.\/)?bin\/polycli\.mjs$/);
  assert.ok(Array.isArray(pkg.files), "terminal package must declare files");
  assert.ok(pkg.files.includes("bin/polycli.mjs"), "terminal package must publish bin/polycli.mjs");
  assert.ok(
    pkg.files.includes("bin/polycli-companion.bundle.mjs"),
    "terminal package must publish bin/polycli-companion.bundle.mjs",
  );
  assert.equal(pkg.engines?.node, ">=20", "terminal package must require Node >=20");
});

test("public bin packages declare a publishable bin surface", () => {
  for (const packageDir of PUBLIC_BIN_PACKAGES) {
    const packageJson = readJson(`${packageDir}/package.json`);
    assert.equal(packageJson.engines?.node, ">=20", `${packageJson.name} must declare Node >=20`);
    assert.notEqual(packageJson.private, true, `${packageJson.name} must not be private`);
    assert.equal(Array.isArray(packageJson.files), true, `${packageJson.name} must declare files`);
    assert.notEqual(packageJson.files.length, 0, `${packageJson.name} files must not be empty`);
    assert.equal(
      typeof packageJson.bin,
      "object",
      `${packageJson.name} must declare a bin object so npm installs a PATH entry`,
    );
    const binEntries = Object.entries(packageJson.bin);
    assert.notEqual(binEntries.length, 0, `${packageJson.name} bin must not be empty`);
    for (const [binName, binTarget] of binEntries) {
      assert.match(binName, /^[a-z][a-z0-9-]*$/, `${packageJson.name} bin name ${binName} must be lowercase`);
      assert.equal(
        typeof binTarget,
        "string",
        `${packageJson.name} bin entry ${binName} must point at a file`,
      );
      const relativeTarget = binTarget.replace(/^\.\//, "");
      assert.ok(
        packageJson.files.includes(relativeTarget),
        `${packageJson.name} bin entry ${binName} (${binTarget}) must be listed in files`,
      );
    }
  }
});

test("public bin packages include MIT license text in the tarball", () => {
  for (const packageDir of PUBLIC_BIN_PACKAGES) {
    const packageJson = readJson(`${packageDir}/package.json`);
    const packedFiles = packFileList(packageDir);
    assert.equal(
      packedFiles.has("LICENSE") || packedFiles.has("LICENSE.md"),
      true,
      `${packageJson.name} tarball must include a LICENSE file`,
    );
  }
});

test("public bin packages publish every declared bin target in the tarball", () => {
  for (const packageDir of PUBLIC_BIN_PACKAGES) {
    const packageJson = readJson(`${packageDir}/package.json`);
    const packedFiles = packFileList(packageDir);
    for (const [binName, binTarget] of Object.entries(packageJson.bin ?? {})) {
      const relativeTarget = binTarget.replace(/^\.\//, "");
      assert.equal(
        packedFiles.has(relativeTarget),
        true,
        `${packageJson.name} bin ${binName} target ${binTarget} must ship in the tarball`,
      );
    }
  }
});

test("terminal package ships tui runtime and view-model files", () => {
  const packedFiles = packFileList("packages/polycli-terminal");
  for (const required of ["bin/polycli-tui.mjs", "lib/tui/view-model.mjs"]) {
    assert.equal(
      packedFiles.has(required),
      true,
      `terminal package tarball must ship ${required}`,
    );
  }
});
