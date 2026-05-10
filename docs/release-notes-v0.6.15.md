# polycli v0.6.15

Patch on top of `v0.6.14` that makes polycli's own observability reliable after several days of real host usage exposed split state roots, truncated timing views, and opaque provider failures.

## What changed

- Added `POLYCLI_STATE_ROOT` as the explicit shared state root override. It takes precedence over `CLAUDE_PLUGIN_DATA/state`; the temp fallback remains only for hosts that provide neither.
- Added `timing --all` and `--history all` so operators can inspect full timing history instead of the default 20-record view.
- Added timing JSON metadata: state root, state root source, workspace root/slug, history limit, aggregate scope, provider filter, and returned record count.
- Extended timing records with outcome diagnostics: `outcome`, `exitCode`, `terminationReason`, `responseMatched`, and `errorCode`.
- Added run-ledger failure classification and summary counts for failed attempts. `debug explain` now includes attempt failure classes instead of showing only provider decisions.
- Hardened observed provider failure modes:
  - qwen max-session-turns becomes `qwen_max_session_turns`.
  - kimi resume footer exits with visible assistant text are treated as successful responses.
  - missing binaries become `binary_missing`.
  - no visible text becomes `no_visible_text`.
  - provider result errors keep a structured `errorCode` for timing and ledger consumers.

## Verification

- Focused TDD slices covered timing store metadata, `timing --all`, timing outcome fields, run-ledger failure classification, and provider-specific failure classes.
- `npm test` passed with 374/374 tests.
- `npm run release:check` passed before publishing. This includes full tests, bundle validation, fixture metadata validation, release manifest validation, host-map validation, Codex adapter validation, Claude plugin validation, and npm dry-run/pack checks.
- `git diff --check` passed.

## Release artifacts

- GitHub release `v0.6.15`
- npm `@bbingz/polycli-opencode@0.6.15`
- npm `@bbingz/polycli@0.6.15`

Utility packages stay on the independent v1.x cadence. `@bbingz/polycli-timing` remains `1.0.1`; its schema file is bundled into the host and terminal release.
