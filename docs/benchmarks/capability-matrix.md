# Capability matrix: polycli workflows with no bare-shell equivalent

Companion to [`bench-vs-bare-cli-spec.md`](../../tasks/bench-vs-bare-cli-spec.md) and [`results-2026-04-29.md`](./results-2026-04-29.md). The bench measures parent-context bytes / wall-clock for workflows that **both** paths support. This document lists workflows where bare-shell has no meaningful equivalent — quantitative comparison is not honest, but the gap is real and worth declaring.

## Workflow matrix

| Workflow | Bare-shell (`Bash(<provider> -p ...)`) | polycli |
|---|:---:|:---:|
| `ask` (one-shot prompt) | ✓ | ✓ |
| `review` (structured findings on git diff) | ✓* | ✓ |
| `rescue` (long-context investigation) | ✓* | ✓ |
| `adversarial-review` (attack-surface review) | — | ✓ |
| Background job (`--background` + `status` / `result` / `cancel`) | — | ✓ |
| Session resume (`--resume-last` / `--fresh`) | — | ✓ |
| `stop-review-gate` hook (intercept errant review flows before they continue) | — | ✓ |
| 4-state timing (`measured` / `zero` / `missing` / `unsupported`) | — | ✓ |
| Multi-host consistency (same command surface across Claude Code / Codex / Copilot CLI / OpenCode) | — | ✓ |
| Provider `health` probe (one round-trip across all providers, returns `healthyProviders`) | — | ✓ |
| Probing-cost amortization (cold parent does not pay invocation discovery) | — | ✓ |

*) Bare-shell can technically issue review/rescue prompts via `<provider> -p "<hand-crafted prompt>"`, but the user must reconstruct the prompt template each time. polycli's `review`/`rescue` commands embed a vetted, multi-provider-tested template (`plugins/polycli/scripts/lib/review.mjs:buildReviewPrompt`).

## How to interpret this

The bench shows polycli reduces parent-context bytes by 69–98% on workflows that bare-shell *can* do. This document covers workflows that bare-shell **cannot meaningfully do** without re-implementing polycli's companion script.

These are not refinements of the bench's percentages — they are presence/absence claims. polycli either supports them or it doesn't (it does); bare-shell either supports them or it doesn't (it doesn't).

## Why these are not in the byte-comparison bench

Forcing a workflow with no bare-shell equivalent into a token-comparison would be dishonest — there is nothing to compare against. The honest framing is: bench measures common-denominator workflows, this matrix lists polycli's superset.

## Sources of truth

| Capability | Implementation |
|---|---|
| Background job control | `plugins/polycli/scripts/lib/job-control.mjs`; companion `status` / `result` / `cancel` commands |
| Session resume | `polycli-runtime` per-provider `sessionResume` flag — see [README capability matrix](../../README.md#capability-matrix) |
| 4-state timing | [`packages/polycli-timing/`](../../packages/polycli-timing/) |
| Adversarial-review | `plugins/polycli/commands/adversarial-review.md`; `lib/review.mjs` with `adversarial: true` |
| `stop-review-gate` | `plugins/polycli/scripts/stop-review-gate-hook.mjs`; `prompts/stop-review-gate.md` |
| Multi-host consistency | marketplace manifests under `plugins/{polycli,polycli-codex,polycli-copilot,polycli-opencode}` |
| Provider `health` probe | companion `health` command; per-provider auth probes in `polycli-runtime` |
| Probing-cost amortization | `plugins/polycli/agents/polycli-provider-agent.md` (the agent encapsulates the invocation pattern) |
