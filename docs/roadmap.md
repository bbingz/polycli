# Roadmap

Snapshot: 2026-04-24 (post-v0.6.0).

This file lives next to `docs/release.md` (what's shipped) and `CHANGELOG.md` (what happened). It answers the complementary question: **what's open, how it's prioritized, and what we're deliberately not doing.**

Living document — update when items land, when priorities shift, or when a deferred item becomes urgent. New reviewers: read this **and** the latest `docs/review-*.md` to understand context before acting.

---

## Current state

- Last ship: **v0.6.0** @ `a95e3d8` — see `docs/release-notes-v0.6.0.md`.
- Tests at release: **277/277** pass.
- 8 providers shipped (claude / gemini / kimi / qwen / minimax / copilot / opencode / pi).
- 4 host plugins (polycli / polycli-codex / polycli-copilot / polycli-opencode), each with an independent marketplace manifest.
- Path B architectural stance is intact: `@bbingz/polycli-utils` / `@bbingz/polycli-timing` are public v1 npm packages; `@bbingz/polycli-runtime` remains an internal bundler input (`private: true`); provider modules are flat, not inherited; timing four-state semantics preserved.

Roadmap closure state:

| ID | Status | Notes |
|----|--------|-------|
| R1-R7 | Closed | Completed across v0.4.2 and v0.5.0. |
| R8a-R8f legacy convergence | Closed | Shipped in v0.6.0: kimi resume flags, gemini write/effort flags, lifecycle hooks, stop-time review gate, provider guidance skills, generic provider subagent, and accepted unified namespace UX. |
| R8g legacy repo archival | Closed as won't-do | User explicitly chose not to archive the four legacy repos. They remain permanent read-only references; no edits. |
| Q1 publish utils/timing | Closed | `@bbingz/polycli-utils` and `@bbingz/polycli-timing` are public npm packages. |
| Q2 model fallback sustainability | Closed as guardrail | Current fallback policy is documented in `docs/model-fallback-policy.md`; host integration locks cached `defaultModel` behavior when a provider stream omits model metadata. |
| Q3 four-host surface convergence | Closed as accepted asymmetry | `docs/host-command-map.md` is the durable answer; `npm run validate:host-map` prevents command-map drift without forcing hosts into the same UI shape. |

---

## Open Work

### Q4 — Release drift validation

Source: post-v0.6.0 maintenance review.

Goal: keep generated host bundles, fixture metadata, marketplace manifests, and host command maps from drifting silently during release prep.

Current guardrails:

- `npm run validate:bundles` checks that all four generated companion bundles are byte-identical after `npm test` rebuilds them.
- `npm run validate:fixtures` checks real runtime fixture metadata has provider/name/capturedAt/version/argv/expected response fields.
- `npm run validate:manifests` keeps host plugin versions and marketplace entries aligned.
- `npm run validate:host-map` keeps host command docs and registered command surfaces aligned.
- `npm run check:review-drift` watches provider review hard-constraint flags that can be checked from local CLI help.

Open watch item: env/config-based review constraints remain partially manual; document any newly automatable check in `docs/review-cli-flags.md` before adding it to `check:review-drift`.

---

## Explicit non-goals

These are principled refusals, not backlog. Do not schedule them without an explicit reversal conversation with the user.

- **No shared `BaseProvider` / inheritance tree / template-method framework.** The registry is a flat dispatch table and stays that way. (Memory: `feedback_no_shared_runtime.md`.)
- **No unified event schema that collapses provider-specific semantics.** `extractProviderEventText` dispatches per provider for a reason.
- **No `cold` / `retry` timing metrics.** Upstream CLIs do not emit stable signals; any implementation would be a fake. Stays `unsupported`. (Memory: `project_cold_retry_unmeasured.md`.)
- **No "monitor" / daemon / long-lived polycli process.** Each invocation is a short-lived CLI run against a live provider. Daemon mode would compress orthogonal axes (runtimePersistence / measurementScope) that the current timing contract explicitly keeps separate.

---

## How to update this file

- When an item lands: delete it (do not strike through). Record the commit hash in CHANGELOG.md as usual.
- When priorities shift: move items between Short-term / Medium-term sections; explain why in the CHANGELOG entry.
- When a design question gets an answer: delete the Q and document the decision either in `AGENTS.md` (durable constraint) or CLAUDE.md (Claude-specific note).
- When a new deferred item arises from a review: add it here in the same numbered style (`R8`, `Q4`, ...) with source reference.
- Cross-reference the review docs it came from so the full context is one click away.
