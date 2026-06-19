import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateCcXRecipes } from "../validate-cc-x-recipes.mjs";

function writeDoc(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ccx-test-"));
  const filePath = path.join(dir, "cc-x-recipes.json");
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function baseRecipe(overrides = {}) {
  return {
    vendor: "DeepSeek",
    nativeCli: false,
    runtime: "claude",
    baseUrlIntl: "https://api.deepseek.com/anthropic",
    baseUrlCN: null,
    modelIds: ["deepseek-v4-pro"],
    marketplace: false,
    autoCompactWindow: 128000,
    cachingNote: "automatic prefix caching",
    status: "verified",
    source: { url: "https://api-docs.deepseek.com", date: "2026-06-19" },
    ...overrides,
  };
}

function baseDoc(recipes) {
  return {
    schemaVersion: 1,
    collectedAt: "2026-06-19",
    disclaimer: "reference only, not a runtime",
    recipes,
  };
}

test("validateCcXRecipes accepts a structurally complete, source-anchored doc", () => {
  const recipes = Array.from({ length: 7 }, (_, i) => baseRecipe({ vendor: `Vendor${i}` }));
  const result = validateCcXRecipes({ recipesPath: writeDoc(baseDoc(recipes)) });
  assert.equal(result.ok, true);
  assert.equal(result.checked, 7);
});

test("validateCcXRecipes rejects an entry missing a source URL", () => {
  const recipes = Array.from({ length: 7 }, (_, i) => baseRecipe({ vendor: `Vendor${i}` }));
  recipes[0].source = { url: "", date: "2026-06-19" };
  assert.throws(() => validateCcXRecipes({ recipesPath: writeDoc(baseDoc(recipes)) }), /source\.url/);
});

test("validateCcXRecipes rejects a marketplace entry with a fabricated autoCompactWindow", () => {
  const recipes = Array.from({ length: 7 }, (_, i) => baseRecipe({ vendor: `Vendor${i}` }));
  recipes[0] = baseRecipe({ vendor: "Marketplace", marketplace: true, status: "marketplace-unstable", modelIds: [], autoCompactWindow: 128000 });
  assert.throws(() => validateCcXRecipes({ recipesPath: writeDoc(baseDoc(recipes)) }), /autoCompactWindow null/);
});

test("validateCcXRecipes rejects an unknown status (e.g. draft)", () => {
  const recipes = Array.from({ length: 7 }, (_, i) => baseRecipe({ vendor: `Vendor${i}` }));
  recipes[0] = baseRecipe({ vendor: "Draft", status: "draft" });
  assert.throws(() => validateCcXRecipes({ recipesPath: writeDoc(baseDoc(recipes)) }), /status must be "verified" or "marketplace-unstable"/);
});

test("validateCcXRecipes requires at least the 7 verified core-lab recipes", () => {
  const recipes = Array.from({ length: 6 }, (_, i) => baseRecipe({ vendor: `Vendor${i}` }));
  assert.throws(() => validateCcXRecipes({ recipesPath: writeDoc(baseDoc(recipes)) }), /at least the 7 verified/);
});

test("validateCcXRecipes passes against the shipped docs/cc-x-recipes.json", () => {
  const result = validateCcXRecipes();
  assert.equal(result.ok, true);
  assert.ok(result.checked >= 7);
});
