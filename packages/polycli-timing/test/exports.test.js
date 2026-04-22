import test from "node:test";
import assert from "node:assert/strict";

import * as timing from "../src/index.js";

test("timing index exports expected surface", () => {
  assert.deepEqual(Object.keys(timing).sort(), [
    "TIMING_MEASUREMENT_SCOPES",
    "TIMING_METRIC_NAMES",
    "TIMING_METRIC_STATUSES",
    "TIMING_RUNTIME_PERSISTENCE",
    "TIMING_SCHEMA_URL",
    "TIMING_SCHEMA_VERSION",
    "aggregateTimingRecords",
    "calculatePercentiles",
    "readTimingSchema",
    "validateTimingRecord",
  ]);
});
