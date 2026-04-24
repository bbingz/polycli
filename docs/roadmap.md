# Roadmap

Snapshot: 2026-04-24 (post-v0.4.1).

This file lives next to `docs/release.md` (what's shipped) and `CHANGELOG.md` (what happened). It answers the complementary question: **what's open, how it's prioritized, and what we're deliberately not doing.**

Living document — update when items land, when priorities shift, or when a deferred item becomes urgent. New reviewers: read this **and** the latest `docs/review-*.md` to understand context before acting.

---

## Current state

- Last ship: **v0.4.1** @ `eaddbbd` — see `docs/release-notes-v0.4.1.md`.
- Tests: **221/221** pass; `release:check` end-to-end green.
- 8 providers shipped (claude / gemini / kimi / qwen / minimax / copilot / opencode / pi).
- 4 host plugins (polycli / polycli-codex / polycli-copilot / polycli-opencode), each with an independent marketplace manifest.
- Path B architectural stance is intact: `@bbingz/polycli-utils` / `@bbingz/polycli-timing` / `@bbingz/polycli-runtime` are internal bundler inputs (`private: true`); provider modules are flat, not inherited; timing four-state semantics preserved.

---

## Short-term (v0.4.2 candidates — not blocking anything, but "ready to go")

### R1 — Land the surviving `p2-p3-backlog` commits

The branch `p2-p3-backlog` has three commits never merged to main. Subagent audit on 2026-04-24 (see conversation history) concluded:

- `511fceb fix: P2 host-plugin hygiene` → **DROP** (superseded by main's earlier `12d9ca9 fix: host plugin hygiene`; implementations are equivalent).
- `ce71bed fix: harden runtime reliability and error semantics` → **MERGE**. Adds `AbortSignal` / `maxBufferBytes` / decoder error recovery to `packages/polycli-runtime/src/spawn.js`; switches registry timing from `Date.now()` to `performance.now()` to forbid negative durations. None of this exists on main.
- `6da17a2 fix: harden utils and timing edge cases` → **MERGE**. Adds `args.js` bounds (empty boolean, short-option concat, unterminated quote), makes `parse-stream-json` recognize arrays / scalars / null (currently returns `kind: "blank"` for everything non-object), adds numeric-bounds validation in timing. None of this exists on main.

**Action:** rebase `p2-p3-backlog` onto main (511fceb should drop as empty), cherry-pick the remaining two as a single PR titled something like `fix: P2/P3 backlog — spawn cancellation, arg parsing, stream JSON scalars`. Delete the branch after merge.

**Scope guard:** do not bundle other backlog items into this PR. Keep it to exactly the two commits so the review surface matches the audit.

### R2 — Housekeeping nits inherited from earlier reviews

Single-PR candidates, each is a few lines:

- `plugins/polycli/scripts/lib/review.mjs` — `readYamlScalar` uses regex for `api_key` / `api_base` / `model` / `provider`. Multi-line values or unusual quoting would slip through. Flagged in `docs/review-fb64b1e.md:196` as "carry forward when MiniMax flow is next touched."
- `writeReviewTempFile` creates `mkdtempSync` directories with no process-exit cleanup. Long-running hosts accumulate per-review dirs in `os.tmpdir()`. `process.on("exit", ...)` cleanup or a tmp-registry is sufficient. Flagged in same doc.
- `minimax` `sessionResume: false` is surfaced only in `plugins/polycli-opencode/README.md`. Add a capability matrix to the root `README.md` so users of the other three hosts see it without runtime probing. (Was P4 in `docs/review-2026-04-24-followup.md`.)

### R3 — `polycli-v1-public-surface.md` rewrite or supersede

That doc states "v1 does not ship provider adapters" and "a shared provider runtime does not exist", both contradicted by current code. Two paths:

- **A:** rewrite it to reflect v0.4.x (document the runtime's stable exports).
- **B:** prepend a `> **Superseded.** See CHANGELOG entries for 0.3.0 → 0.4.1 and beyond.` banner and freeze it.

Either is fine. Path A is more work but produces a real contract doc; Path B is ten minutes and removes the contradiction. CLAUDE.md references this file as "已冻结的对外 API 面" — the reference must be updated to match whichever path is chosen. (Was P2 in `docs/review-2026-04-24-followup.md`.)

---

## Medium-term (v0.5.0 candidates — meaningful enough to warrant a minor bump)

### R4 — Cross-host command map documentation

The four hosts expose equivalent functionality through very different surfaces (10 slash-commands in polycli, 1 skill-with-subcommands in polycli-codex / polycli-copilot, 2 tool functions in polycli-opencode). Users moving between hosts have no Rosetta stone.

Deliverable: `docs/host-command-map.md` with a table — capability × host — for all 10 capabilities (`setup` / `health` / `ask` / `rescue` / `review` / `adversarial-review` / `status` / `result` / `cancel` / `timing`). Documentation only; no code change. (Was P3 in `docs/review-2026-04-24-followup.md`.)

### R5 — Integration tests: mocks → captured fixtures

`plugins/polycli/scripts/tests/integration.test.mjs` currently mocks `child_process`. Provider main paths have real replay fixtures (`packages/polycli-runtime/test/fixtures/`), but host-side integration tests do not. Agent 4 in `docs/review-2026-04-24.md` scored test-confidence at 78%, with the 18% deduction mostly attributed to this.

Staged delivery: start with `/ask` and `/health` on one provider (claude) as a pilot, then fan out. Model the capture helper on `packages/polycli-runtime/test/helpers/fixture-replay.mjs`. (Was P6 in `docs/review-2026-04-24-followup.md` and original P3 in `docs/review-fb64b1e.md`.)

### R6 — Auth-probe inference regexes need a named contract

Five providers (`gemini`, `qwen`, `kimi`, `opencode`, `pi`) infer `loggedIn=true` from transient-error regex patterns (timeout / 429 / ECONNREFUSED). CLAUDE.md guards one facet of this, but the patterns themselves are undocumented and regex-shaped — any upstream CLI error-message drift silently regresses the probe.

Deliverable: extract patterns into named constants per provider, add one test per provider that exercises each pattern. No behavior change; just a lock. (Was P5 in `docs/review-2026-04-24-followup.md`.)

### R7 — `/review` CLI flag drift watch

`docs/review-cli-flags.md` was produced against specific CLI versions (claude 2.1.117, gemini 0.38.2, copilot 1.0.34, opencode 1.14.20, pi 0.68.1, mini-agent 0.1.0). If any of these upgrades in a way that changes the flag surface we rely on (e.g., `--tools ""`, `--approval-mode plan`, `--excluded-tools`, `OPENCODE_CONFIG_CONTENT`, `--no-tools`, `MINI_AGENT_CONFIG_PATH`), `/review`'s hard constraints silently regress.

Deliverable (low-effort): a tiny `scripts/check-review-cli-drift.mjs` that parses `<cli> --help` per provider and asserts the documented flag names are present. Run it locally before ship, not in CI (it depends on installed CLIs).

---

## Design-level open questions (not scheduled — decide before doing)

### Q1 — Will `polycli-utils` / `polycli-timing` ever be published to npm?

Today they are `"private": true`. The published surface is bundled into host plugins. Making them public would let third parties build their own hosts without re-bundling, at the cost of committing to a semver contract. `docs/polycli-v1-public-surface.md` was drafted for this scenario but is now out of date (see R3).

**Decide**: keep forever-internal, or schedule an explicit 1.0 publish after R3 is resolved.

### Q2 — Are the provider-specific `model` fallbacks sustainable?

v0.4.1 populates the top-level `model` field for all 8 providers, but the fallback paths differ:

- kimi falls back to the local kimi config default model
- opencode pulls model from `opencode export <session>` session metadata (an extra CLI call)
- pi falls back to the pinned default `openai-codex/gpt-5.4`

If any of these upstream surfaces change, the fallback breaks silently. No alert today. Two answers:

- Accept it as provider-quirk maintenance, encode the assumptions in tests (pair with R7).
- Revisit when a second provider grows a similar need; do not pre-generalize.

### Q3 — Four-host asymmetry: accept or converge?

polycli has 10 slash-commands, polycli-codex / polycli-copilot have a skill with 10 subcommands, polycli-opencode has 2 tool functions. All functionally equivalent. Asymmetry is driven by host capability, not project drift.

R4 (the map doc) treats this as a "document it" problem. The deeper question — "should the host surfaces converge over time?" — is not scheduled. Do not preemptively converge; wait for a concrete pain point from a real user.

---

## Explicit non-goals

These are principled refusals, not backlog. Do not schedule them without an explicit reversal conversation with the user.

- **No shared `BaseProvider` / inheritance tree / template-method framework.** The registry is a flat dispatch table and stays that way. (Memory: `feedback_no_shared_runtime.md`.)
- **No unified event schema that collapses provider-specific semantics.** `extractProviderEventText` dispatches per provider for a reason.
- **No `cold` / `retry` timing metrics.** Upstream CLIs do not emit stable signals; any implementation would be a fake. Stays `unsupported`. (Memory: `project_cold_retry_unmeasured.md`.)
- **No migration of legacy sibling repos (`gemini-plugin-cc` / `kimi-plugin-cc` / `qwen-plugin-cc` / `minimax-plugin-cc`) into this monorepo.** They remain reference material. (Memory: `project_legacy_repos_reference.md`.)
- **No "monitor" / daemon / long-lived polycli process.** Each invocation is a short-lived CLI run against a live provider. Daemon mode would compress orthogonal axes (runtimePersistence / measurementScope) that the current timing contract explicitly keeps separate.

---

## How to update this file

- When an item lands: delete it (do not strike through). Record the commit hash in CHANGELOG.md as usual.
- When priorities shift: move items between Short-term / Medium-term sections; explain why in the CHANGELOG entry.
- When a design question gets an answer: delete the Q and document the decision either in `AGENTS.md` (durable constraint) or CLAUDE.md (Claude-specific note).
- When a new deferred item arises from a review: add it here in the same numbered style (`R8`, `Q4`, ...) with source reference.
- Cross-reference the review docs it came from so the full context is one click away.
