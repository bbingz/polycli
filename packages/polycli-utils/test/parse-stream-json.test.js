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
  assert.match(parsed.error, /Unexpected end|Expected|Unterminated string/);
});

test("parseStreamJsonLine accepts prefixed JSON arrays", () => {
  const parsed = parseStreamJsonLine('noise before [1, {"ok":true}]');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.event, [1, { ok: true }]);
  assert.equal(parsed.prefix, "noise before ");
});

test("parseStreamJsonLine accepts prefixed bare JSON values", () => {
  const parsed = parseStreamJsonLine('noise before true');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.event, true);
  assert.equal(parsed.prefix, "noise before ");
});

test("parseStreamJsonLine skips timestamp and pid prefixes before JSON objects", () => {
  const parsed = parseStreamJsonLine('2026-06-14T10:00:00.000Z pid=42 INFO {"type":"init","session_id":"abc"}');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.event, { type: "init", session_id: "abc" });
  assert.equal(parsed.prefix, "2026-06-14T10:00:00.000Z pid=42 INFO ");
});

test("parseStreamJsonLine distinguishes non-json prose from blank lines", () => {
  const parsed = parseStreamJsonLine("this line has no json payload");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.kind, "non_json");
});
