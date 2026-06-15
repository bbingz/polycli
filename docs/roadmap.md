# Roadmap

Snapshot: 2026-06-15 (v0.6.21 is the latest public release; the Claude tmux TUI defaults and review-remediation follow-up have shipped).

This file lives next to `docs/release.md` (what's shipped) and `CHANGELOG.md` (what happened). It answers the complementary question: **what's open, how it's prioritized, and what we're deliberately not doing.**

Living document — update when items land, when priorities shift, or when a deferred item becomes urgent. New reviewers: read this **and** the latest `docs/archive/review-*.md` to understand context before acting.

---

## Current state

- Latest public release: **v0.6.21** — see `docs/release-notes-v0.6.21.md`. Published 2026-06-15: GitHub release + `@bbingz/polycli-opencode@0.6.21` + `@bbingz/polycli@0.6.21` all on the registry.
- 11 providers ship in the latest release (claude / gemini / kimi / qwen / minimax / copilot / opencode / pi / cmd / agy / grok). v0.6.21 ships Claude detached tmux TUI defaults and the third-party review remediation set.
- Current unreleased workspace work: none.
- 4 host plugins (polycli / polycli-codex / polycli-copilot / polycli-opencode) plus the optional `@bbingz/polycli` terminal CLI, each with an independent release manifest.
- Path B architectural stance is intact: `@bbingz/polycli-utils` / `@bbingz/polycli-timing` are public v1 npm packages; `@bbingz/polycli` is the public terminal CLI surface; `@bbingz/polycli-runtime` remains an internal bundler input (`private: true`); provider modules are flat, not inherited; timing four-state semantics preserved.

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

- `npm run validate:bundles` checks that all five generated companion bundles are byte-identical after `npm test` rebuilds them.
- `npm run validate:fixtures` checks real runtime fixture metadata has provider/name/capturedAt/version/argv/expected response fields.
- `npm run validate:manifests` keeps host plugin versions and marketplace entries aligned.
- `npm run validate:host-map` keeps host command docs and registered command surfaces aligned.
- `npm run validate:codex-adapter` keeps Codex provider triggers, raw-CLI fallback rules, and health/status/result/timing observability guidance aligned.
- `scripts/tests/open-source-hygiene.test.mjs` scans tracked files for maintainer-local paths and provider-private metadata.
- `scripts/tests/open-source-packaging.test.mjs` verifies public package export targets, license files, and explicit publish surfaces.
- GitHub Actions runs Node 20 install, audit, tests, generated-bundle validation, fixture metadata validation, release manifest validation, host-map validation, Codex adapter validation, and tarball dry-runs.
- `npm run check:review-drift` watches provider review hard-constraint flags that can be checked from local CLI help.
- `npm run check:fixture-freshness` warns when version-pinned fixtures lag locally installed provider CLIs; it is intentionally warn-only by default.
- `npm run check:provider-paths` is the periodic provider-path review command; keep it aligned with `docs/provider-paths.md`.

Watch items:

- env/config-based review constraints remain partially manual; document any newly automatable check in `docs/archive/review-cli-flags.md` before adding it to `check:review-drift`
- after each publish, confirm GitHub latest release and npm registry versions match the repo release notes

### Q6 — Real terminal CLI/TUI and run ledger observability

Source: real Codex multi-provider review after the v0.6.x host-adapter hardening. Codex could call the plugin, but still tended to reason about Polycli as a shell CLI and the failure path was not debuggable enough from current `health` / `status` / `result` / `timing` output alone. In that run, 7 providers produced adoptable output (`gemini`, `copilot`, `kimi`, `qwen`, `minimax`, `claude`, `opencode`), `cmd` passed health but failed two ask attempts, and `pi` failed health and was skipped.

Goal: add a real terminal entry point plus a persistent run ledger so users and host agents can run, inspect, compare, and debug provider calls outside host-specific plugin UX without depending on private companion bundle paths.

Status: Spec 1 released in v0.6.7; Spec 2 (background-job ledger plumbing) and Spec 3 (read-only TUI inspector MVP) released in v0.6.8. Post-v0.6.8 hardening added scan-on-read recovery for dead workers with residual run context and TUI log-file pointers; full history is tracked in `tasks/terminal-cli-tui-observability.md`.

Phase plan:

1. **Contract boundary** — decide the terminal package/bin shape while keeping `@bbingz/polycli-utils` and `@bbingz/polycli-timing` stable and `@bbingz/polycli-runtime` internal unless a future public-surface document explicitly promotes it.
2. **Headless CLI first** — ship a PATH-callable `polycli` command with parity for existing companion commands before building the TUI.
3. **Run ledger and diagnostics** — persist per-run and per-attempt facts for health, ask/review/rescue attempts, skip/adopt decisions, timing, raw log pointers, sanitized argv, and failure reasons.
4. **TUI inspector** — build a short-lived terminal UI that consumes the same CLI/ledger control plane; it must inspect and operate existing commands, not invent new provider semantics.
5. **Docs and release guards** — update README, host command map, public-surface docs, and release validation once the terminal surface exists.

Sequencing rule: do not start TUI implementation until the headless CLI and run ledger can answer why a provider was adopted, skipped, or failed.

Spec 1 released in v0.6.7 (2026-05-07): terminal package wrapper (`@bbingz/polycli` on npm), shared `debug` companion vocabulary (`debug runs/show/explain`), and redacted run ledger foundation (per-workspace NDJSON with `--run-id` / `POLYCLI_RUN_ID`). Spec 2 + Spec 3 released in v0.6.8 (2026-05-07): background-worker ledger plumbing (parent persists `runContext` into the per-job config and writes `job_started` after spawn; `_job-worker` writes `attempt_started` / `attempt_result` / `provider_decision` against the originating `runId`) and the read-only `polycli tui` inspector (run list, provider matrix, event timeline, detail / explanation / repro panes; renders `started` / `attempt_started` without a terminal `attempt_result` / `provider_decision` as `unfinished` / `unknown` rather than inventing a result; real-pty `q` exit fixed by explicit stdin resume). Post-v0.6.8 hardening adds scan-on-read dead-worker recovery for missing terminal ledger events and TUI rendering of local log-file pointers without reading log contents.

### Q7 — Provider capability and path reference matrix

Source: 2026-05-07 user question — "can we attach a credible standardized benchmark to polycli docs so Claude (Code) routes to the right provider per task?"

Status: landed as a conservative path table, not a benchmark oracle. The durable table is `docs/provider-paths.md`; review it monthly, before release, and whenever provider CLIs or local model defaults change.

Survey verdict (durable; do not re-survey unless these benchmarks change):

- All credible benchmarks are **model-level**; polycli is **CLI-level**. `pi` / `opencode` / `cmd` route to user-configured backends, so any "provider X excels at Y" claim only holds under "default upstream model" assumption — must be banner-disclaimed.
- A real routing oracle would push polycli toward framework — violates Path B. Acceptable form is a reference matrix banner-tagged "reference only, not routing oracle".
- Cite only: **Aider Polyglot** ([leaderboard](https://aider.chat/docs/leaderboards/), fairest cross-vendor code-edit comparison), **Terminal-Bench 2.0** ([leaderboard](https://www.tbench.ai/leaderboard), only official horizontal eval covering Claude Code / Codex CLI / Gemini CLI — but [5pp+ docker infra noise per Anthropic](https://www.anthropic.com/engineering/infrastructure-noise)), **Artificial Analysis Intelligence Index** ([models](https://artificialanalysis.ai/models), third-party weighted composite).
- Do **not** cite: LMArena Elo (chat preference, not CLI), SWE-bench Verified single score (OpenAI publicly disputes contamination), third-party blog comparisons (no published task set), CMMLU / C-Eval / SuperCLUE (knowledge focus, not agentic CLI).
- Every number must carry vendor system card / official GitHub / official blog URL + date — public web search is currently SEO-polluted with fabricated future versions.
- Landing place: `docs/provider-paths.md`, cross-linked from `docs/polycli-v1-public-surface.md`.

Memory: `project_provider_capability_matrix_deferred.md`; updated by the 2026-05-07 provider-path implementation.

### Q8 — Provider-drift maintenance hardening

Source: 2026-05-29 strategy recon (memory `project_competitive_landscape_and_moat`, workflow `wmyci560m`). The maintenance burden's root cause is ecosystem heterogeneity (10 targets across 4 languages + 3 architectural shapes, no common contract to wrap) — this validates Path B rather than refuting it. The actionable debt is three internal weaknesses, none requiring a framework:

- a provider's option vocabulary is spelled in 3-5 unsynchronized sites (`src/<provider>.js`, `lib/prompt-runtime.mjs`, `lib/review.mjs` constraints + read-only key map, `scripts/check-review-cli-drift.mjs`) with no test asserting they agree;
- the only drift detector (`check-review-cli-drift.mjs`) is out of CI and covers flag-presence only — not output/JSON shape, auth-error wording, or model-field location;
- fixtures are version-pinned static snapshots, so an upstream output-format change keeps CI green (false confidence) until a human re-captures.

Items:

- **Q8a — fixture-staleness warning** (landed 2026-05-29): opt-in check that spawns each installed CLI `--version` and compares to the fixture `meta.json` `version`, emitting WARN on mismatch (skip if CLI absent, mirroring the drift script). Read-only, short-lived, no daemon.
- **Q8b — option-vocabulary single source** (landed 2026-05-29): a single frozen `REVIEW_FLAG_EXPECTATIONS` map in `packages/polycli-runtime/src/review-flags.js` is the sole declaration of each provider's drift `expectFlags`/`forbidFlags`/`probes`, its read-only option key/value, and its exact `extraArgTokens`. `scripts/check-review-cli-drift.mjs` derives its CHECKS from the map; `lib/review.mjs` sources the read-only keys from it; a consistency test asserts `extraArgTokens` EXACTLY equals the `--`flags `REVIEW_HARD_CONSTRAINTS` emits (catches a token added OR removed). Data co-location, NOT a `BaseProvider` — the flat dispatch table is preserved (non-goal #1 intact). Single-module home (not per-provider const); revisit if it grows.
- **Q8c — drift into the release gate + local auth-anchor sanity check** (landed 2026-05-29): `check:review-drift` is wired into `release:check` (self-skips when a CLI is absent; blocks a release only on genuine flag drift). The drift script also reads the `GEMINI_EXPLICIT_AUTH_ERROR_RE` / `KIMI_EXPLICIT_AUTH_ERROR_RE` source and confirms the auth anchor phrase is still present — a LOCAL guard against a polycli-side refactor silently dropping it. It does NOT detect upstream CLI wording changes; a real upstream auth-wording probe stays an open follow-up (no safe way to force an unauthenticated CLI response in the check).
- **Q8d — migrate churn-heavy providers off stdout scraping** (deferred, medium-term): move qwen/gemini (worst cadence) toward upstream JSON event streams / SDKs (Claude Agent SDK + `--bare`, Qwen Python SDK, Kimi `kimi-agent-sdk`, opencode OpenAPI). Multi-release effort; revisit per-provider. Note the upcoming Claude `--bare`-becomes-`-p`-default change.

### Q9 — Upstream session/history pollution control

Source: same recon. polycli does zero isolation/tagging/cleanup of the session/history that upstream CLIs write under `$HOME` (`spawn.js` passes the parent env + real cwd verbatim; the `SessionEnd` hook only prunes polycli's own job state). Adapters also *depend* on those files for `--resume`/`--continue`, and suppression knobs are asymmetric across providers (clean off-switch only for codex `--ephemeral` and gemini `general.sessionRetention`). The primary remedy is **record-and-purge**, not prevention, because a naive env override that prevents writes also breaks auth and resume.

Items:

- **Q9a — record upstream session path/id in the run ledger** (landed 2026-05-29): persist the upstream session path/id (already captured by each adapter's `resolveSessionId`) on the run-ledger event. Zero runtime-behavior change; makes runs auditable and purgeable at near-zero risk.
- **Q9b — `polycli sessions` / `polycli purge` command** (landed 2026-05-29): a manual, on-demand command that lists/deletes ONLY upstream session artifacts whose path appears in polycli's run ledger. No daemon; honest-default — never auto-deletes, requires an explicit purge invocation.
- **Q9c — opt-in per-run session isolation** (deferred, needs design): scoped `HOME`/`XDG_CONFIG_HOME`/config-dir env at the `spawn.js` boundary, gated on `runtimePersistence==='session'`, default OFF. DEFERRED because a naive `HOME` override also hides credentials (breaks auth) and prior sessions (breaks `--resume`); needs a per-provider design that relocates only session state while preserving auth. `codex --ephemeral` exists but codex lives in the separate `polycli-codex` plugin.

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
