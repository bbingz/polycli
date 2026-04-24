# Changelog

Flat, reverse-chronological log for cross-AI collaboration (Claude / Codex / Gemini / etc.).
Format: `## YYYY-MM-DD — author — headline` followed by bullets.
Separate from `docs/release.md` (release-focused) and `docs/session-memory-*.md` (single handoff snapshot).

---

## 2026-04-24 — Claude — prepare v0.4.2 release

- Bumped the four host plugin release manifests and both host marketplace metadata entries from `0.4.1` to `0.4.2`.
- Drafted `docs/release-notes-v0.4.2.md` covering the R1 (spawn cancellation / arg parsing / stream JSON scalars / performance.now timing) and R2 (review.mjs YAML scalar + tmp cleanup) roadmap closures.
- `release:check` passes end-to-end: 250/250 tests, manifest validation, plugin validation, `@bbingz/polycli-opencode@0.4.2` dry-run publish.

---

## 2026-04-24 — Codex — harden review config parsing and temp cleanup

- Replaced MiniMax review config scalar extraction with a small private parser that supports plain, single-quoted, and double-quoted scalars while rejecting unsupported block/folded and malformed YAML forms.
- Registered review temp files for best-effort cleanup on process exit so generated per-review config directories do not accumulate across long-running hosts.
- Added regression coverage for supported scalar forms, unsupported block scalars, malformed config lines, comment handling, and child-process exit cleanup.

## 2026-04-24 — Codex — land P2/P3 runtime backlog hardening

- Landed the surviving `p2-p3-backlog` runtime commits as one squash: `spawnStreamingCommand` now supports AbortSignal cancellation, stdout decoder overflow protection, stdin drain handling, and post-settle output suppression.
- Hardened runtime reliability around MiniMax log-read failures, provider exit error formatting, and registry timing by switching prompt duration measurement to monotonic `performance.now()`.
- Tightened shared utility and timing edge cases: argument parsing rejects malformed empty booleans / unterminated quotes, stream JSON parsing recognizes arrays and bare scalar values, and timing validation rejects invalid numeric bounds.

## 2026-04-24 — Claude — add provider capability matrix and supersede v1 surface doc

- Added a provider capability matrix to root `README.md` (streaming / sessionResume / structuredOutput / ttft / gen / tail / tool) sourced from `packages/polycli-runtime/src/registry.js`. Surfaces `minimax`'s session-resume / structured-output / streaming-timing limits in the root doc instead of only in `plugins/polycli-opencode/README.md`, and explains why `qwen`'s `tool: "missing"` is semantically distinct from the other seven providers' `tool: "unsupported"`.
- Prepended a Superseded banner to `docs/polycli-v1-public-surface.md` (v0.3 snapshot) pointing to the live surface sources (`README.md`, `registry.js`, `timing.js`, `CHANGELOG.md`, `docs/roadmap.md`). Content below the banner is preserved as historical reference.
- Updated `CLAUDE.md` Must-read list: added `docs/roadmap.md`, relabeled the v1 surface doc as a v0.3 snapshot / not a live constraint. Closes roadmap R3 (Path B) and R2 (minimax matrix).

---

## 2026-04-24 — Claude — v0.4.1 shipped

- Pushed `main` + tag `v0.4.1` (HEAD at eaddbbd).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.4.1 (notes from `docs/release-notes-v0.4.1.md`).
- npm: `@bbingz/polycli-opencode@0.4.1` published. Earlier suspicion that v0.4.0 had never reached npm was a token-expired false positive; `npm view` confirms 0.3.0 / 0.4.0 / 0.4.1 all present.
- Closes the review loop that began with `docs/review-2026-04-24.md`. All 8 bugs from `docs/review-2026-04-24-bugs.md` (B1–B8) plus FU1–FU3 release-prep follow-ups landed. 221/221 tests pass at release tag.

---

## 2026-04-24 — Codex — lift ask response model to top level for all providers

