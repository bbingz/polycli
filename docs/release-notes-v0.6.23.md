# polycli v0.6.23

Patch on top of `v0.6.22` that ships the control-plane fixes found by a real full-provider Polycli smoke review after the Claude print-default release.

The v0.6.22 Claude behavior remains unchanged: ordinary Claude `ask` / `review` calls use headless `claude -p` with plan/no-tools/no-MCP constraints, while explicit/internal tmux TUI runtime support remains available.

## What changed

### Health probe env hydration

- `health --provider opencode` now hydrates prompt runtime options before probing, so injected `OPENCODE_CONFIG_CONTENT` no longer replaces the parent environment.
- This preserves `PATH` and removes false `spawn opencode ENOENT` health failures when `opencode` is available on PATH.
- The deny-all OpenCode config remains injected for constrained prompt/review flows.

### All-job wait semantics

- `status --all --wait` now waits until every active job in the workspace reaches a terminal state, then returns the normal all-job status snapshot.
- JSON output includes `waitTimedOut`; text output exits with status 2 on timeout, matching the existing wait failure style.

### Regression coverage

- Added an opencode health regression that verifies both `OPENCODE_CONFIG_CONTENT` injection and PATH preservation.
- Added a `status --all --wait` regression with two concurrent background jobs.
- Added companion worker coverage for the explicitly retained Claude `executionMode: "tmux-tui"` runtime path.

## Verification

- Full-provider smoke review against `v0.6.22`: claude, copilot, opencode, pi, cmd, gemini, qwen, minimax, and grok completed; kimi was blocked by quota 403; agy correctly rejected `/review` because it lacks an enforceable read-only plan mode.
- Focused red/green regression command: `node --test --test-name-pattern "health preserves PATH|status --all --wait|_job-worker preserves explicit claude tmux TUI|review runs claude print mode" plugins/polycli/scripts/tests/integration.test.mjs`.
- Live opencode health probe after the fix returned `ok:true` with `healthyProviders:["opencode"]`.
- `node --test plugins/polycli/scripts/tests/integration.test.mjs` passed 58/58.
- `npm test` passed 514/514.
- `npm run release:check` passed, including bundle/fixture/manifest/host-map/Codex adapter/review-drift checks, Claude plugin validation, and npm pack dry-runs.

## Release artifacts

- GitHub release `v0.6.23`: https://github.com/bbingz/polycli/releases/tag/v0.6.23 (`publishedAt` `2026-06-16T06:44:46Z`)
- npm `@bbingz/polycli-opencode@0.6.23` (`latest`, `time.modified` `2026-06-16T06:49:58.445Z`, shasum `96a99bb18f69fd40dd8a3c78506311fc89b0d0d7`)
- npm `@bbingz/polycli@0.6.23` (`latest`, `time.modified` `2026-06-16T06:50:22.282Z`, shasum `02d016850b5998eabb2bb3faefa6c12ca7e4bfcc`)

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
