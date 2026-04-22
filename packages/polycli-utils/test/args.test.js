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
