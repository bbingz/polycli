#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_FIXTURE_ROOT = path.join(REPO_ROOT, "packages/polycli-runtime/test/fixtures");

function walkMetaFiles(root, current = root) {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMetaFiles(root, entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".meta.json")) {
      files.push(path.relative(root, entryPath).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function assertNonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a non-empty string`);
  assert.ok(value.trim().length > 0, `${label} must be a non-empty string`);
}

function validateMeta(relativePath, meta) {
  assertNonEmptyString(meta.provider, `${relativePath}: provider`);
  assertNonEmptyString(meta.name, `${relativePath}: name`);
  assertNonEmptyString(meta.capturedAt, `${relativePath}: capturedAt`);
  assert.doesNotThrow(() => new Date(meta.capturedAt).toISOString(), `${relativePath}: capturedAt must be an ISO timestamp`);
  assertNonEmptyString(meta.version, `${relativePath}: version`);
  assert.ok(Array.isArray(meta.argv), `${relativePath}: argv must be an array`);
  assert.ok(meta.argv.length > 0, `${relativePath}: argv must not be empty`);
  assert.ok(meta.expected && typeof meta.expected === "object", `${relativePath}: expected must be an object`);
  assertNonEmptyString(meta.expected.response, `${relativePath}: expected.response`);
  if (meta.expected.sessionId !== undefined && meta.expected.sessionId !== null) {
    assert.equal(typeof meta.expected.sessionId, "string", `${relativePath}: expected.sessionId must be a string when present`);
  }
}

export function validateFixtureMetadata({ fixtureRoot = DEFAULT_FIXTURE_ROOT } = {}) {
  assert.ok(fs.existsSync(fixtureRoot), `fixture root does not exist: ${fixtureRoot}`);
  const metaFiles = walkMetaFiles(fixtureRoot);
  assert.ok(metaFiles.length > 0, `no fixture metadata files found under ${fixtureRoot}`);

  for (const relativePath of metaFiles) {
    const filePath = path.join(fixtureRoot, relativePath);
    const meta = JSON.parse(fs.readFileSync(filePath, "utf8"));
    validateMeta(relativePath, meta);
  }

  return {
    ok: true,
    checked: metaFiles,
  };
}

function main() {
  const result = validateFixtureMetadata();
  console.log(`fixture metadata ok: ${result.checked.length} checked`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
