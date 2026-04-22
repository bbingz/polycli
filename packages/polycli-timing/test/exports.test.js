import test from "node:test";
import assert from "node:assert/strict";

import * as timing from "../src/index.js";

test("timing index exports expected surface", () => {
  assert.equal(typeof timing.validateTimingRecord, "function");
  assert.equal(typeof timing.calculatePercentiles, "function");
  assert.equal(typeof timing.aggregateTimingRecords, "function");
  assert.equal(typeof timing.readTimingSchema, "function");
  assert.equal(typeof timing.TIMING_SCHEMA_URL, "object");
});
