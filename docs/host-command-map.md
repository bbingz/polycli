# Host Command Map

polycli ships four host plugins plus an optional standalone Terminal CLI. They expose the same eleven capabilities, but each host's invocation surface is shaped by what the host can express — slash-commands, skill subcommands, tool calls, or a PATH binary. This document is the Rosetta stone.

If you are switching between hosts, read the first two sections (identity + sample command) and ignore the rest. If you are maintaining a host adapter, read the whole thing.

## At a glance

| host plugin          | host           | invocation style                      | example                                      |
|----------------------|----------------|---------------------------------------|----------------------------------------------|
| `polycli`            | Claude Code    | 11 slash commands                     | `/polycli:health`                            |
| `polycli-codex`      | Codex          | 1 installed skill with subcommands    | `Choose Polycli with @, then ask it to run: health` |
| `polycli-copilot`    | GitHub Copilot CLI | skill with subcommands (top-level) | `polycli health`                             |
| `polycli-opencode`   | OpenCode       | 2 tool functions                      | `polycli_run(["health", "--json"])`          |
| `@bbingz/polycli`    | Terminal CLI   | PATH binary                           | `polycli health`                             |

All five dispatch to the same `polycli-companion.bundle.mjs` underneath. Differences are at the surface only; behavior, output format, exit codes, and `--json` shape are identical.

Codex-specific rule: when the installed `polycli` skill from `polycli-codex` is available, prefer the skill over direct official CLI shell calls for `claude`, `copilot`, `opencode`, `pi`, `cmd`, `gemini`, `kimi`, `qwen`, or `minimax`. Raw provider CLIs are the fallback only when the plugin is unavailable or the user explicitly asks for raw shell. Use `health`, `status`, `result`, and `timing` as the observable control plane around prompt-bearing work.

## Command-by-command mapping

All commands take the same flags regardless of host (see `node polycli-companion.bundle.mjs --help` or the subsections below). The mapping only describes invocation syntax.

| capability            | Claude Code (`polycli`)               | Codex (`polycli-codex`)                     | Copilot (`polycli-copilot`) | OpenCode (`polycli-opencode`)                                  | Terminal CLI (`@bbingz/polycli`)        |
|-----------------------|---------------------------------------|---------------------------------------------|------------------------------|----------------------------------------------------------------|------------------------------------------|
| setup                 | `/polycli:setup`                      | `Choose Polycli with @, then ask it to run: setup` | `polycli setup`              | `polycli_run(["setup"])`                                       | `polycli setup`                          |
| health                | `/polycli:health`                     | `Choose Polycli with @, then ask it to run: health` | `polycli health`             | `polycli_run(["health"])`                                      | `polycli health`                         |
| ask                   | `/polycli:ask`                        | `Choose Polycli with @, then ask it to run: ask` | `polycli ask`                | `polycli_run(["ask", ...])`                                    | `polycli ask ...`                        |
| rescue                | `/polycli:rescue`                     | `Choose Polycli with @, then ask it to run: rescue` | `polycli rescue`             | `polycli_run(["rescue", ...])`                                 | `polycli rescue ...`                     |
| review                | `/polycli:review`                     | `Choose Polycli with @, then ask it to run: review` | `polycli review`             | `polycli_run(["review", ...])`                                 | `polycli review ...`                     |
| adversarial-review    | `/polycli:adversarial-review`         | `Choose Polycli with @, then ask it to run: adversarial-review` | `polycli adversarial-review` | `polycli_run(["adversarial-review", ...])`                     | `polycli adversarial-review ...`         |
| status                | `/polycli:status`                     | `Choose Polycli with @, then ask it to run: status` | `polycli status`             | `polycli_run(["status", ...])`                                 | `polycli status ...`                     |
| result                | `/polycli:result`                     | `Choose Polycli with @, then ask it to run: result` | `polycli result`             | `polycli_run(["result", ...])`                                 | `polycli result ...`                     |
| cancel                | `/polycli:cancel`                     | `Choose Polycli with @, then ask it to run: cancel` | `polycli cancel`             | `polycli_run(["cancel", ...])`                                 | `polycli cancel ...`                     |
| timing                | `/polycli:timing`                     | `Choose Polycli with @, then ask it to run: timing` | `polycli timing`             | `polycli_timing({provider, history, json})` **or** `polycli_run(["timing", ...])` | `polycli timing ...`                     |
| debug                 | `/polycli:debug`                      | `Choose Polycli with @, then ask it to run: debug` | `polycli debug`              | `polycli_run(["debug", "runs"])`                              | `polycli debug runs`                     |

