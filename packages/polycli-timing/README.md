# @bbingz/polycli-timing

Capability-aware timing schema, validation, percentile calculation, and aggregation for comparing AI CLI providers without pretending every provider supports the same measurements. This package is not a provider framework: it does not run CLIs, parse provider protocols, manage sessions, or define a shared runtime.

## Install

```sh
npm install @bbingz/polycli-timing
```

## Root Exports

The root export mirrors `src/index.js`:

- `TIMING_SCHEMA_VERSION`
- `TIMING_METRIC_NAMES`
- `TIMING_METRIC_STATUSES`
- `TIMING_RUNTIME_PERSISTENCE`
- `TIMING_MEASUREMENT_SCOPES`
- `TIMING_SCHEMA_URL`
- `readTimingSchema`
- `validateTimingRecord`
- `calculatePercentiles`
- `aggregateTimingRecords`

## Subpath Exports

- `@bbingz/polycli-timing/schema`

## Semantics

- `unsupported`, `missing`, `zero`, and `measured` are distinct states and must not be collapsed.
- `runtimePersistence` distinguishes `ephemeral`, `session`, and `daemon` runtimes.
- `measurementScope` distinguishes `request`, `turn`, and `job` measurements.
- Aggregation preserves capability-aware metric summaries plus `runtimePersistenceCounts` and `measurementScopeCounts`.

## Example

```js
import {
  validateTimingRecord,
  aggregateTimingRecords,
} from "@bbingz/polycli-timing";
```

## Semver Policy

v1.x is the first stable line. Additive exports and backward-compatible schema/aggregation behavior are minor releases. Removing exports, changing documented output shapes, or collapsing the four metric states requires a major version.

The authoritative v1 surface reference is [docs/polycli-v1-public-surface.md](../../docs/polycli-v1-public-surface.md).
