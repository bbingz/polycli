# Host Command Map

polycli ships four host plugins. They expose the same ten capabilities, but each host's invocation surface is shaped by what the host can express — slash-commands, skill subcommands, tool calls. This document is the Rosetta stone.

If you are switching between hosts, read the first two sections (identity + sample command) and ignore the rest. If you are maintaining a host adapter, read the whole thing.

## At a glance

| host plugin          | host           | invocation style                      | example                                      |
|----------------------|----------------|---------------------------------------|----------------------------------------------|
| `polycli`            | Claude Code    | 10 slash commands                     | `/polycli:health`                            |
| `polycli-codex`      | Codex          | 1 skill with subcommands              | `/polycli-codex:polycli health`              |
| `polycli-copilot`    | GitHub Copilot CLI | skill with subcommands (top-level) | `polycli health`                             |
| `polycli-opencode`   | OpenCode       | 2 tool functions                      | `polycli_run(["health", "--json"])`          |

All four dispatch to the same `polycli-companion.bundle.mjs` underneath. Differences are at the surface only; behavior, output format, exit codes, and `--json` shape are identical.

Codex-specific rule: when the installed `polycli-codex` skill is available, prefer `/polycli-codex:polycli ...` over direct official CLI shell calls for `claude`, `copilot`, `opencode`, `pi`, `gemini`, `kimi`, `qwen`, or `minimax`. Raw provider CLIs are the fallback only when the plugin is unavailable or the user explicitly asks for raw shell. Use `health`, `status`, `result`, and `timing` as the observable control plane around prompt-bearing work.

## Command-by-command mapping

All commands take the same flags regardless of host (see `node polycli-companion.bundle.mjs --help` or the subsections below). The mapping only describes invocation syntax.

| capability            | Claude Code (`polycli`)               | Codex (`polycli-codex`)                     | Copilot (`polycli-copilot`) | OpenCode (`polycli-opencode`)                                  |
|-----------------------|---------------------------------------|---------------------------------------------|------------------------------|----------------------------------------------------------------|
| setup                 | `/polycli:setup`                      | `/polycli-codex:polycli setup`              | `polycli setup`              | `polycli_run(["setup"])`                                       |
| health                | `/polycli:health`                     | `/polycli-codex:polycli health`             | `polycli health`             | `polycli_run(["health"])`                                      |
| ask                   | `/polycli:ask`                        | `/polycli-codex:polycli ask`                | `polycli ask`                | `polycli_run(["ask", ...])`                                    |
| rescue                | `/polycli:rescue`                     | `/polycli-codex:polycli rescue`             | `polycli rescue`             | `polycli_run(["rescue", ...])`                                 |
| review                | `/polycli:review`                     | `/polycli-codex:polycli review`             | `polycli review`             | `polycli_run(["review", ...])`                                 |
| adversarial-review    | `/polycli:adversarial-review`         | `/polycli-codex:polycli adversarial-review` | `polycli adversarial-review` | `polycli_run(["adversarial-review", ...])`                     |
| status                | `/polycli:status`                     | `/polycli-codex:polycli status`             | `polycli status`             | `polycli_run(["status", ...])`                                 |
| result                | `/polycli:result`                     | `/polycli-codex:polycli result`             | `polycli result`             | `polycli_run(["result", ...])`                                 |
| cancel                | `/polycli:cancel`                     | `/polycli-codex:polycli cancel`             | `polycli cancel`             | `polycli_run(["cancel", ...])`                                 |
| timing                | `/polycli:timing`                     | `/polycli-codex:polycli timing`             | `polycli timing`             | `polycli_timing({provider, history, json})` **or** `polycli_run(["timing", ...])` |

Notes:

- Anywhere a cell shows `...`, pass the same flags you would to the raw CLI: `--provider <p>`, `--json`, `--background`, `<prompt>`, etc. The argument grammar does not change between hosts.
- OpenCode has two tool functions. `polycli_run` is the generic one accepting `argv: string[]`. `polycli_timing` is a convenience wrapper that takes `{provider?, history?, json?}` for the single most-used read-only command. Everything else must go through `polycli_run`.

## Side-by-side examples

The same four operations, across all four hosts.

### Health check

| host          | invocation                                                   |
|---------------|--------------------------------------------------------------|
| Claude Code   | `/polycli:health`                                            |
| Codex         | `/polycli-codex:polycli health`                              |
| Copilot       | `polycli health`                                             |
| OpenCode      | `polycli_run(["health"])`                                    |

### Ask one provider a question

| host          | invocation                                                                 |
|---------------|----------------------------------------------------------------------------|
| Claude Code   | `/polycli:ask --provider qwen Reply with only: OK`                         |
| Codex         | `/polycli-codex:polycli ask --provider qwen Reply with only: OK`           |
| Copilot       | `polycli ask --provider qwen "Reply with only: OK"`                        |
| OpenCode      | `polycli_run(["ask", "--provider", "qwen", "Reply with only: OK"])`        |

### Launch a background review and poll

| host          | invocation                                                                                      |
|---------------|-------------------------------------------------------------------------------------------------|
| Claude Code   | `/polycli:review --provider claude --scope staged --background` → `/polycli:status <jobId> --wait` → `/polycli:result <jobId>` |
| Codex         | same with `/polycli-codex:polycli review …`                                                     |
| Copilot       | same with `polycli review …`                                                                    |
| OpenCode      | `polycli_run(["review","--provider","claude","--scope","staged","--background"])` → `polycli_run(["status",jobId,"--wait"])` → `polycli_run(["result",jobId])` |

### Read timing history for one provider (structured)

| host          | invocation                                                               |
|---------------|--------------------------------------------------------------------------|
| Claude Code   | `/polycli:timing --provider qwen --history 20 --json`                    |
| Codex         | `/polycli-codex:polycli timing --provider qwen --history 20 --json`      |
| Copilot       | `polycli timing --provider qwen --history 20 --json`                     |
| OpenCode      | `polycli_timing({"provider":"qwen","history":20,"json":true})`           |

## Why the surfaces differ

Claude Code first-classes user-visible slash-commands, so ten separate command files produce better autocomplete and discoverability. Codex and Copilot express the same capabilities as a skill with an `$ARGUMENTS`-style dispatcher — the subcommand is data, not a separate registered handler. OpenCode is a tool-calling host, so the natural surface is JSON-schema'd tool functions. See `docs/roadmap.md` Q3 for the deeper question of whether to converge these surfaces; the current answer is "no, document the asymmetry instead."

## When this doc goes stale

- Any new polycli companion subcommand → add a row to both tables in this file.
- Any new host → add a column. Consider whether the host's natural surface is slash-command, skill-subcommand, or tool-call, and follow the pattern from the closest existing host.
- Any change in argument grammar (a new flag that replaces an existing one, a renamed subcommand) → update `node polycli-companion.bundle.mjs --help` first, then the affected rows here.

`npm run validate:host-map` verifies this document against the companion dispatcher,
Claude command files, Codex/Copilot skill command lists, and OpenCode tool surface.
