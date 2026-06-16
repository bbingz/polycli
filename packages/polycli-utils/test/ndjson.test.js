import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendNdjson, readNdjson, tailNdjson } from "../src/ndjson.js";

function fileMode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

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
  assert.equal(fileMode(file), 0o666 & ~process.umask());
});

test("appendNdjson honors a private file mode through compaction", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-mode-"));
  const file = path.join(dir, "history.ndjson");

  appendNdjson(file, { id: 1, payload: "a".repeat(60) }, { maxBytes: 120, keepRatio: 0.5, mode: 0o600 });
  appendNdjson(file, { id: 2, payload: "b".repeat(60) }, { maxBytes: 120, keepRatio: 0.5, mode: 0o600 });
  appendNdjson(file, { id: 3, payload: "c".repeat(60) }, { maxBytes: 120, keepRatio: 0.5, mode: 0o600 });

  const records = readNdjson(file);
  assert.deepEqual(records.map((record) => record.id), [3]);
  assert.equal(fileMode(file), 0o600);
});

test("appendNdjson tightens an existing file when private mode is requested", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-existing-mode-"));
  const file = path.join(dir, "history.ndjson");
  fs.writeFileSync(file, `${JSON.stringify({ id: 1 })}\n`, { encoding: "utf8", mode: 0o644 });

  appendNdjson(file, { id: 2 }, { mode: 0o600 });

  assert.deepEqual(readNdjson(file).map((record) => record.id), [1, 2]);
  assert.equal(fileMode(file), 0o600);
});
