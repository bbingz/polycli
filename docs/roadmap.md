# Roadmap

Snapshot: 2026-04-24 (post-v0.5.0).

This file lives next to `docs/release.md` (what's shipped) and `CHANGELOG.md` (what happened). It answers the complementary question: **what's open, how it's prioritized, and what we're deliberately not doing.**

Living document — update when items land, when priorities shift, or when a deferred item becomes urgent. New reviewers: read this **and** the latest `docs/review-*.md` to understand context before acting.

---

## Current state

- Last ship: **v0.5.0** @ `1f2d1c4` — see `docs/release-notes-v0.5.0.md`.
- Tests: **257/257** pass; `release:check` end-to-end green.
- 8 providers shipped (claude / gemini / kimi / qwen / minimax / copilot / opencode / pi).
- 4 host plugins (polycli / polycli-codex / polycli-copilot / polycli-opencode), each with an independent marketplace manifest.
- Path B architectural stance is intact: `@bbingz/polycli-utils` / `@bbingz/polycli-timing` are public v1 npm packages; `@bbingz/polycli-runtime` remains an internal bundler input (`private: true`); provider modules are flat, not inherited; timing four-state semantics preserved.

Roadmap closure state:

| ID | Status | Notes |
|----|--------|-------|
| R1-R7 | Closed | Completed across v0.4.2 and v0.5.0. |
| Q1 publish utils/timing | Closed | `@bbingz/polycli-utils` and `@bbingz/polycli-timing` are public npm packages. |
| Q2 model fallback sustainability | Closed as guardrail | Current fallback policy is documented in `docs/model-fallback-policy.md`; host integration locks cached `defaultModel` behavior when a provider stream omits model metadata. |
| Q3 four-host surface convergence | Closed as accepted asymmetry | `docs/host-command-map.md` is the durable answer; `npm run validate:host-map` prevents command-map drift without forcing hosts into the same UI shape. |

---

## Open Work

### R8 — Legacy plugin convergence

Source: 2026-04-24 capability gap audit between `plugins/polycli/` and the four legacy repos (`gemini-plugin-cc` / `kimi-plugin-cc` / `qwen-plugin-cc` / `minimax-plugin-cc`).

Goal: retire the four legacy repos by porting their distinctive capabilities into polycli so users run one plugin instead of five. Runtime adapters already live in `@bbingz/polycli-runtime`; the gap is entirely at the host-plugin surface (commands, hooks, subagents, skills).

Sub-items (each is independently closeable as land-or-won't-do):

- **R8a — Kimi session continuation.** Add `continue` and `resume` subcommands to the bundled companion, plus `--resume-last` / `--fresh` flags on `ask` / `rescue`. Source: `kimi-plugin-cc/plugins/kimi/commands/{continue,resume}.md` and the wrapper-side resume-mismatch warning path (guards against the kimi-cli ghost-session bug). Kimi-only; other providers have no equivalent session model.
- **R8b — Session-lifecycle + stop-time review gate hooks.** Port `SessionStart` / `SessionEnd` / `Stop` into `plugins/polycli/hooks/`, provider-agnostic. The stop-gate spawns an `adversarial-review` run, parses `ALLOW:` / `BLOCK:` sentinels, has a 15-min budget, and is opt-in per workspace (legacy keys it off a `stopReviewGate` config flag). Open: whether the gate honors the user's current `--provider` preference or pins to a designated reviewer.
- **R8c — Per-provider guidance skills.** Legacy plugins each ship three skills: `xxx-prompting` / `xxx-result-handling` / `xxx-cli-runtime`. Decide between (a) port each trio as namespaced skills under `plugins/polycli/skills/`; (b) consolidate into one polycli skill that dispatches per provider; (c) drop as redundant now that the companion handles more plumbing. Affects how provider-aware the main agent is when orchestrating work.
- **R8d — Rescue flag semantics.** Surface `--write` (gemini approval mode), `--effort low|medium|high` (gemini reasoning budget), and `--resume-last` / `--fresh` (kimi) on `/polycli:rescue`, with the legacy "drop silently + brief note" behavior for providers that don't support a given flag.
- **R8e — Per-provider subagent types.** Legacy plugins expose `Agent(subagent_type: "kimi:kimi-agent")` etc. for contexts where slash commands are out of scope (forked general-purpose subagents, loops). Decide whether polycli ships equivalent `polycli:kimi` / `polycli:gemini` / `polycli:qwen` / `polycli:minimax` subagent types, or whether the slash command surface suffices.
- **R8f — Namespace UX.** `/kimi:ask X` becomes `/polycli:ask --provider kimi X` — verbose and regressive for existing muscle memory. Options: (i) per-provider shim commands inside `plugins/polycli/` (`/polycli:kimi:ask` etc.); (ii) thin namespace plugins (`polycli-kimi`, `polycli-gemini`, ...) that forward to the main companion; (iii) document and accept the unified surface. (i) and (ii) re-create the legacy shape on purpose; (iii) forces user re-learning.
- **R8g — Retire legacy repos.** After R8a–R8f each land or close as won't-do, archive the four legacy GitHub repos, mark them read-only in their READMEs, update the `project_legacy_repos_reference.md` memory, and relax the CLAUDE.md "legacy 仅作 reference" constraint. Do not delete the repos — they remain useful for diff archaeology.

R8 is a principled reversal of the prior non-goal "No migration of legacy sibling repos into this monorepo," motivated by the user observation on 2026-04-24 that maintaining five parallel plugins for one unified runtime is redundant. Note: R8 sub-items will require grepping the legacy repos to port faithfully; the CLAUDE.md "不要 grep 不要编辑" constraint needs to narrow to "不要编辑" for the duration of R8.

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
