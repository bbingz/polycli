# polycli v0.6.16

Patch on top of `v0.6.15` that adds `agy` (Google Antigravity CLI 1.0.0) as the tenth polycli-managed provider, alongside the existing claude / copilot / opencode / pi / cmd / gemini / kimi / qwen / minimax surface.

## What changed

- Added a new runtime adapter at `packages/polycli-runtime/src/agy.js`. Mirrors the text-only `cmd` adapter shape and the claude-style session flags (`-c` / `--conversation <id>` / `--add-dir` / `--sandbox`); YOLO is mapped to `--dangerously-skip-permissions` (matches the per-provider YOLO default standardized in v0.6.12).
- Wired the new provider into `PROVIDER_IDS`, the `RUNTIMES` registry, the `TIMING_SUPPORT` table, and the timing event-text extractor. `TIMING_SUPPORT.agy = { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" }`; agy never surfaces a session id, so `buildTimingMeta` correctly stamps `sessionIdMissing: true` on every run instead of fabricating one.
- `runtimePersistence` stays `session` (agy retains conversations server-side and can be resumed via `--continue` / `--conversation <id>`), but `model` is left `null` because agy does not expose the model identifier in print mode.
- `/review --provider agy` is refused upfront. `plugins/polycli/scripts/lib/review.mjs` adds `REVIEW_UNSUPPORTED_PROVIDERS = new Set(["agy"])` and an `assertReviewProviderSupported` gate that throws a clear "no non-interactive plan mode" error. The drift watcher (`scripts/check-review-cli-drift.mjs`) carries the agy row with `expect: []` so future plan-mode additions are picked up.
- Updated host wiring across Claude commands, Codex / Copilot skills, the OpenCode adapter, and the standalone terminal companion. README SVG header now reads "ten provider CLIs"; `host-command-map.md` adds an agy column with `/review` explicitly marked unsupported.
- Updated `validate-codex-adapter.mjs` to accept agy in the provider routing reference so the Codex skill guidance keeps in sync.
- New focused tests at `packages/polycli-runtime/test/agy.test.js` (13 cases) plus extensions to registry / exports / preview / prompt-runtime / providers / review / integration test files.

## Verification

- `node --test packages/polycli-runtime/test/agy.test.js` exit 0 (13/13).
- `npm test` exit 0 (392/392, up from 374 in v0.6.15).
- `npm run check:provider-paths` exit 0 — 8 ok + agy ok + pi skipped on local timeout (no drift detected against the locked flag set).
- `npm run release:check` exit 0 (full tests, bundles, fixtures, manifests, host-map, codex-adapter, claude plugin validate ×2, npm pack dry-runs).
- agy self-reviewed commit `a836fa1` against the four-state timing / YOLO / Path B / review-refusal / plain-text-stdout invariants and returned `VERDICT: PASS` with one nit (transient probe optimistic fall-through — known polycli-wide design, also used by pi/cmd).

## Release artifacts

- GitHub release `v0.6.16`
- npm `@bbingz/polycli-opencode@0.6.16`
- npm `@bbingz/polycli@0.6.16`

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`). No schema or utility changes in this slice.
