import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendNdjson, readNdjson, tailNdjson } from "../src/ndjson.js";

test("appendNdjson repairs missing trailing newline and tailNdjson returns newest records", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-"));
  const file = path.join(dir, "history.ndjson");

  fs.writeFileSync(file, '{"id":1}');
  appendNdjson(file, { id: 2 });
  appendNdjson(file, { id: 3 });

  const records = readNdjson(file);
  const tail = tailNdjson(file, 2);

  assert.deepEqual(records.map((record) => record.id), [1, 2, 3]);
  assert.deepEqual(tail.map((record) => record.id), [2, 3]);
});

test("readNdjson returns an empty list for missing files but surfaces other IO errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-"));
  const missing = path.join(dir, "missing.ndjson");
  const blockedDir = path.join(dir, "blocked");

  fs.mkdirSync(blockedDir);

  assert.deepEqual(readNdjson(missing), []);
  assert.throws(() => readNdjson(blockedDir), /EISDIR|illegal operation|operation on a directory/i);
});

test("appendNdjson trims old records when maxBytes is exceeded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-"));
  const file = path.join(dir, "history.ndjson");

  appendNdjson(file, { id: 1, payload: "a".repeat(60) }, { maxBytes: 120, keepRatio: 0.5 });
  appendNdjson(file, { id: 2, payload: "b".repeat(60) }, { maxBytes: 120, keepRatio: 0.5 });
  appendNdjson(file, { id: 3, payload: "c".repeat(60) }, { maxBytes: 120, keepRatio: 0.5 });

  const records = readNdjson(file);
  assert.deepEqual(records.map((record) => record.id), [3]);
});
