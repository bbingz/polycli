# polycli v0.6.26

Patch on top of `v0.6.25` that fixes a review-found Grok runtime bug, tightens the cc-X recipe validator, adds execution-layer coverage, and syncs release-state documentation drift.

The v0.6.22 Claude behavior remains unchanged: ordinary Claude `ask` / `review` calls use headless `claude -p` with plan/no-tools/no-MCP constraints, while explicit/internal tmux TUI runtime support remains available.

## What changed

### Grok nested-error detection (High fix)

- `extractTerminalError()` recursed into a nested `error` object but only extracted a message when that object carried a `type:"error"` / `is_error` marker. A real shape like `{text:"partial", error:{message:"permission denied"}}` therefore returned no error, and the visible partial text was wrongly reported as `ok:true`.
- A nested error OBJECT is now treated as a terminal-error signal in its own right: the parser recurses for deeper nesting, then pulls the object's `message`/`data`, and falls back to a generic marker when the object is non-empty but unlabeled. An empty `{}` is still NOT treated as an error (no false positive), and clean successes are unaffected.
- Covers both `parseGrokJsonResult` and `parseGrokStreamText`.

### cc-X recipe validator contract

- `scripts/validate-cc-x-recipes.mjs` now constrains `status` to `verified` / `marketplace-unstable` (non-marketplace entries must be `verified`), so an unlabeled/draft entry no longer passes.
- `docs/roadmap.md` Q10 now states plainly that the validator guards STRUCTURE + source-anchoring (required fields, a `source{url,date}` per entry, the constrained `status`, the marketplace honest-default) — NOT that the endpoints/models are currently accurate, which stays a per-entry `source`-URL re-check.

### Coverage and documentation

- Added a `runQwenPrompt` regression that logs the spawned argv and asserts an explicit `--model` is forwarded end-to-end (previously only the builder layer was covered).
- Added Grok regressions for the nested-error object (json + streaming) and an empty-error-object non-failure.
- Synced release-state docs that still pointed at v0.6.24: `README.md`, `README.zh-CN.md`, `README.ja.md`, and the `docs/roadmap.md` snapshot line.

### Known pre-existing (not fixed here)

- `scripts/validate-fixture-metadata.mjs` does not enforce the `docs/capture-fixtures.md` path/meta consistency rules (provider matches directory, name matches file stem) — a pre-existing Low gap, flagged for a separate change.

## Verification

- Reproduced the Grok bug before the fix (`ok:true`) and confirmed `ok:false` with the error message preserved after, across nested/deep/string/empty/clean shapes.
- Focused: grok + qwen + cc-X validator tests passed (55/55); `node scripts/validate-cc-x-recipes.mjs` ok (9 entries).
- `npm test` and `npm run release:check` green.

## Release artifacts

- GitHub release `v0.6.26`: https://github.com/bbingz/polycli/releases/tag/v0.6.26 (`publishedAt` `2026-06-19T09:03:11Z`)
- npm `@bbingz/polycli-opencode@0.6.26` (`latest`, `time.modified` `2026-06-19T09:02:40.548Z`, shasum `f1e86227af994c281d0fe860c59809b04c103470`)
- npm `@bbingz/polycli@0.6.26` (`latest`, `time.modified` `2026-06-19T09:02:36.670Z`, shasum `b1ec2bcf366f1974e6850c42ca8c3ee81695999a`)

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
