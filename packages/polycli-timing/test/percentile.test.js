import test from "node:test";
import assert from "node:assert/strict";

import { calculatePercentiles } from "../src/percentile.js";

test("calculatePercentiles returns p50/p95/p99 using nearest-rank", () => {
  const stats = calculatePercentiles([10, 20, 30, 40, 50], [50, 95, 99]);
  assert.deepEqual(stats, { p50: 30, p95: 50, p99: 50 });
});

test("calculatePercentiles rejects percentile values outside 0-100", () => {
  assert.throws(() => calculatePercentiles([10, 20], [101]), /Percentile must be between 0 and 100/);
});
