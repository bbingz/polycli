# Third-party Review Follow-up, 2026-06-15

Purpose: merge the current third-party audit findings into one source-backed checklist, then track independent subagent verification and remediation.

Scope:

- Current worktree at `<repo>`.
- Prior Claude / DeepSeek / Minimax / Kimi / MiMo / Qwen review batches discussed in chat.
- The current active verification pass is focused on the 11 Qwen findings below, because Qwen claims all remain present after the previous remediation.

Rules:

- Do not treat third-party consensus as evidence.
- Each item needs a current-source verdict: `fixed`, `still-present`, `false-positive`, `mitigated`, or `not-applicable`.
- For `still-present`, add or update a focused test before production-code changes unless the item is docs-only.
- Keep the user-required Claude tmux TUI default. Do not "fix" findings by reverting Claude `ask` / `review` to `claude -p`.

## Consolidated Findings

| ID | Source batch | Severity | Claim | Primary paths | Verification owner | Pre-fix verdict | Handling status |
|---|---|---:|---|---|---|---|---|
| R2-M1 | Qwen | medium | Atomic save can leave orphan temp files on write/rename failure because failed paths lack tmp cleanup. | `packages/polycli-utils/src/atomic-save.js` | subagent-atomic | still-present | fixed: added temp cleanup and regression test |
| R2-M2 | Qwen | medium | Review no-changes / empty-diff early return skips runtime cleanup, leaking Gemini review temp dirs. | `plugins/polycli/scripts/polycli-companion.mjs` | subagent-review-cleanup | still-present | fixed: cleanup now runs in `finally`; integration regression added |
| R2-M3 | Qwen | medium | `terminateProcess` accepts unsafe pid values; `pid=1` can call `kill(-1)`. | `plugins/polycli/scripts/session-lifecycle-hook.mjs`, `packages/polycli-utils/src/process.js` | subagent-pid-guard | still-present | fixed: unsafe pid guards added with unit coverage |
| R1-H1 | Qwen | high | Integration tests do not cover Claude health `loggedIn:false` path. | `plugins/polycli/scripts/tests/integration.test.mjs` | subagent-claude-health-test | still-present | fixed: fake Claude auth can report logged out; integration regression added |
| R1-M1 | Qwen | medium | Plugin README command docs omit `debug` / `sessions` and TUI ownership. | `plugins/polycli/README.md` | subagent-plugin-readme | still-present | fixed: command docs and TUI ownership note added |
| R1-L3 | Qwen | low | Root README does not document Claude health as auth-only rather than prompt-probe. | `README.md`, `plugins/polycli/scripts/polycli-companion.mjs` | subagent-health-docs | still-present | fixed: health docs label Claude auth-only behavior |
| R1-L1 | Qwen | low | Translated READMEs lack the `@bbingz/polycli` terminal package badge. | `README.zh-CN.md`, `README.ja.md` | subagent-i18n-badges | still-present | fixed: badges added |
| R1-L2 | Qwen | low | Translated READMEs lack the five outcome fields. | `README.zh-CN.md`, `README.ja.md` | subagent-i18n-outcomes | still-present | fixed: outcome diagnostics fields added |
| R1-N2 | Qwen | nit | Translated capability matrices omit the `minimax` (`mmx-cli`) alias. | `README.zh-CN.md`, `README.ja.md` | subagent-i18n-minimax | still-present | fixed: matrix aliases added |
| R1-N1 | Qwen | nit | Timing schema docs lack a note that `cold` / `retry` are v1 permanently unsupported. | `packages/polycli-timing/README.md` | subagent-timing-docs | still-present | fixed: v1 unsupported note added |
| R1-N3 | Qwen | nit | Runtime README scope lacks `review-flags` / review constraint surface. | `packages/polycli-runtime/README.md` | subagent-runtime-readme | still-present | fixed: scope and public surface now list review flags |

## Prior Batch Decisions Kept In Scope

| Cluster | Decision |
|---|---|
| Claude ask/review synchronous response | Do not restore `claude -p` default. The product requirement is detached tmux TUI startup, with `tmuxSession` / `attachCommand` as the response. |
| Claude tmux timing | `ttft` / `gen` / `tail` are unsupported in tmux TUI mode; `total` is startup/prompt-submission time only. |
| Claude health | Auth-only health is intentional; docs and payloads must label it honestly. |
| Provider docs drift | Keep 11 providers represented across runtime, plugin docs, release validation, and host docs. |
| Path B architecture | Provider-specific parsing remains in flat runtime adapters; no shared base provider framework. |

## Verification Log

- 2026-06-15: spawned first explorer batch for R2-M1, R2-M2, R2-M3, R1-H1, R1-M1, R1-L3.
- 2026-06-15: remaining R1-L1, R1-L2, R1-N2, R1-N1, R1-N3 queued for second explorer batch after thread slots free.
- 2026-06-15: all 11 items independently verified as `still-present` in the current worktree before remediation.
- 2026-06-15: remediation applied for all 11 items; final status depends on the verification commands listed in the closeout response.
