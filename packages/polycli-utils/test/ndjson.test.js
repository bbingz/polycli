import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendNdjson, appendNdjsonBatch, readNdjson, tailNdjson } from "../src/ndjson.js";

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

test("appendNdjsonBatch publishes its records in one normalized snapshot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-batch-"));
  const file = path.join(dir, "history.ndjson");

  fs.writeFileSync(file, '{"id":1}');
  appendNdjsonBatch(file, [{ id: 2 }, { id: 3 }]);

  assert.equal(fs.readFileSync(file, "utf8"), '{"id":1}\n{"id":2}\n{"id":3}\n');
  assert.deepEqual(readNdjson(file).map((record) => record.id), [1, 2, 3]);
});

test("appendNdjsonBatch compacts a completed batch and honors private mode", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-batch-mode-"));
  const file = path.join(dir, "history.ndjson");

  fs.writeFileSync(file, `${JSON.stringify({ id: 1, payload: "a".repeat(60) })}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  appendNdjsonBatch(
    file,
    [
      { id: 2, payload: "b".repeat(60) },
      { id: 3, payload: "c".repeat(60) },
    ],
    { maxBytes: 120, keepRatio: 0.5, mode: 0o600 }
  );

  assert.deepEqual(readNdjson(file).map((record) => record.id), [2, 3]);
  assert.equal(fileMode(file), 0o600);
});

test("appendNdjsonBatch never compacts away part of the incoming batch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-batch-boundary-"));
  const file = path.join(dir, "history.ndjson");
  const records = [
    { id: 1, payload: "a".repeat(80) },
    { id: 2, payload: "b".repeat(80) },
  ];

  appendNdjsonBatch(file, records, { maxBytes: 100, keepRatio: 0.5 });

  assert.deepEqual(readNdjson(file).map((record) => record.id), [1, 2]);
});

test("appendNdjson preserves an earlier member of a retained logical group", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-group-retention-"));
  const file = path.join(dir, "history.ndjson");
  const retentionGroupKey = (record) => record.terminalPair ?? null;

  appendNdjson(file, { id: "attempt", terminalPair: "run-a/job-a", payload: "a".repeat(80) });
  appendNdjson(file, { id: "decision", terminalPair: "run-a/job-a", payload: "b".repeat(80) });
  appendNdjson(
    file,
    { id: "newer", payload: "c".repeat(80) },
    { maxBytes: 180, keepRatio: 0.5, retentionGroupKey },
  );

  assert.deepEqual(readNdjson(file).map((record) => record.id), ["attempt", "decision", "newer"]);
});

test("appendNdjsonBatch preserves an earlier member of a retained logical group", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ndjson-batch-group-retention-"));
  const file = path.join(dir, "history.ndjson");
  const retentionGroupKey = (record) => record.terminalPair ?? null;

  appendNdjsonBatch(file, [
    { id: "attempt", terminalPair: "run-a/job-a", payload: "a".repeat(80) },
    { id: "decision", terminalPair: "run-a/job-a", payload: "b".repeat(80) },
  ]);
  appendNdjsonBatch(
    file,
    [{ id: "newer", payload: "c".repeat(80) }],
    { maxBytes: 180, keepRatio: 0.5, retentionGroupKey },
  );

  assert.deepEqual(readNdjson(file).map((record) => record.id), ["attempt", "decision", "newer"]);
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
