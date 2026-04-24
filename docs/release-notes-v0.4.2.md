# Release Notes Draft - v0.4.2

Status: draft for the external release steps (tag / push / GitHub release / npm publish).

Release date target: 2026-04-24 or later.

Scope: runtime hardening and housekeeping pass on top of v0.4.1. No new features, no breaking changes. Lands two roadmap items (R1 + R2 runtime) and closes the `p2-p3-backlog` branch that had been parked since the v0.4.0 cycle.

## Highlights

- `spawnStreamingCommand` gains `AbortSignal` support, stdout decoder overflow protection, stdin drain handling, and post-settle output suppression. Long-running provider invocations can now be cancelled cleanly.
- Registry prompt duration is now measured with monotonic `performance.now()` instead of wall-clock `Date.now()`, forbidding negative durations under clock adjustment.
- Argument parsing in `@bbingz/polycli-utils` rejects malformed empty booleans, short-option concatenation mistakes, and unterminated quotes instead of silently accepting them.
- Stream JSON parsing in `@bbingz/polycli-utils` recognizes top-level arrays and bare scalar values in addition to objects, so providers that emit non-object stream frames are no longer silently classified as `"blank"`.
- Timing validation rejects invalid numeric bounds.
- `plugins/polycli/scripts/lib/review.mjs` replaces its regex-based YAML scalar extraction with a small private parser that supports plain / single-quoted / double-quoted scalars and explicitly rejects block/folded scalars instead of silently misparsing.
- Review temp directories are now registered for best-effort cleanup on process exit, so long-running hosts no longer accumulate per-review directories in `os.tmpdir()`.

## User-Facing Changes

- Callers of `spawnStreamingCommand` can now pass `signal: AbortSignal` to cancel a subprocess. The abort observes `killGraceMs` before escalating to `SIGKILL`, matching the existing timeout path.
- `--history` and `--provider` validation already tightened in v0.4.1 now has its utils-layer counterpart: `parseArgs` rejects `--bool=` (empty value), `-xVAL` that should have been `-x VAL`, and an unterminated `"..."`-quoted value. Error messages surface the offending flag.
- No slash-command or tool-call surface changes. Every command exposed by the four host plugins continues to work exactly as in v0.4.1.

## Fixes Since v0.4.1

- `packages/polycli-runtime/src/spawn.js`
  - `AbortSignal` input support; abort triggers the same SIGTERM → grace period → SIGKILL path as the existing `timeout` branch.
  - `maxBufferBytes` cap on accumulated stdout; overflow surfaces as an explicit error instead of unbounded memory growth.
  - Decoder error recovery so malformed UTF-8 in a provider's stdout stream no longer crashes the host.
  - Post-settle output is ignored; late stdout / stderr after the subprocess has already resolved no longer mutates the returned result.
  - stdin drain handling for providers that write large prompts to stdin.
- `packages/polycli-runtime/src/registry.js`
  - `runProviderPrompt` / `runProviderPromptStreaming` timing uses `performance.now()`; timing records can no longer surface negative `ms` under clock adjustments.
- `packages/polycli-runtime/src/minimax.js`
  - Hardened log-read failure path (explicit error rather than silent empty result).
- `packages/polycli-runtime/src/*`
  - Provider exit error formatting normalized.
- `packages/polycli-utils/src/args.js`
  - `parseArgs` rejects empty boolean (`--flag=`), short-option concat without separator, and unterminated quoted values.
- `packages/polycli-utils/src/parse-stream-json.js`
  - Recognizes arrays, numeric scalars, booleans, and `null` as valid JSON frames. Previously returned `kind: "blank"` for everything that was not an object.
- `packages/polycli-timing/src/*`
  - Rejects invalid numeric bounds at validation time instead of letting them propagate into aggregation.
- `plugins/polycli/scripts/lib/review.mjs`
  - `readYamlScalar` rewritten as a minimal hand-rolled parser covering plain / single-quoted / double-quoted scalars; rejects block (`|`) and folded (`>`) scalars and malformed lines with an explicit error.
  - `writeReviewTempFile` registers each created directory in a process-exit cleanup set, so long-running hosts no longer leak per-review tmp dirs.

## Branch housekeeping

- The `p2-p3-backlog` branch is closed. Two of its three commits (`ce71bed` and `6da17a2`) were squashed onto main as the R1 commit above; the third (`511fceb`) was dropped as superseded by main's earlier `12d9ca9 fix: host plugin hygiene`.

## Test Coverage

- `npm test`: **250/250** pass (up from 221 at v0.4.1).
- New coverage: AbortSignal cancellation in spawn, stdout overflow cap, decoder error recovery, `performance.now()` timing; `args.js` negative-case parsing; `parse-stream-json` scalar / array / null recognition; `readYamlScalar` supported vs rejected shapes; review tmp cleanup on child-process exit.
- `npm run release:check` passes end-to-end including `@bbingz/polycli-opencode@0.4.2` dry-run publish.

## Notes for Maintainers

- `@bbingz/polycli-opencode@0.4.1` was the first real npm publish of that package. v0.4.2 is a routine version update. `npm view @bbingz/polycli-opencode` should show 0.3.0 / 0.4.0 / 0.4.1 present before the v0.4.2 publish.
- Internal packages (`@bbingz/polycli-utils` / `@bbingz/polycli-timing` / `@bbingz/polycli-runtime`) remain `"private": true` on the `1.0.0` line and are not published. The v0.4.x release line covers host plugins + opencode adapter only.

## Non-Goals / Intentionally Deferred

- R4 (cross-host command map doc), R5 (integration-test fixture migration), R6 (auth-probe regex named contract), R7 (`/review` CLI drift watch script) — all still deferred to v0.5.0 candidates per `docs/roadmap.md`.
- Q1 (publish utils/timing to npm?), Q2 (sustainability of provider-specific model fallbacks), Q3 (four-host surface convergence) — design questions, not in v0.4.x scope.
- No changes to the eight provider runtime surfaces beyond the hardening listed above.
- No changes to timing schema or the four-state semantics (`measured` / `zero` / `missing` / `unsupported`). `performance.now()` is a clock-source swap, not a schema change.
