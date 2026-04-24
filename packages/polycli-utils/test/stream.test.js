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

test("createLineDecoder rejects an overlong line buffer", () => {
  const decoder = createLineDecoder({ maxBufferBytes: 4 });

  assert.throws(
    () => decoder.push(Buffer.from("hello")),
    /Line buffer exceeded maxBufferBytes/
  );
});
