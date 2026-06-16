# polycli v0.6.24

Patch on top of `v0.6.23` that fixes status wait timeout semantics found by a second real multi-provider release review.

The v0.6.22 Claude behavior remains unchanged: ordinary Claude `ask` / `review` calls use headless `claude -p` with plan/no-tools/no-MCP constraints, while explicit/internal tmux TUI runtime support remains available.

## What changed

### Status wait timeout behavior

- `status --all --wait --json` now exits with status 2 when it times out, matching the `waitTimedOut:true` payload instead of returning shell success.
- Text `status --all --wait` now prints `Timed out waiting for all jobs.` before the running-jobs snapshot.
- `status --wait --timeout-ms <value>` now requires a positive integer; invalid values such as `abc` are rejected instead of becoming `NaN`.
- The existing single-job `status --wait` path uses the same timeout parser and timeout exit-code handling.
- The all-job waiter no longer performs an unused initial status snapshot read.

### Regression coverage

- Added integration coverage for `status --all --wait` timeout in JSON and text modes.
- Added integration coverage for invalid status wait timeout values.
- Hardened the explicit Claude tmux TUI worker regression assertion against missing `timing.meta`.

## Verification

- Second multi-provider release review after v0.6.23: claude, copilot, opencode, pi, cmd, gemini, qwen, minimax, and grok completed; kimi was blocked by quota 403; agy correctly rejected `/review` because it lacks an enforceable read-only plan mode.
- Focused red/green regression command: `node --test --test-name-pattern "status --all --wait|status --wait rejects invalid timeout values|_job-worker preserves explicit claude tmux TUI" plugins/polycli/scripts/tests/integration.test.mjs`.
- `node --test plugins/polycli/scripts/tests/integration.test.mjs` passed 60/60.
- `npm test` passed 516/516.
- `npm run release:check` passed, including bundle/fixture/manifest/host-map/Codex adapter/review-drift checks, Claude plugin validation, and npm pack dry-runs.

## Release artifacts

- GitHub release `v0.6.24`: https://github.com/bbingz/polycli/releases/tag/v0.6.24 (`publishedAt` `2026-06-16T07:26:49Z`)
- npm `@bbingz/polycli-opencode@0.6.24` (`latest`, `time.modified` `2026-06-16T07:28:01.606Z`, shasum `5da8640b1bba6b3da6309bd87692596c9cc8fb34`)
- npm `@bbingz/polycli@0.6.24` (`latest`, `time.modified` `2026-06-16T07:28:13.403Z`, shasum `8a766b320a3f5ed18b6e083ab98b87c6fc753b9e`)

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
