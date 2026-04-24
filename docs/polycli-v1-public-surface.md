# polycli v1 Public Surface

> **Superseded — v0.3 snapshot.** This document describes the v1 scope as it stood in the `@bbingz/polycli-utils` + `@bbingz/polycli-timing` utility-only era. From v0.4.x onward the repo also ships `@bbingz/polycli-runtime` with eight provider adapters (claude / copilot / gemini / kimi / qwen / minimax / opencode / pi). The "v1 does not ship provider adapters" language below is accurate for v0.3 and historical for everything after it.
>
> For the current surface see:
> - `README.md` — provider capability matrix + usage
> - `packages/polycli-runtime/src/registry.js` — the live `RUNTIMES` table
> - `packages/polycli-runtime/src/timing.js` — per-provider timing capability
> - `CHANGELOG.md` — 0.3.0 → 0.4.1 delta and beyond
> - `docs/roadmap.md` R3 — when and how this doc will be rewritten vs. retired
>
> Kept here because `AGENTS.md` and earlier review docs still cite it as the frozen reference point for what the utility packages promised at v1.

## Status (v0.3 snapshot)

`polycli` v1 is a package-and-contract repo, not a provider implementation repo.

What exists today:

- `@bbingz/polycli-utils`
- `@bbingz/polycli-timing`

What does not exist in this repo today:

- `gemini` / `kimi` / `qwen` / `minimax` provider adapters
- a shared provider runtime
- a unified session framework

The four providers appear in proposal docs, examples, and test fixtures because `polycli` is designed for cross-provider companion ecosystems. They are not implemented inside this repository.

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

Stable semantics in v1:

- `unsupported`, `missing`, `zero`, and `measured` are distinct states and must not be collapsed.
- `runtimePersistence` and `measurementScope` are part of the public contract.
- Aggregation is capability-aware and must preserve state distinctions.
- Aggregation also reports per-provider `runtimePersistenceCounts` and `measurementScopeCounts` so mixed request/session/daemon or request/turn/job data is visible instead of silently blended.

## Provider Decision For v1

The provider-adapter answer for `v1` is explicit:

- `v1` does not ship provider adapters in this repository.
- The old provider repos remain external references, not subdirectories to import or rewrite.
- If provider adapters are added later, they should land as separate packages with explicit contracts, instead of being smuggled into `utils` or `timing`.

This keeps `v1` small, testable, and publishable without pretending the provider model is already settled.
