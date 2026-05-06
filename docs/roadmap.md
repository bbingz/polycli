# Roadmap

Snapshot: 2026-05-06 (v0.6.4 Codex adapter install-surface correction).

This file lives next to `docs/release.md` (what's shipped) and `CHANGELOG.md` (what happened). It answers the complementary question: **what's open, how it's prioritized, and what we're deliberately not doing.**

Living document — update when items land, when priorities shift, or when a deferred item becomes urgent. New reviewers: read this **and** the latest `docs/archive/review-*.md` to understand context before acting.

---

## Current state

- Latest public release: **v0.6.4** — see `docs/release-notes-v0.6.4.md`.
- Current release commit is the `v0.6.4` tag target.
- Tests at release check: **289/289** pass.
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
| Q4 release drift validation | Closed as guardrail | Bundle, fixture, manifest, host-map, open-source hygiene, and public package tarball checks are wired into the release path. |

---

## Open Work

### Q5 — CI and release publication hygiene

Source: post-v0.6.2 open-source readiness review.

Goal: keep GitHub Actions, GitHub release state, npm package publication, and repository presentation aligned with the release artifacts.

Status: closed as an active guardrail. CI, release publication, npm registry state, Dependabot PRs, and package hygiene checks are aligned. Keep the guardrails below in place.

Current guardrails:

- `npm run validate:bundles` checks that all four generated companion bundles are byte-identical after `npm test` rebuilds them.
- `npm run validate:fixtures` checks real runtime fixture metadata has provider/name/capturedAt/version/argv/expected response fields.
- `npm run validate:manifests` keeps host plugin versions and marketplace entries aligned.
- `npm run validate:host-map` keeps host command docs and registered command surfaces aligned.
- `npm run validate:codex-adapter` keeps Codex provider triggers, raw-CLI fallback rules, and health/status/result/timing observability guidance aligned.
- `scripts/tests/open-source-hygiene.test.mjs` scans tracked files for maintainer-local paths and provider-private metadata.
- `scripts/tests/open-source-packaging.test.mjs` verifies public package export targets, license files, and explicit publish surfaces.
- GitHub Actions runs Node 20 install, audit, tests, generated-bundle validation, fixture metadata validation, release manifest validation, host-map validation, Codex adapter validation, and tarball dry-runs.
- `npm run check:review-drift` watches provider review hard-constraint flags that can be checked from local CLI help.

Watch items:

- env/config-based review constraints remain partially manual; document any newly automatable check in `docs/archive/review-cli-flags.md` before adding it to `check:review-drift`
- after each publish, confirm GitHub latest release and npm registry versions match the repo release notes

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
