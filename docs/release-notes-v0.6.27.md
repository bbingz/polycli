# polycli v0.6.27

Patch on top of `v0.6.26` that clears the remaining review residuals: release-state doc drift, two validator path/meta contracts, OpenCode exit-2 execution-path coverage, and the MAX_JOBS terminal-job disk leak.

The v0.6.22 Claude behavior remains unchanged: ordinary Claude `ask` / `review` calls use headless `claude -p` with plan/no-tools/no-MCP constraints, while explicit/internal tmux TUI runtime support remains available.

## What changed

### Background job disk-leak (residual)

- `saveState` pruned terminal jobs past `MAX_JOBS` out of the persisted list but never deleted their on-disk artifacts, so the jobs dir grew unbounded as terminal history aged. It now reclaims the result envelope, config file, and log file for every terminal job dropped from the persisted set (active jobs are never pruned). Added `removeJobLogFile` and wired the previously-dead `removeJobFile` export.

### Validator path/meta contracts

- `scripts/validate-fixture-metadata.mjs` now enforces the `docs/capture-fixtures.md` consistency rules: `provider` must match the fixture directory and `name` must match the file stem. Previously a `qwen/stream-success.meta.json` declaring `provider:"claude", name:"wrong-success"` still passed.

### OpenCode exit-2 execution-path coverage

- `runCompanion` is now exported and accepts an injectable spawn, so the exit-2 soft-signal contract is tested at the execution layer (returns the stdout envelope on exit 2; throws with `error.stdout` attached on a hard exit 1), not only via the `isHardCompanionFailure` predicate.

### Release-state doc drift

- `docs/roadmap.md` still said the latest public release was v0.6.24 and that post-v0.6.24 work was "not yet published" in its **Current state** section (only the Snapshot line had been updated). Both the Snapshot line and the Current state section now reflect v0.6.27 with nothing unreleased pending.

## Verification

- Focused RED/GREEN: state disk-reclaim test (dropped terminal job's result/config/log removed, kept + active retained), fixture path/meta mismatch rejections, OpenCode `runCompanion` execution-path return/throw tests.
- `node scripts/validate-fixture-metadata.mjs` ok (17 checked), `node scripts/validate-cc-x-recipes.mjs` ok (9 entries).
- `npm test` and `npm run release:check` green.

## Release artifacts

- GitHub release `v0.6.27`: https://github.com/bbingz/polycli/releases/tag/v0.6.27
- npm `@bbingz/polycli@0.6.27` and `@bbingz/polycli-opencode@0.6.27` (`latest`).

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
