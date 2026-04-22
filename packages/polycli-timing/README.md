# @bbingz/polycli-timing

`@bbingz/polycli-timing` 提供独立的 timing contract，而不是公共 runtime。

## Design Rules

- 不强迫所有 provider 都有同一组指标能力。
- 每个 metric 必须显式声明 `status`。
- 聚合时严格区分：
  - `unsupported`
  - `missing`
  - `zero`
  - `measured`
- daemon / session / ephemeral 必须通过 `runtimePersistence` 区分。
- request / turn / job 必须通过 `measurementScope` 区分。

## Exports

- `validateTimingRecord()`
- `calculatePercentiles()`
- `aggregateTimingRecords()`
- `readTimingSchema()`
- `timing.schema.json`

## Example

```js
import {
  validateTimingRecord,
  aggregateTimingRecords
} from "./src/index.js";

const record = {
  version: 1,
  provider: "minimax",
  runtimePersistence: "session",
  measurementScope: "job",
  completedAt: "2026-04-22T00:00:00.000Z",
  metrics: {
    cold:  { status: "unsupported", ms: null },
    ttft:  { status: "unsupported", ms: null },
    gen:   { status: "measured", ms: 9000 },
    tool:  { status: "missing", ms: null },
    retry: { status: "unsupported", ms: null },
    tail:  { status: "measured", ms: 700 },
    total: { status: "measured", ms: 9700 }
  }
};

const validation = validateTimingRecord(record);
if (validation.ok) {
  const summary = aggregateTimingRecords([record]);
  console.log(summary.byProvider.minimax.metrics.gen.p50);
}
```
