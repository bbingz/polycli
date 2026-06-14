import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, splitRawArgumentString } from "../src/args.js";

test("parseArgs parses value, boolean, alias, passthrough, and unknown tokens", () => {
  const parsed = parseArgs(
    ["--json", "-t", "5000", "--cwd=/tmp/demo", "--unknown", "ask", "--", "--literal"],
    {
      booleanOptions: ["json"],
      valueOptions: ["timeout", "cwd"],
      aliasMap: { t: "timeout" },
    }
  );

  assert.deepEqual(parsed.options, {
    json: true,
    timeout: "5000",
    cwd: "/tmp/demo",
  });
  assert.deepEqual(parsed.positionals, ["--unknown", "ask", "--literal"]);
});

test("splitRawArgumentString respects quotes and escapes", () => {
  const tokens = splitRawArgumentString(String.raw`ask "hello world" 'two words' plain\ value`);
  assert.deepEqual(tokens, ["ask", "hello world", "two words", "plain value"]);
});

test("splitRawArgumentString preserves empty quoted arguments", () => {
  const tokens = splitRawArgumentString(String.raw`cmd "" '' --flag="" value''`);
  assert.deepEqual(tokens, ["cmd", "", "", "--flag=", "value"]);
});

test("parseArgs supports short value options concatenated to the flag", () => {
  const parsed = parseArgs(["-r123e4567-e89b-12d3-a456-426614174000"], {
    valueOptions: ["resume"],
    aliasMap: { r: "resume" },
  });

  assert.deepEqual(parsed.options, {
    resume: "123e4567-e89b-12d3-a456-426614174000",
  });
  assert.deepEqual(parsed.positionals, []);
});

test("parseArgs rejects empty inline boolean values", () => {
  assert.throws(
    () => parseArgs(["--json="], { booleanOptions: ["json"] }),
    /Invalid boolean value for --json/
  );
});

test("splitRawArgumentString keeps escaped double quotes inside double-quoted regions", () => {
  const tokens = splitRawArgumentString(String.raw`ask "he said \"hi\"" plain`);
  assert.deepEqual(tokens, ["ask", 'he said "hi"', "plain"]);
});

test("splitRawArgumentString rejects a trailing escape", () => {
  assert.throws(
    () => splitRawArgumentString("ask trailing\\"),
    /Trailing escape/
  );
});
