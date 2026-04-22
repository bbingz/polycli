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
