import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateFixtureMetadata } from "../validate-fixture-metadata.mjs";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fixtures-test-"));
}

function writeMeta(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("validateFixtureMetadata accepts the runtime fixture metadata contract", () => {
  const root = makeTempRoot();
  writeMeta(root, "qwen/stream-success.meta.json", {
    provider: "qwen",
    name: "stream-success",
    capturedAt: "2026-04-22T12:44:18.282Z",
    version: "0.14.5",
    argv: ["--output-format", "stream-json", "Reply with exactly HELLO_QWEN_FIXTURE and nothing else."],
    expected: {
      response: "HELLO_QWEN_FIXTURE",
      sessionId: "a96e0eb5-fc5a-44b9-87e0-cf95b1ebdb20",
    },
  });

  const result = validateFixtureMetadata({ fixtureRoot: root });

  assert.deepEqual(result, {
    ok: true,
    checked: ["qwen/stream-success.meta.json"],
  });
});

test("validateFixtureMetadata rejects missing required fields", () => {
  const root = makeTempRoot();
  writeMeta(root, "qwen/stream-success.meta.json", {
    provider: "qwen",
    name: "stream-success",
    capturedAt: "2026-04-22T12:44:18.282Z",
    version: "0.14.5",
    argv: ["prompt"],
    expected: {},
  });

  assert.throws(
    () => validateFixtureMetadata({ fixtureRoot: root }),
    /qwen\/stream-success\.meta\.json: expected\.response must be a non-empty string/
  );
});

test("validateFixtureMetadata rejects sessionId values that are not strings", () => {
  const root = makeTempRoot();
  writeMeta(root, "qwen/stream-success.meta.json", {
    provider: "qwen",
    name: "stream-success",
    capturedAt: "2026-04-22T12:44:18.282Z",
    version: "0.14.5",
    argv: ["prompt"],
    expected: {
      response: "HELLO_QWEN_FIXTURE",
      sessionId: 123,
    },
  });

  assert.throws(
    () => validateFixtureMetadata({ fixtureRoot: root }),
    /qwen\/stream-success\.meta\.json: expected\.sessionId must be a string when present/
  );
});