- Six provider runtimes (claude / gemini / kimi / minimax / opencode / pi) now populate the top-level `model` field on ask results, matching qwen and copilot.
- Added a `defaultModel` pass-through in the registry so the host companion can supply a cached `getAuthStatus` value as a final fallback when the provider's own events do not carry a model.
- Per-provider fixture and fallback assertions lock the new contract; integration smoke tests assert non-null `model` for all 8 providers.

---

## 2026-04-24 — Codex — fix observed host-companion bugs

- Normalized provider CLI availability details to the first non-empty line so multi-line version banners no longer break `setup` text rendering.
- Made `--json` errors structured for argument and lookup failures, added subcommand `--help` short-circuiting, and validated `timing --provider` / `--history` inputs.
- Aligned `cancel` no-op exit behavior and flattened `result --json` so completed job payloads expose `response`, `ok`, `sessionId`, and `timing` at the top level while retaining `job` metadata.

---

## 2026-04-24 — Codex — prepare v0.4.1 release

- Bumped the four host plugin release manifests and host marketplace metadata from `0.4.0` to `0.4.1`, while keeping internal workspace packages on the `1.0.0` line.
- Marked `@bbingz/polycli-utils` and `@bbingz/polycli-timing` as private internal bundler inputs, matching `@bbingz/polycli-runtime`.
- Removed the Copilot adapter from the Claude marketplace now that Copilot has its own marketplace, and kept release manifest validation wired into `release:check`.

## 2026-04-24 — Codex — fix pi duplicate terminal text and pin default model

- Fixed the pi JSON stream parser so visible assistant text is sourced from `text_delta` when present, with terminal `message_end` / `turn_end` / `agent_end` text only used as a fallback; this removes the repeated final-answer concatenation seen in live pi runs and saved fixtures.
- Pinned the default pi model to `openai-codex/gpt-5.4` so host-driven `ask` calls no longer depend on whatever ambient pi config happens to select.
- Updated pi fixture expectations and added focused regression coverage for both the duplicate-terminal-summary case and the default-model invocation contract.

## 2026-04-24 — Codex — harden ask-path visibility for qwen and kimi

- Added prompt-runtime constraints for prompt-bearing commands so `ask` now applies the missing host-level visibility guards: `kimi` gets `--no-thinking --max-steps-per-turn 1`; `qwen` gets `--max-session-turns 1` plus a forced visible-final-answer system prompt.
- Added focused regression coverage for those ask-path constraints and the shared helper that computes them, closing the gap where `/review` was hardened but `/ask` was still unconstrained.
- Extended fake provider integration fixtures so qwen/kimi can simulate thought-only output when constraints are absent; this makes the failure mode observable in CI instead of only via live session history.
- Verification on `main`: `npm test` passed `191/191`; live non-Claude smoke (`gemini`, `kimi`, `qwen`, `minimax`, `copilot`, `opencode`, `pi`) all returned successful `setup` + `ask`, with `qwen`/`kimi` now producing visible final `OK` through `polycli`.

## 2026-04-22 — Claude — v0.4.0 shipped

- Pushed `main` + tag `v0.4.0` (HEAD at 08f84c3).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.4.0 (notes from `docs/release-notes-v0.4.0.md`).
- npm: `@bbingz/polycli-opencode@0.4.0` published; `npm view` confirms no propagation lag.
- Closes the review loop that began with `docs/review-2026-04-22.md`. All P0/P1 from that review plus P3 fixture migration landed. 185/185 tests pass at release tag.

## 2026-04-22 — Claude — Group 4 / 5 / release specs for Codex

- Appended three spec sections to [docs/review-fb64b1e.md](docs/review-fb64b1e.md):
  - Group 4: P2 host-plugin hygiene (appendPreview O(n²), previewText emoji, auto-scope shallow-clone diagnostics) — one-commit batch.
  - Group 5: real-CLI saved-stdout fixture migration (per-provider capture list, replay helper design, scope guards against running capture in CI).
  - Release checklist: v0.4.0 step-by-step with explicit Codex / user / Claude role split for each step.
- Created [tasks/lessons.md](tasks/lessons.md) with the "stay in reviewer role" correction — do not slip into implementation mode when the division of labor is Claude-reviews-Codex-implements.

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
