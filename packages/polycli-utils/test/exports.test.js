import test from "node:test";
import assert from "node:assert/strict";

import * as utils from "../src/index.js";

test("utils index exports expected surface", () => {
  assert.equal(typeof utils.parseArgs, "function");
  assert.equal(typeof utils.runCommand, "function");
  assert.equal(typeof utils.createLineDecoder, "function");
  assert.equal(typeof utils.appendNdjson, "function");
  assert.equal(typeof utils.resolveSessionId, "function");
  assert.equal(typeof utils.parseStreamJsonLine, "function");
});