Notes:

- Anywhere a cell shows `...`, pass the same flags you would to the raw CLI: `--provider <p>`, `--json`, `--background`, `<prompt>`, etc. The argument grammar does not change between hosts.
- OpenCode has two tool functions. `polycli_run` is the generic one accepting `argv: string[]`. `polycli_timing` is a convenience wrapper that takes `{provider?, history?, json?}` for the single most-used read-only command. Everything else must go through `polycli_run`.
- `polycli tui` is terminal-only. Host plugins continue to use `debug runs/show/explain`; no Claude/Codex/Copilot/OpenCode command is added for the TUI.

## Side-by-side examples

The same four operations, across all four hosts.

### Health check

| host          | invocation                                                   |
|---------------|--------------------------------------------------------------|
| Claude Code   | `/polycli:health`                                            |
| Codex         | `Choose Polycli with @, then ask it to run: health`                |
| Copilot       | `polycli health`                                             |
| OpenCode      | `polycli_run(["health"])`                                    |

### Ask one provider a question

| host          | invocation                                                                 |
|---------------|----------------------------------------------------------------------------|
| Claude Code   | `/polycli:ask --provider qwen Reply with only: OK`                         |
| Codex         | `Choose Polycli with @, then ask it to run: ask --provider qwen Reply with only: OK` |
| Copilot       | `polycli ask --provider qwen "Reply with only: OK"`                        |
| OpenCode      | `polycli_run(["ask", "--provider", "qwen", "Reply with only: OK"])`        |

### Launch a background review and poll

| host          | invocation                                                                                      |
|---------------|-------------------------------------------------------------------------------------------------|
| Claude Code   | `/polycli:review --provider claude --scope staged --background` → `/polycli:status <jobId> --wait` → `/polycli:result <jobId>` |
| Codex         | same with `Choose Polycli with @, then ask it to run: review ...`                                    |
| Copilot       | same with `polycli review …`                                                                    |
| OpenCode      | `polycli_run(["review","--provider","claude","--scope","staged","--background"])` → `polycli_run(["status",jobId,"--wait"])` → `polycli_run(["result",jobId])` |

### Read timing history for one provider (structured)

| host          | invocation                                                               |
|---------------|--------------------------------------------------------------------------|
| Claude Code   | `/polycli:timing --provider qwen --history 20 --json`                    |
| Codex         | `Choose Polycli with @, then ask it to run: timing --provider qwen --history 20 --json` |
| Copilot       | `polycli timing --provider qwen --history 20 --json`                     |
| OpenCode      | `polycli_timing({"provider":"qwen","history":20,"json":true})`           |

## Why the surfaces differ

Claude Code first-classes user-visible slash-commands, so ten separate command files produce better autocomplete and discoverability. Codex and Copilot express the same capabilities as a skill with an `$ARGUMENTS`-style dispatcher — the subcommand is data, not a separate registered handler. Codex does not register a user slash command for `polycli-codex`; install it from `/plugins` and invoke it as a skill. OpenCode is a tool-calling host, so the natural surface is JSON-schema'd tool functions. See `docs/roadmap.md` Q3 for the deeper question of whether to converge these surfaces; the current answer is "no, document the asymmetry instead."

## When this doc goes stale

- Any new polycli companion subcommand → add a row to both tables in this file.
- Any new host → add a column. Consider whether the host's natural surface is slash-command, skill-subcommand, or tool-call, and follow the pattern from the closest existing host.
- Any change in argument grammar (a new flag that replaces an existing one, a renamed subcommand) → update `node polycli-companion.bundle.mjs --help` first, then the affected rows here.

`npm run validate:host-map` verifies this document against the companion dispatcher,
Claude command files, Codex/Copilot skill command lists, and OpenCode tool surface.
