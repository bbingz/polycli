import test from "node:test";
import assert from "node:assert/strict";

import { createLineDecoder } from "../src/stream.js";

test("createLineDecoder preserves UTF-8 characters split across chunks", () => {
  const decoder = createLineDecoder();
  const left = Buffer.from("你");
  const right = Buffer.from("好\nsecond");

  const firstPass = decoder.push(left.subarray(0, 2));
  const secondPass = decoder.push(Buffer.concat([left.subarray(2), right]));
  const finalPass = decoder.end();

  assert.deepEqual(firstPass, []);
  assert.deepEqual(secondPass, ["你好"]);
  assert.deepEqual(finalPass, ["second"]);
});

test("createLineDecoder rejects an overlong unterminated line buffer", () => {
  const decoder = createLineDecoder({ maxBufferBytes: 4 });

  assert.throws(
    () => decoder.push(Buffer.from("hello")),
    /Line buffer exceeded maxBufferBytes/
  );
});

test("createLineDecoder drains a burst of complete lines that exceeds the buffer limit", () => {
  const decoder = createLineDecoder({ maxBufferBytes: 16 });
  // 10 complete 3-byte lines = 30 bytes, well over the 16-byte limit, but every line is
  // newline-terminated and therefore drainable — the limit only guards an unterminated line.
  const lines = decoder.push(Buffer.from("ab\n".repeat(10)));

  assert.equal(lines.length, 10);
  assert.ok(lines.every((line) => line === "ab"));
  assert.deepEqual(decoder.end(), []);
});
