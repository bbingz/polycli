#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_RECIPES_PATH = path.join(REPO_ROOT, "docs/cc-x-recipes.json");

function assertNonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a non-empty string`);
  assert.ok(value.trim().length > 0, `${label} must be a non-empty string`);
}

function validateRecipe(index, recipe) {
  const at = `recipe[${index}] (${recipe?.vendor ?? "?"})`;
  assertNonEmptyString(recipe.vendor, `${at}: vendor`);
  assert.equal(typeof recipe.nativeCli, "boolean", `${at}: nativeCli must be boolean`);
  assertNonEmptyString(recipe.runtime, `${at}: runtime`);
  assert.ok(["claude", "opencode"].includes(recipe.runtime), `${at}: runtime must be claude or opencode`);
  const hasBaseUrl = typeof recipe.baseUrlIntl === "string" || typeof recipe.baseUrlCN === "string";
  assert.ok(hasBaseUrl, `${at}: at least one of baseUrlIntl / baseUrlCN must be a string`);
  assert.ok(Array.isArray(recipe.modelIds), `${at}: modelIds must be an array`);
  assert.equal(typeof recipe.marketplace, "boolean", `${at}: marketplace must be boolean`);
  assertNonEmptyString(recipe.cachingNote, `${at}: cachingNote`);
  assertNonEmptyString(recipe.status, `${at}: status`);
  assert.ok(recipe.source && typeof recipe.source === "object", `${at}: source must be an object`);
  assertNonEmptyString(recipe.source.url, `${at}: source.url`);
  assertNonEmptyString(recipe.source.date, `${at}: source.date`);
  assert.doesNotThrow(() => new Date(recipe.source.date).toISOString(), `${at}: source.date must be an ISO date`);
  // Honest-default: marketplace/resale endpoints have no stable model identity,
  // so we refuse to fabricate a pinned context window (mirrors the gemini
  // attempted-vs-used-model caveat in docs/model-fallback-policy.md).
  if (recipe.marketplace === true) {
    assert.equal(recipe.autoCompactWindow, null, `${at}: marketplace recipes must leave autoCompactWindow null (no fabricated pin)`);
    assert.equal(recipe.status, "marketplace-unstable", `${at}: marketplace recipes must declare status "marketplace-unstable"`);
  } else if (recipe.autoCompactWindow !== null) {
    assert.ok(Number.isInteger(recipe.autoCompactWindow) && recipe.autoCompactWindow > 0, `${at}: autoCompactWindow must be null or a positive integer`);
  }
}

export function validateCcXRecipes({ recipesPath = DEFAULT_RECIPES_PATH } = {}) {
  assert.ok(fs.existsSync(recipesPath), `cc-x recipes file does not exist: ${recipesPath}`);
  const doc = JSON.parse(fs.readFileSync(recipesPath, "utf8"));
  assert.equal(typeof doc.schemaVersion, "number", "schemaVersion must be a number");
  assertNonEmptyString(doc.collectedAt, "collectedAt");
  assertNonEmptyString(doc.disclaimer, "disclaimer");
  assert.ok(Array.isArray(doc.recipes), "recipes must be an array");
  assert.ok(doc.recipes.length >= 7, "expected at least the 7 verified core-lab recipes");
  const vendors = new Set();
  doc.recipes.forEach((recipe, index) => {
    validateRecipe(index, recipe);
    assert.ok(!vendors.has(recipe.vendor), `duplicate vendor: ${recipe.vendor}`);
    vendors.add(recipe.vendor);
  });
  return { ok: true, checked: doc.recipes.length, vendors: [...vendors] };
}

function main() {
  const result = validateCcXRecipes();
  console.log(`cc-x recipes ok: ${result.checked} entries (${result.vendors.join(", ")})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
