# Roadmap

Snapshot: 2026-04-24 (post-v0.4.1).

This file lives next to `docs/release.md` (what's shipped) and `CHANGELOG.md` (what happened). It answers the complementary question: **what's open, how it's prioritized, and what we're deliberately not doing.**

Living document — update when items land, when priorities shift, or when a deferred item becomes urgent. New reviewers: read this **and** the latest `docs/review-*.md` to understand context before acting.

---

## Current state

- Last ship: **v0.4.2** @ `5c7f709` — see `docs/release-notes-v0.4.2.md`.
- Tests: **250/250** pass; `release:check` end-to-end green.
- 8 providers shipped (claude / gemini / kimi / qwen / minimax / copilot / opencode / pi).
- 4 host plugins (polycli / polycli-codex / polycli-copilot / polycli-opencode), each with an independent marketplace manifest.
- Path B architectural stance is intact: `@bbingz/polycli-utils` / `@bbingz/polycli-timing` / `@bbingz/polycli-runtime` are internal bundler inputs (`private: true`); provider modules are flat, not inherited; timing four-state semantics preserved.

**v0.5.0 scope** is the two medium-term items below (R5 + R6) plus any of the three design questions (Q1 / Q2 / Q3) that the user chooses to resolve. Nothing in the v0.5.0 scope is a breaking change; the `v0.5` bump is just the natural next marker after a minor feature addition (if any of R5/R6 qualify).

---

## Short-term (v0.5.0 candidates)

### R5 — Integration tests: mocks → captured fixtures

`plugins/polycli/scripts/tests/integration.test.mjs` currently mocks `child_process`. Provider main paths have real replay fixtures (`packages/polycli-runtime/test/fixtures/`), but host-side integration tests do not. Agent 4 in `docs/review-2026-04-24.md` scored test-confidence at 78%, with the 18% deduction mostly attributed to this.

Staged delivery: start with `/ask` and `/health` on one provider (claude) as a pilot, then fan out. Model the capture helper on `packages/polycli-runtime/test/helpers/fixture-replay.mjs`. (Was P6 in `docs/review-2026-04-24-followup.md` and original P3 in `docs/review-fb64b1e.md`.)

### R6 — Auth-probe inference regexes need a named contract

Five providers (`gemini`, `qwen`, `kimi`, `opencode`, `pi`) infer `loggedIn=true` from transient-error regex patterns (timeout / 429 / ECONNREFUSED). CLAUDE.md guards one facet of this, but the patterns themselves are undocumented and regex-shaped — any upstream CLI error-message drift silently regresses the probe.

Deliverable: extract patterns into named constants per provider, add one test per provider that exercises each pattern. No behavior change; just a lock. (Was P5 in `docs/review-2026-04-24-followup.md`.)

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
