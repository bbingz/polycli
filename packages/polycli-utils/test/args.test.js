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

const strictConfig = {
  booleanOptions: ["json"],
  valueOptions: ["timeout", "cwd"],
  aliasMap: { j: "json", t: "timeout", c: "cwd" },
  unknownOptionMode: "error",
  rejectDuplicateOptions: true,
};

function assertInvalidArgument(callback, argument, messagePattern) {
  assert.throws(callback, (error) => (
    error instanceof Error
    && error.code === "invalid_argument"
    && error.data?.argument === argument
    && messagePattern.test(error.message)
  ));
}

test("parseArgs strict mode rejects unknown long and short options with structured errors", () => {
  assertInvalidArgument(
    () => parseArgs(["--modle"], strictConfig),
    "--modle",
    /Unknown option/
  );
  assertInvalidArgument(
    () => parseArgs(["-x"], strictConfig), "-x", /Unknown option/);
  assertInvalidArgument(
    () => parseArgs(["--t", "5000"], strictConfig), "--t", /Unknown option/);
});

test("parseArgs strict mode rejects duplicate canonical options across aliases", () => {
  assertInvalidArgument(
    () => parseArgs(["--timeout", "5000", "-t6000"], strictConfig),
    "-t6000",
    /Duplicate option/
  );
});

test("parseArgs strict mode accepts documented forms and preserves delimiter positionals", () => {
  const parsed = parseArgs(
    ["prompt", "--json=false", "--timeout=5000", "-c/tmp/demo", "--", "--literal"],
    strictConfig
  );

  assert.deepEqual(parsed.options, {
    json: false,
    timeout: "5000",
    cwd: "/tmp/demo",
  });
  assert.deepEqual(parsed.positionals, ["prompt", "--literal"]);

  const spacedValues = parseArgs(["--timeout", "6000", "-c", "/tmp/other"], strictConfig);
  assert.deepEqual(spacedValues.options, {
    timeout: "6000",
    cwd: "/tmp/other",
  });
});

test("parseArgs strict mode rejects short boolean clusters while retaining value-alias adjacency", () => {
  assert.throws(
    () => parseArgs(["-jt"], strictConfig),
    (error) => error?.code === "invalid_argument",
  );
  assert.deepEqual(parseArgs(["-t5000"], strictConfig).options, { timeout: "5000" });
});

test("parseArgs strict mode accepts options before, between, and after positionals", () => {
  const parsed = parseArgs(
    ["--json", "first", "--timeout", "5000", "second", "-c/tmp/demo"],
    strictConfig,
  );
  assert.deepEqual(parsed.options, { json: true, timeout: "5000", cwd: "/tmp/demo" });
  assert.deepEqual(parsed.positionals, ["first", "second"]);
});

test("parseArgs strict mode rejects invalid boolean values and missing option values", () => {
  assertInvalidArgument(
    () => parseArgs(["--json=maybe"], strictConfig),
    "--json=maybe",
    /Invalid boolean value/
  );
  assertInvalidArgument(
    () => parseArgs(["--timeout", "--json"], strictConfig),
    "--timeout",
    /Missing value/
  );
  assertInvalidArgument(
    () => parseArgs(["--timeout", "--", "literal"], strictConfig),
    "--timeout",
    /Missing value/
  );
  assertInvalidArgument(
    () => parseArgs(["-t", "--", "literal"], strictConfig),
    "-t",
    /Missing value/
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
