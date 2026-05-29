# Session handoff — 2026-05-30 (Claude)

Single-snapshot handoff (sibling of `session-memory-2026-04-22.md`). Captures the v0.6.19 increment + strategy context so a fresh session / Codex / human can resume without replaying the conversation.

## Release state (current)

- **v0.6.19 is fully published.** GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.19 (tag → `65ae843`); npm `@bbingz/polycli@0.6.19` and `@bbingz/polycli-opencode@0.6.19` (both `latest`, verified via `npm view`). `main` HEAD = `84621b1`, tree clean.
- Release commits: `65ae843` prepare → `3816d1b` (GitHub published, npm pending) → `84621b1` (npm published).
- Utility packages unchanged on the v1.x line (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`).

## What shipped in v0.6.19

Full detail: `CHANGELOG.md` (top entry) + `docs/release-notes-v0.6.19.md` + the spec `docs/superpowers/specs/2026-05-29-maintenance-and-pollution-design.md`. Summary:

- **Q9a/Q9b — upstream session-pollution control** (the user's #3 pain): run-ledger now records the upstream `sessionId` + a **verified** `sessionArtifactPath` (foreground/worker/recovery sites); new `polycli sessions [list | purge --confirm]` command (dry-run default) that deletes ONLY ledger-recorded, re-validated realpaths — never path-guessing/globbing. New `plugins/polycli/scripts/lib/sessions.mjs`. Non-purgeable providers (gemini/pi/ephemeral) reported with a reason.
- **Q8a/Q8b/Q8c — provider-drift maintenance hardening**: `check:fixture-freshness` (stale-fixture warning), single `REVIEW_FLAG_EXPECTATIONS` map (`packages/polycli-runtime/src/review-flags.js`) with an exact-set consistency test, `check:review-drift` wired into `release:check` + a local auth-regex-anchor sanity check.
- Verification: `npm test` 453/453; `release:check` green. Two Codex review gates (spec `019e73b4` → rev2; implementation `aeec4314` → APPROVE).

## Deferred (roadmap `docs/roadmap.md` Q8d/Q9c — NOT shipped, with reasons)

- **Q8d** — migrate churn-heavy providers (qwen/gemini) off stdout/JSON scraping toward upstream JSON event streams / SDKs. Multi-release effort.
- **Q9c** — opt-in per-run env session isolation. A naive `HOME`/`XDG` override that prevents writes also breaks auth + `--resume`; needs per-provider design.

## Immediate non-blocking follow-up

- **Fixtures are all STALE on this machine** — installed CLIs far exceed the pinned fixture versions (e.g. gemini 0.38.2→0.43.0, claude 2.1.117→2.1.156). `check:fixture-freshness` now flags this; **re-capturing fixtures is a separate increment** that was NOT done in v0.6.19.
- pi sessions are currently NOT purgeable (timestamp-prefixed filenames not derivable from the sessionId alone); honest-skip, would need recording the full realpath at run time to support.

## Strategic context (why this increment)

2026-05-29 multi-agent strategy recon (memory `project_competitive_landscape_and_moat`): polycli's in-Claude-Code + four-state-timing niche is unoccupied; CLI-wrapping moat widened by the Anthropic subscription-block policy; the maintenance burden's root cause is ecosystem heterogeneity (intrinsic, manageable not eliminable) — which validates Path B rather than refuting it.

## Process note

This increment used the **explicit-drive delivery mode** (Claude writes spec + drives parallel sub-agent waves + integrates; Codex reviews at the spec and implementation gates). See memory `feedback_claude_reviews_codex_implements` (explicit-override mode) and `feedback_release_ops_gotchas` (gh-authed / npm-logged-out release split).
