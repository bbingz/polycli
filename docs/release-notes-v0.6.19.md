# polycli v0.6.19

Patch on top of `v0.6.18` that adds **upstream session-pollution control** and **provider-drift maintenance hardening** — a spec-driven increment from the 2026-05-29 strategy review, gated by two Codex review rounds. No provider behavior, host command grammar, or timing schema changed; the four-state timing contract and the flat-adapter Path-B stance are intact.

## What changed

### Upstream session/history pollution control (Q9a/Q9b)

When polycli invokes an upstream CLI it cannot prevent that CLI from writing its own session/history files under `$HOME` (`~/.claude/projects`, `~/.gemini`, …), and those accumulate. This release makes polycli-created sessions auditable and cleanable — without ever guessing paths.

- Run-ledger events now carry the upstream `sessionId` and a **verified** `sessionArtifactPath` (recorded only when the artifact exists, is not a symlink, and its realpath stays under the provider's store root). Recorded at the foreground/worker run sites and the job-control recovery path; `null` (never fabricated) where a path is not derivable.
- New `polycli sessions [list | purge --confirm]` command. `list` shows recorded sessions plus tracked-but-not-purgeable ones with a reason; `purge` is **dry-run by default** and deletes only with `--confirm`. Deletion is driven ONLY by recorded, re-validated realpaths (lstat reject-symlink, realpath-under-store-root, exact basename) — never a sessionId-derived guess and never a glob.
- Per-provider derivation is honest: claude (`~/.claude/projects/<cwd '/'→'-'>/<id>.jsonl`) and kimi (`~/.kimi/sessions/<md5(cwd)>/<id>/`) are purgeable; gemini (per-project dir), pi (timestamp-prefixed filenames), and ephemeral providers (minimax/cmd) are reported not-purgeable with a reason rather than silently dropped.

### Provider-drift maintenance hardening (Q8a/Q8b/Q8c)

- **Fixture-staleness check** (`npm run check:fixture-freshness`): warns when a captured fixture's pinned CLI version no longer matches the locally-installed CLI, skips absent CLIs, exits 0 by default / non-zero under `--strict`. Converts the silent false-confidence of a version-pinned fixture into a visible signal.
- **Single review-flag source of truth** (`REVIEW_FLAG_EXPECTATIONS`): the per-provider drift `--help` flags, read-only option key/value, and exact `extraArgTokens` now live in one place. `check-review-cli-drift.mjs` derives its checks from it and `review.mjs` sources its read-only keys from it; a consistency test asserts `extraArgTokens` exactly equals the `--`flags the review constraint builder emits (catches a flag added OR removed). Data co-location, not a `BaseProvider`.
- **Drift gate + local auth-anchor sanity check**: `check:review-drift` is wired into `release:check` (self-skips absent CLIs; blocks only on genuine flag drift). The drift script also confirms the auth-error regex anchor phrase is still present in source — a local guard against a polycli-side refactor dropping it. It does NOT detect upstream CLI wording changes (a real upstream auth-wording probe remains an open follow-up).

## Deferred (roadmap, not shipped)

- **Q8d** — migrate churn-heavy providers (qwen/gemini) off stdout/JSON scraping toward upstream JSON event streams / SDKs. Multi-release effort.
- **Q9c** — opt-in per-run env session isolation. A naive `HOME`/`XDG` override that prevents writes also breaks auth and `--resume`; needs a per-provider design.

## Verification

- `npm test` (453/453, up from 399)
- `npm run release:check` (bundles byte-identical, fixture metadata, host-map 12 capabilities, codex-adapter, no CLI drift, npm pack/publish dry-runs)
- `node scripts/check-fixture-freshness.mjs`, `node scripts/check-review-cli-drift.mjs`
- Two Codex review gates: spec (CHANGES_REQUESTED → revised) and implementation (CHANGES_REQUESTED → fixed → APPROVE)

## Release artifacts

- GitHub release `v0.6.19`
- npm `@bbingz/polycli-opencode@0.6.19`
- npm `@bbingz/polycli@0.6.19`

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`). No schema or utility changes in this slice.
