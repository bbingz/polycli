# polycli v1 Public Surface

## Status

`@bbingz/polycli-utils` and `@bbingz/polycli-timing` are the v1 public surface, published to npm from v0.5.0 onward. `@bbingz/polycli-runtime` and provider adapters live in this repo but remain internal (`private: true`): they are bundled into host plugins and are not part of the v1 npm contract.

The repo now contains provider runtime code for host plugin builds, but that code is outside the v1 public package surface. The public contract is intentionally limited to utility helpers and timing semantics.

## v1 Package Surface

### `@bbingz/polycli-utils`

Stable root exports in v1:

- `parseArgs()`
- `splitRawArgumentString()`
- `runCommand()`
- `runCommandChecked()`
- `binaryAvailable()`
- `formatCommandFailure()`
- `terminateProcessTree()`
- `createLineDecoder()`
- `ensureParentDir()`
- `writeFileAtomic()`
- `writeJsonAtomic()`
- `withLockfile()`
- `LockfileTimeoutError`
- `appendNdjson()`
- `readNdjson()`
- `tailNdjson()`
- `UUID_SESSION_ID_REGEX`
- `matchSessionId()`
- `resolveSessionId()`
- `parseStreamJsonLine()`
- `parseStreamJsonText()`

Stable subpath exports in v1:

- `@bbingz/polycli-utils/args`
- `@bbingz/polycli-utils/process`
- `@bbingz/polycli-utils/stream`
- `@bbingz/polycli-utils/atomic-save`
- `@bbingz/polycli-utils/ndjson`
- `@bbingz/polycli-utils/session-id`
- `@bbingz/polycli-utils/parse-stream-json`

Non-goals for this package:

- provider-specific protocol adapters
- canonical event schemas
- retry/rate-limit/auth logic tied to one provider
- shared session inheritance or runtime orchestration

### `@bbingz/polycli-timing`

Stable root exports in v1:

- `TIMING_SCHEMA_VERSION`
- `TIMING_METRIC_NAMES`
- `TIMING_METRIC_STATUSES`
- `TIMING_RUNTIME_PERSISTENCE`
- `TIMING_MEASUREMENT_SCOPES`
- `TIMING_SCHEMA_URL`
- `readTimingSchema()`
- `validateTimingRecord()`
- `calculatePercentiles()`
- `aggregateTimingRecords()`

Stable subpath exports in v1:

- `@bbingz/polycli-timing/schema`

Stable semantics in v1:

- `unsupported`, `missing`, `zero`, and `measured` are distinct states and must not be collapsed.
- `runtimePersistence` and `measurementScope` are part of the public contract.
- Aggregation is capability-aware and must preserve state distinctions.
- Aggregation also reports per-provider `runtimePersistenceCounts` and `measurementScopeCounts` so mixed request/session/daemon or request/turn/job data is visible instead of silently blended.

## Runtime And Provider Split

`@bbingz/polycli-runtime` is an internal bundler input, not a public npm contract. Provider adapters may change as host plugin needs evolve; do not import them as stable API unless they are explicitly promoted in a future major-version surface document.

This keeps v1 small, testable, and publishable without pretending the provider model is a public framework.
