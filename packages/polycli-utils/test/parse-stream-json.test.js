import test from "node:test";
import assert from "node:assert/strict";

import { parseStreamJsonLine } from "../src/parse-stream-json.js";

test("parseStreamJsonLine skips noise prefixes before JSON", () => {
  const parsed = parseStreamJsonLine('MCP issues detected... {"type":"init","session_id":"abc"}');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.event, { type: "init", session_id: "abc" });
  assert.equal(parsed.prefix, "MCP issues detected... ");
});

test("parseStreamJsonLine surfaces malformed JSON as parse_error", () => {
  const parsed = parseStreamJsonLine('noise {"type":');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.kind, "parse_error");
  assert.match(parsed.error, /Unexpected end|Expected/);
});
