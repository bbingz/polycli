---
name: gemini-cli-runtime
description: Internal helper contract for calling the polycli companion runtime for Gemini from Claude Code
user-invocable: false
---

# Gemini CLI Runtime Contract

This skill defines how `polycli:polycli-provider-agent` (the subagent) interacts with the
polycli companion script for Gemini. Only invoked from within `polycli:polycli-provider-agent`.

## Primary helper

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" rescue --provider gemini "<prompt>" --json
```

## Commands available to the agent

The provider-agent forwards whatever subcommand the caller supplied. Use `rescue` for multi-step agent work and `ask` for one-shot questions; the rest are slash-command-driven user flows.

| Command | Used by agent? | Purpose |
|---------|---------------|---------|
| `rescue` | Yes | Multi-step agent task (600s base, 1200s for deep-reasoning models — see Latency expectations) |
| `ask` | Yes | One-shot question (120s base, 240s for deep-reasoning models — see Latency expectations) |
| `setup` | No | User checks installation |
| `health` | No | User runs end-to-end probe |
| `review` | No | User triggers code review |
| `adversarial-review` | No | User triggers adversarial review |
| `status` | No | User checks job status |
| `result` | No | User fetches completed output |
| `cancel` | No | User cancels background job |
| `timing` | No | User inspects timing history |

Resumable thread state is exposed via the `--resume-last` flag, not a separate subcommand.

## Latency expectations

Only **deep-reasoning** Gemini variants (Pro / Thinking series) routinely spend 30s–several minutes silently reasoning before emitting visible text. Flash and other non-reasoning variants typically stream within seconds. This is upstream behavior, not a polycli stall.

To absorb the reasoning latency without inflating other models' budgets, the companion applies a **model-scoped** multiplier:

```js
PROVIDER_TIMEOUT_MULTIPLIERS = {
  gemini: { "gemini-3.1-pro-preview": 2 },
  opencode: { "kimi-for-coding/k2p6": 2 },  // also a code-reasoning model
}
```

(The opencode entry was added 2026-05-02 after a HumanEval/130 Tribonacci probe hit the 120s ask ceiling; the same pattern can be extended to any other reasoning model id.)

Resolution rules (per `resolveTimeoutMs` in `polycli-companion.mjs`):

- `--model gemini-3.1-pro-preview` → ×2 budget (the explicit reasoning case)
- No `--model`, cached upstream-default model is `gemini-3.1-pro-preview` → ×2 budget (the common case today)
- `--model <some-flash-or-other>` → ×1 (caller explicitly chose a non-reasoning model)
- Unknown / cache empty / non-gemini provider → ×1

Effective ceilings when the multiplier applies:

| kind | base | gemini reasoning |
|---|---|---|
| `ask` | 120s | 240s |
| `rescue` | 600s | 1200s |
| `review` | 300s | 600s |
| `adversarial-review` | 300s | 600s |

`health` keeps the universal 60s budget regardless of model — gemini's health prompt is sentinel-only and does not exercise reasoning.

If you cannot estimate how long a gemini prompt will take (e.g. open-ended diagnosis on a large diff), prefer `--background` and poll with `/polycli:status` / `/polycli:result` instead of relying on the foreground timeout. The background worker reuses the same `execution.timeout` (so gemini still gets the model-resolved budget), but the calling shell is freed immediately and the user can decide how long to wait.

When upstream releases a new reasoning-capable Gemini model id, add it to `PROVIDER_TIMEOUT_MULTIPLIERS.gemini`. Do not blanket-multiply the whole provider — that would over-budget Flash users.

## Routing controls

These are CLI flags, not prompt text:

- `--background` — run async, return job ID immediately
- `--write` — allow Gemini to modify files (maps to `--approval-mode auto_edit`)
- `--resume-last` — continue previous Gemini thread
- `--fresh` — start new thread (ignore previous)
- `--model <model>` — override the default model
- `--effort <low|medium|high>` — reasoning effort level
- `--prompt-file <path>` — read prompt from file instead of positional args
- `--json` — always use this for machine-readable output

## Safety rules

- **Preserve prompt text as-is.** Only reshape via `gemini-prompting` skill.
- **Never inspect the repo** from the agent. Claude does that.
- **Return stdout exactly.** No independent analysis.
- **Return nothing** if invocation fails (let Claude handle the error).
