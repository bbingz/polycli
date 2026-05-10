# Polycli Observability And Provider Repair Design

## Goal

Make Polycli's local observability trustworthy before using it to drive provider-specific fixes.

## Scope

This is a two-stage repair.

Stage A fixes observability semantics:

- Use a host-neutral durable state root when configured.
- Show the exact state root and workspace slug used by `timing`.
- Let callers request full timing history without guessing a numeric limit.
- Keep aggregate scope explicit so a 20-record view cannot look like all data.
- Carry outcome metadata into timing records where provider results already expose it.
- Classify run-ledger failures from `attempt_result`, not only shallow provider decisions.

Stage B fixes the highest-signal provider issues discovered from the observed data:

- `qwen`: classify max-session-turn exhaustion and adjust ask/review turn budgets where tests prove the current limit is too low.
- `kimi`: do not treat the resume footer alone as a real provider failure when visible output exists.
- `cmd`: classify timeout/termination/tool-surface failures and improve prompt guidance away from unavailable `bash`.
- `opencode`: cache `spawn opencode ENOENT` as unavailable/config failure and keep it out of normal latency interpretation.

`gemini`, `minimax`, and `claude` get better classification and metadata in this pass. Deeper provider behavior changes are follow-up unless covered by a small failing fixture.

## Data Model

`POLYCLI_STATE_ROOT` is the first-choice state root. `CLAUDE_PLUGIN_DATA/state` remains supported for Claude plugin compatibility. The temp fallback remains the final fallback, but commands must disclose when it is used.

Timing records remain schema version 1 for compatibility, with optional fields:

- `outcome`: `ok`, `failed`, `timed_out`, `cancelled`, `config_error`, or `usage_error`
- `exitCode`
- `terminationReason`
- `responseMatched`

Consumers must tolerate old timing records without these fields.

## Command Behavior

`timing --json` returns the current records and aggregate plus metadata:

- `workspaceRoot`
- `workspaceSlug`
- `stateDir`
- `stateRoot`
- `stateRootSource`
- `historyLimit`
- `recordCount`
- `aggregateScope`

`--history all` and `--all` read all available records. Numeric `--history` keeps the current bounded behavior.

`debug runs` summaries include failure classifications derived from attempt results. This lets usage/config/provider/runtime failures be separated without opening raw logs first.

## Testing

Use TDD for every behavior change:

- Add failing tests in `plugins/polycli/scripts/tests/timing.test.mjs` for state-root precedence, `--history all`, and metadata.
- Add failing tests in `packages/polycli-runtime/test/timing.test.js` for optional timing outcome fields.
- Add failing tests in `plugins/polycli/scripts/tests/run-ledger.test.mjs` for failure classification.
- Add provider fixture tests for `qwen`, `kimi`, `cmd`, and `opencode` only where the expected behavior is local and deterministic.

Focused verification comes before full verification:

- `node --test plugins/polycli/scripts/tests/timing.test.mjs`
- `node --test plugins/polycli/scripts/tests/run-ledger.test.mjs`
- `node --test packages/polycli-runtime/test/timing.test.js packages/polycli-runtime/test/registry.test.js`
- `node --test packages/polycli-runtime/test/*.test.js`
- `node --test plugins/polycli/scripts/tests/*.test.mjs`
- `npm test`
- `npm run release:check`

## Non-Goals

- No cross-machine observability service.
- No daemon or server.
- No migration of old timing files.
- No provider-specific broad rewrite.
