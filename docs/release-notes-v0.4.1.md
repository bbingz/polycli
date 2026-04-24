# Release Notes Draft - v0.4.1

Status: draft for the external release steps (tag / push / GitHub release / npm publish).

Release date target: 2026-04-24 or later.

Scope: reliability and interface-hygiene pass on top of v0.4.0, driven by a 5-agent audit of the codebase and a full live 8-provider test of the Claude Code host bundle. No breaking changes.

## Highlights

- Aligned every `--json` error path across the host companion so argument, lookup, and validation failures return `{ error, code, ... }` with a stable exit 1, matching the shape consumers already get on success.
- Made `ask` responses report a non-null top-level `model` for all eight providers, with a `defaultModel` fallback when a provider's own stream events do not carry one.
- Flattened `result --json` so a completed job's payload exposes `response`, `ok`, `sessionId`, and `timing` at the top level (like `ask --json`), while still surfacing job metadata under a `job` sub-object.
- Normalized provider CLI availability text so multi-line version banners (notably GitHub Copilot CLI's update notice) no longer break the single-line render in `setup`.
- Subcommand `--help` now short-circuits to Usage instead of being forwarded to the provider CLI as a prompt.
- Tightened `timing` argument validation for `--provider` and `--history`.
- Declared `@bbingz/polycli-utils`, `@bbingz/polycli-timing`, and `@bbingz/polycli-runtime` as private internal bundler inputs so accidental `npm publish` is impossible.
- Codex host plugin and Copilot host plugin now have their own marketplace manifests; `release:check` validates manifests and version alignment across every release artifact in one step.

## User-Facing Changes

- `ask --json`, `rescue --json`, `review --json`, `adversarial-review --json`, `status --json`, `result --json`, `cancel --json`, `timing --json`, and `setup --json` all return structured JSON on every error path, never `Error: ...` text. Existing success payloads are unchanged.
- `result --json` top-level shape now mirrors `ask --json`. Consumers reading `data.response` / `data.sessionId` / `data.timing` no longer need a fallback to `data.result.response`. Job metadata (`jobId`, `createdAt`, `finishedAt`, `status`, `logFile`) lives under `data.job`.
- `setup --json` `availabilityDetail` and `authDetail` are now single-line strings (the first non-empty line of the probed CLI's output); multi-line banners are preserved in logs but not in the rendered summary.
- Every `ask` response (JSON or text) now reports the answering model at the top level. Previously only `qwen` and `copilot` populated this; the other six providers returned `model: null`.
- `polycli-companion.mjs ask --help` (and every subcommand `--help`) now prints Usage immediately and exits 0, without invoking any provider CLI.
- `timing --provider <unknown>` and `timing --history abc` now return structured validation errors instead of an empty record list with exit 0.
- `cancel` no-op return is exit code 1 in both text and JSON mode (previously text exit 3, JSON exit 1).

## Fixes Since v0.4.0

- Host companion
  - `--json` error path: introduced `exitWithError` helper and a `classifyErrorCode` mapping so every error branch (missing provider, unknown provider, invalid scope, invalid history, missing prompt, unknown subcommand, no-completed-job, no-active-job, job-not-found) returns `{ error, code, ... }` + exit 1 when `--json` is set.
  - Subcommand `--help` short-circuit prevents accidental provider CLI invocations.
  - `result --json` envelope flattened to match `ask --json` top-level keys.
  - `cancel` no-op exit code aligned across output modes; `cancel.md` documents the non-zero no-op semantics.
  - `timing --provider <unknown>` now routes through the same `unknown_provider` error as `ask` / `setup` / `health`; `timing --history` rejects non-integers and negative values.
- Provider runtimes
  - All eight provider `ask` responses now surface a top-level `model` field. `claude` / `gemini` / `kimi` / `minimax` / `opencode` / `pi` lift model from their own stream events; `qwen` / `copilot` already populated it and are unchanged.
  - `registry.runProviderPrompt` and `registry.runProviderPromptStreaming` accept an optional `defaultModel` parameter used as the final fallback when no event-based model is emitted. The host supplies this from its cached `getAuthStatus` lookup so users never see `model: null` on a live run.
- Utilities
  - `binaryAvailable` returns the first non-empty line of the probed CLI's stdout / stderr as `detail`, so second-line update banners (copilot) or deprecation notices no longer break `setup`'s single-line rendering. Raw multi-line output remains available on the runtime result object.
- Release artifacts
  - Claude marketplace (`.claude-plugin/marketplace.json`), Codex marketplace (`.agents/plugins/marketplace.json`), and GitHub Copilot marketplace (`.github/plugin/marketplace.json`) all list at version `0.4.1`. Codex host now has its own `pack:codex` script.
  - `scripts/validate-release-manifests.mjs` is wired into `release:check` and fails the release if any host version disagrees with any other.
  - `@bbingz/polycli-utils`, `@bbingz/polycli-timing`, and `@bbingz/polycli-runtime` are now flagged `"private": true` to lock them as internal bundler inputs.

## Test Coverage

- `npm test`: **221/221** pass (up from 211 at v0.4.0).
- New tests: live error-shape assertions for every `--json` error branch; per-provider `model` non-null assertions in fixture replays; `registry.test.js` fallback-path lock for the `defaultModel` contract; `process.test.js` assertion that multi-line `--version` stdout is collapsed to the first non-empty line.
- `npm run release:check` passes end-to-end: manifest validation, marketplace validation, plugin validation, and `@bbingz/polycli-opencode@0.4.1` dry-run publish.
- Live 8-provider smoke (real CLIs, no fixtures) confirms every provider returns a real model in `ask --json`:

  | provider | model |
  |----------|-------|
  | gemini   | gemini-3.1-pro-preview |
  | kimi     | kimi-code/kimi-for-coding |
  | qwen     | qwen3.6-plus |
  | minimax  | MiniMax-M2.7-highspeed |
  | claude   | claude-opus-4-7[1m] |
  | copilot  | gpt-5.4 |
  | opencode | opencode-go/mimo-v2-pro |
  | pi       | openai-codex/gpt-5.4 |

## Notes for Maintainers

- `@bbingz/polycli-opencode` was not published to npm for v0.4.0 despite the tag. The v0.4.1 publish will be the *first real* npm publish of that package; confirm `npm whoami` and `@bbingz` scope access before running `npm publish`.
- Four review artifacts are landing with this release: `docs/review-2026-04-24.md` (main audit), `docs/review-2026-04-24-followup.md` (release-prep follow-ups), `docs/review-2026-04-24-bugs.md` (B1–B8 runtime observations), `docs/review-2026-04-24-b6-spec.md` (standalone B6 spec + verdict).

## Non-Goals / Intentionally Deferred

- `packages/polycli-utils` and `packages/polycli-timing` stay on the internal `1.0.0` line and are not published. External publication of those packages will be a separate, versioned decision.
- `docs/polycli-v1-public-surface.md` still describes the v1 utility-only scope and is now out of date relative to the v0.4.x provider runtimes. A rewrite or supersede banner is tracked as a follow-up, not blocking this release.
- Integration tests in `plugins/polycli/scripts/tests/` still mock child processes; migrating them to captured CLI fixtures (like `packages/polycli-runtime/test/fixtures/`) is tracked for a later iteration.
