# Changelog

Flat, reverse-chronological log for cross-AI collaboration (Claude / Codex / Gemini / etc.).
Format: `## YYYY-MM-DD — author — headline` followed by bullets.
Separate from `docs/release.md` (release-focused) and `docs/session-memory-*.md` (single handoff snapshot).

---

## 2026-04-22 — Claude — Verdict on commit 95b003c (Group 2 + 3 complete)

- Appended verdict A to [docs/review-fb64b1e.md](docs/review-fb64b1e.md): atomic-save durability + `/review` CLI hard constraints both landed; `npm test` 171/171.
- Codex's Phase 1 research ([docs/review-cli-flags.md](docs/review-cli-flags.md)) corrected 4 of 6 CLI-flag hypotheses from the original review against locally installed CLIs + primary sources.
- Non-overridable review constraint decision documented and enforced via `assertNoReviewConstraintOverride`.
- Original review P0/P1 scope now 100% closed. P2/P3 move to release backlog.

## 2026-04-22 — Claude — Verdict on commit 6636b7a + Group 2/3 instructions

- Appended verdict to [docs/review-fb64b1e.md](docs/review-fb64b1e.md): Group 1 landed cleanly (P1-C / P1-D / P1-E / registry gemini branch), 152/152 tests passing.
- Group 2 (atomic-save durability) and Group 3 (/review CLI hard constraints) now have concrete per-file fix specs appended to the same doc, including test plans and scope guards.
- Group 3 requires a Phase 1 research pass (per-provider CLI flag verification) before Phase 2 code changes; suggested output is a short memo at `docs/review-cli-flags.md`.

## 2026-04-22 — Claude — Follow-up review of commit fb64b1e

- Authored [docs/review-fb64b1e.md](docs/review-fb64b1e.md): verdict A- on Codex's fix batch.
- All 6 P0 items fixed with correct semantics + 23 new regression tests (npm test: 146/146).
- P1 fixed: A (transient probe), B (session-id fall-through), G (jobs/<id>.json locking), H (stdout-as-error paths).
- P1 deferred for next batch: C (generic event.text fallback), D (copilot/opencode type:"error" capture), E (gemini hasVisibleText), F (atomic-save fsync), I (/review CLI hard constraints), plus registry `isTerminalSummaryEvent` gemini branch.
- Recommended next-commit grouping: Group 1 (streaming parser consistency = C+D+E+registry); Group 2 (atomic-save durability = F); Group 3 (/review constraints = I).

## 2026-04-22 — Claude — Full implementation review (for Codex handoff)

- Authored [docs/review-2026-04-22.md](docs/review-2026-04-22.md): 4-agent parallel review across utils+timing, runtime core, 8 provider adapters, and host plugin (~5,200 LoC source, ~117 raw findings).
- Report is structured as P0 (6 ship blockers) → P1 (9 high-risk themes) → P2 (parser / timing / process / host grouped) → P3 (gaps and nits).
- Flagged one runtime-core agent recommendation to REJECT: `timing.js:66, 73` hardcoding `cold` / `retry` as `unsupported` is correct per the documented project decision; do not change to `missing`.
- No source code touched; review doc only.

## 2026-04-22 — Claude — Repo onboarding scaffolding

- Added `CLAUDE.md` at repo root: thin Claude-Code-specific patches layered on top of `AGENTS.md` (architecture boundary, test command priority, provider gotchas).
- Added this `CHANGELOG.md` to satisfy cross-AI collaboration convention from the user's global rules.
- Seeded project memory under `~/.claude/projects/-Users-bing--Code--polycli/memory/` with `MEMORY.md` index and layered entries (user / project / feedback / reference).
- No source code touched; no tests run (docs/infra only).
