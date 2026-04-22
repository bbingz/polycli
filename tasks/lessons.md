# Lessons

Patterns the user has corrected me on. Oldest first.

---

## 2026-04-22 — Stay in reviewer/spec role for polycli work; delegate implementation to Codex

The division of labor in this repo is **explicit**: Claude does code review and writes actionable specs, Codex executes the code changes. After reviewing commits 6636b7a and 95b003c, when the user said "全做吧" for the four follow-up items (doc commits, P2 host-plugin fixes, fixture migration, v0.4 release), I pivoted into implementation mode and started reading/planning edits to `polycli-companion.mjs` and `review.mjs` myself.

The user stopped me with "怎么变成你做了？发指令给 codex 做啊."

**Rule:** for work on this repo, default to producing fix specs (file:line, proposed diff shape, test plan, scope guards) and hand them to Codex via `docs/review-*.md` entries. Only do hands-on implementation when the user explicitly asks me to write code, or when the change is a doc / memory / config file that doesn't touch runtime behavior.

**How to recognize the boundary:**
- Commits to source files in `packages/*/src` or `plugins/*/scripts` → Codex's turn.
- Appending to `docs/review-*.md`, writing `CHANGELOG.md`, updating memory, committing doc files, running `npm test` for verification → fine for me.
- `git commit` for docs is fine; `git commit` that touches runtime code is Codex's.
- Running `npm run release:check` to report results is fine; actually tagging / pushing / publishing needs user confirmation regardless.

When in doubt: write the spec first, ask if they want me to execute, don't assume "全做" means "you execute all of it."
