import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

test("runtime package declares a dependency on polycli-utils", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  const utilsPackage = JSON.parse(fs.readFileSync(path.resolve(PACKAGE_ROOT, "../polycli-utils/package.json"), "utf8"));
  assert.equal(packageJson.dependencies?.["@bbingz/polycli-utils"], utilsPackage.version);
});

test("runtime package declares a dependency on polycli-timing", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies?.["@bbingz/polycli-timing"], "1.0.2");
});

test("runtime source files do not use sibling relative imports into polycli-utils", () => {
  const srcDir = path.join(PACKAGE_ROOT, "src");
  const files = fs.readdirSync(srcDir).filter((file) => file.endsWith(".js"));

  for (const file of files) {
    const source = fs.readFileSync(path.join(srcDir, file), "utf8");
    assert.equal(source.includes("../../polycli-utils/"), false, file);
  }
});
