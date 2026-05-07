# polycli v0.6.9

Patch release that closes the post-`v0.6.8` Q6 hardening on top of the shipped background-job ledger plumbing and read-only `polycli tui` inspector. No provider runtime semantics or upstream CLI behavior changed.

## What changed

### Dead-worker scan-on-read terminal event recovery

- `debug runs/show/explain` now refresh job state before reading the run ledger. Background jobs whose worker died after the provider returned but before the ledger write get missing terminal events appended idempotently:
  - `attempt_result` with the recovered `status` (`completed` / `failed` / `cancelled`).
  - `provider_decision` (`adopted` on ok, `failed reason=<kind>_failed` on not-ok, `status=cancelled reason=job_cancelled` on cancellation).
- No-envelope worker exits — the worker died before producing any structured result envelope — are classified as `worker_exited`, distinct from `unfinished` / `unknown`.
- TUI views the recovered ledger like any other run: provider matrix, event timeline, and detail panes always reflect the canonical state.
- Recovery is read-only; the worker is never resurrected, retried, or restarted.

### TUI log file pointers

- `polycli tui` now surfaces deduplicated `logFile` pointers next to per-job entries.
- It does not read or print log contents. Full log viewing (`debug logs`, log streaming pane) remains a deliberate non-goal of this release; a separate redaction and retention spec must land first.

### Host-map guardrail for Terminal CLI docs

- `npm run validate:host-map` now also checks Terminal CLI command cells, side-by-side examples, and terminal-only `polycli tui` documentation, so any future host or terminal command-surface drift fails the host-map gate instead of leaking into a release.

### README command-surface drift cleanup

- `README.md`, `README.zh-CN.md`, and `README.ja.md` opening summaries previously listed only `health, ask, review, rescue, timing`. They now also name `debug`, background-job controls, and terminal inspection so the front matter matches the v0.6.7 + v0.6.8 surface the rest of the README already documents.

## Verification targets

- `npm test`
- `npm run release:check`
- `npm run validate:host-map`
- `npm run validate:manifests`
- `npm run validate:bundles`

## Publish notes

This release adds no new npm package. Same 6 release artifacts as `v0.6.8`:

- GitHub release `v0.6.9`
- npm `@bbingz/polycli-opencode@0.6.9`
- npm `@bbingz/polycli@0.6.9`
- Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.

See `docs/release.md` for the full sequence.
