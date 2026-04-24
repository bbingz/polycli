# Release Notes Draft - v0.5.0

Status: draft for the external release steps (tag / push / GitHub release / **three** npm publishes).

Release date target: 2026-04-24 or later.

Scope: first public npm publish of the utility packages, runtime hardening through named contracts, and a pilot for host-side real-fixture integration tests. No breaking changes to host plugins. Minor version bump justified by the new public npm surface (utils + timing).

## Highlights

- **`@bbingz/polycli-utils@1.0.0` and `@bbingz/polycli-timing@1.0.0` are now public npm packages.** Third parties can build their own host adapters without re-bundling polycli internals.
- Auth-probe transient-error detection across five providers (`gemini` / `qwen` / `kimi` / `opencode` / `pi`) now reads from a named, exported `TRANSIENT_PROBE_ERROR_PATTERNS` constant per provider instead of inline regex literals.
- Claude host integration tests for `/ask` and `/health` success paths now replay real captured CLI output instead of mocking `child_process`. One-provider pilot; other seven providers stay on the mock path for now.
- `release:check` is now idempotent — already-published package versions fall back to `npm pack --dry-run`, unpublished versions use `npm publish --dry-run`. No more "can't repeat a release check after shipping once" friction.

## User-Facing Changes

- **New install path for library users**: `npm install @bbingz/polycli-utils` and `npm install @bbingz/polycli-timing` are now live. See `docs/polycli-v1-public-surface.md` for the stable export list and semver policy.
- **No host plugin surface change.** All ten slash-commands / skill subcommands / tool functions behave exactly as in v0.4.2.
- **No runtime public API change.** `@bbingz/polycli-runtime` stays internal-only (`private: true`); it is still bundled into host plugins, not published.

## Fixes And Changes Since v0.4.2

- `packages/polycli-utils/package.json`, `packages/polycli-timing/package.json`
  - Removed `"private": true`.
  - Added full npm metadata (`description`, `license`, `repository`, `homepage`, `keywords`, `files`, `publishConfig`).
  - Each package now carries a refreshed `README.md` covering exports and semver policy.
- `packages/polycli-runtime/package.json`
  - Unchanged. Stays `"private": true` per the architectural boundary.
- `packages/polycli-runtime/src/gemini.js`, `qwen.js`, `kimi.js`, `opencode.js`, `pi.js`
  - Inline transient-error regex literals extracted into module-level `TRANSIENT_PROBE_ERROR_PATTERNS` arrays, exported for testability.
  - No behavior change: same regex patterns, same auth-probe decision logic. Adds a lock against silent drift if an upstream CLI changes its transient-error wording.
- `packages/polycli-runtime/test/gemini.test.js`, `qwen.test.js`, `kimi.test.js`, `opencode.test.js`, `pi.test.js`
  - Added assertions that `TRANSIENT_PROBE_ERROR_PATTERNS` is populated, that matching patterns keep `loggedIn=true` with `reason: inconclusive`, and that explicit `401 Unauthorized` is treated as a genuine auth failure.
- `plugins/polycli/scripts/tests/integration.test.mjs`
  - Claude `/ask` success path and new `/health` success path read captured CLI stream from `plugins/polycli/scripts/tests/fixtures/claude/ask-ok.stream.txt` / `health-ok.stream.txt` via a new replay helper.
  - Other seven providers unchanged (still mock-based). Fan-out to remaining providers is tracked for a later release.
- `docs/polycli-v1-public-surface.md`
  - Removed the "Superseded" banner added during v0.4.1. The doc is once again a live contract, scoped explicitly to utils + timing; runtime is explicitly not in the v1 public surface.
- Root `package.json`
  - Added `pack:utils` and `pack:timing` scripts mirroring `pack:opencode`.
  - `release:check` now validates three publishable packages repeatably: unpublished versions go through `npm publish --dry-run`, already-published versions fall back to `npm pack --dry-run`. This removes the old failure mode where re-running `release:check` post-ship would trip on "cannot publish over existing version".

## Test Coverage

- `npm test`: **256/256** pass (up from 250 at v0.4.2).
- New coverage: per-provider `TRANSIENT_PROBE_ERROR_PATTERNS` assertions (5 providers × 2-3 cases each); host-level claude `/ask` fixture replay; host-level claude `/health` fixture replay; missing-fixture error surface check (explicit message when stream file is absent).
- `npm run release:check`: passes end-to-end including dry-run verification of `@bbingz/polycli-opencode@0.5.0`, `@bbingz/polycli-utils@1.0.0`, and `@bbingz/polycli-timing@1.0.0`.

## Notes for Maintainers

- This release requires **three** `npm publish` runs at ship time, not one:
  - `npm publish ./plugins/polycli-opencode --access public` (0.4.2 → 0.5.0)
  - `npm publish ./packages/polycli-utils --access public` (first publish, 1.0.0)
  - `npm publish ./packages/polycli-timing --access public` (first publish, 1.0.0)
- Confirm `npm whoami` shows the `@bbingz` scope owner before running any of the three, and note that `@bbingz/polycli-utils` and `@bbingz/polycli-timing` are first-time publishes — a 404 on the initial `PUT` is the same token-not-recognized pattern that caught the v0.4.1 opencode publish; run `npm login` first if needed.
- Post-ship, `npm view @bbingz/polycli-utils versions` should show `1.0.0`; same for `polycli-timing`. `polycli-opencode` should show `0.3.0 / 0.4.0 / 0.4.1 / 0.4.2 / 0.5.0`.

## Non-Goals / Intentionally Deferred

- Fan-out of the Claude-only fixture pilot to the other seven providers (roadmap R5 follow-up).
- Q2 (model fallback sustainability) and Q3 (four-host surface convergence) remain in "observe, do not act" state per user direction on 2026-04-24; see `docs/roadmap.md`.
- `@bbingz/polycli-runtime` stays private. Publishing the runtime is out of scope for v0.5.0 and not currently planned.
- No timing schema or four-state semantics changes. The `TRANSIENT_PROBE_ERROR_PATTERNS` refactor is a naming and export change, not a policy change.
