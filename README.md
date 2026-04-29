<div align="center">

# polycli

**One command surface across 8 AI coding CLIs, inside the host you already use.**

[![npm: polycli-utils](https://img.shields.io/npm/v/@bbingz/polycli-utils?label=%40bbingz%2Fpolycli-utils&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-utils)
[![npm: polycli-timing](https://img.shields.io/npm/v/@bbingz/polycli-timing?label=%40bbingz%2Fpolycli-timing&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-timing)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**English** · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md)

</div>

---

## What is polycli?

`polycli` lets you drive **`claude`**, **`gemini`**, **`kimi`**, **`qwen`**, **`copilot`**, **`opencode`**, **`pi`**, and **`mini-agent`** (MiniMax) from a single command vocabulary — `health`, `ask`, `review`, `rescue`, `timing` — inside whichever AI host you already use: Claude Code, Codex, GitHub Copilot CLI, or OpenCode.

It is a **utility-only Path B monorepo**: it does not unify provider differences behind fake abstractions, and it does not invent a runtime base class. It composes the official upstream CLIs as subprocesses, exposes one command surface, and surfaces honest capability differences in a four-state timing schema.

## Why polycli?

Most "multi-AI orchestrators" lie about capability differences to fit a uniform API. polycli does the opposite:

- **Honest 4-state timing** — every metric is `measured`, `zero`, `missing`, or `unsupported`, never collapsed. You always know which provider could not be measured vs. which one ran with zero output.
- **No fake unification** — provider differences (session resume, tool support, structured output) are surfaced explicitly in a capability matrix, not hidden behind glue code.
- **Direct CLI passthrough** — spawns the official upstream CLIs (`gemini`, `kimi`, etc.) as subprocesses. You inherit your existing auth and configs; no API keys are sent to polycli, no protocol shims to maintain.
- **Multi-host, single surface** — the same command vocabulary works across Claude Code, Codex, Copilot CLI, and OpenCode. Switch hosts without re-learning.

## Hosts and providers

| Hosts (where polycli is installed) | Providers (what polycli can call) |
|---|---|
| Claude Code · Codex · GitHub Copilot CLI · OpenCode | `claude` · `copilot` · `gemini` · `kimi` · `qwen` · `opencode` · `pi` · `mini-agent` |

See [Capability matrix](#capability-matrix) for what each provider supports.

## Installation

### Claude Code

```bash
claude plugin marketplace add bbingz/polycli
claude plugin install polycli@polycli-hosts
```

### Codex

```bash
codex plugin marketplace add bbingz/polycli
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add bbingz/polycli
copilot plugin install polycli-copilot@polycli-hosts
```

### OpenCode

```bash
opencode plugin @bbingz/polycli-opencode
```

## Quick start

After installing, verify the integration in your host:

```text
# Claude Code
/polycli:health

# Codex
/polycli-codex:polycli health

# GitHub Copilot CLI
polycli health

# OpenCode (call polycli_run with ["health","--json"])
```

`health` runs an end-to-end probe against every provider with valid auth and reports which ones are alive in `healthyProviders`. After that, daily use is direct:

```text
ask --provider qwen "explain this stack trace ..."
review --provider claude            # reviews current git diff
rescue --provider gemini "..."      # longer task, can be backgrounded
```

For longer tasks, append `--background` and use `status <jobId>` / `result <jobId>` to retrieve.

## Core commands

All commands work identically across hosts:

| Command | What it does |
|---|---|
| `setup` | Check provider CLI install + auth status (cheap; no model call) |
| `health` | End-to-end short-prompt probe; returns `healthyProviders` and writes timing |
| `ask` | One-shot prompt |
| `review` | Code review against the current `git diff` |
| `rescue` | Longer triage / analysis task |
| `adversarial-review` | Attack-surface-oriented review |
| `timing` | Inspect timing history and aggregates |
| `status` / `result` / `cancel` | Background-job control |

Run `health` only when (a) integrating a provider for the first time, (b) auth state changes, or (c) a provider command fails. Daily use does not need it as a preamble.

## Capability matrix

Source of truth: [`packages/polycli-runtime/src/registry.js`](./packages/polycli-runtime/src/registry.js) — `RUNTIMES` + `TIMING_SUPPORT`. `✓` = supported. `—` = not applicable by design (reported as `unsupported`, not faked as `missing` or `0`).

| Provider | streaming | sessionResume | structuredOutput | ttft | gen | tail | tool |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `claude` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `copilot` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `gemini` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `kimi` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `qwen` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `mini-agent` | ✓ | — | — | — | — | — | — |
| `opencode` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `pi` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |

Notes:

- `cold` and `retry` are `unsupported` for every provider. Upstream CLIs lack a stable signal, and polycli refuses to fake them. `total` is always `measured`.
- `mini-agent` uses log replay; no session resume, no structured output, no fine-grained streaming timing. This is an upstream limitation, not a polycli bug.
- Only `qwen` declares `tool: true`. When no tool is invoked, `qwen` reports `missing` (observable but absent); the others report `unsupported` (capability-level not tracked). The two states are not interchangeable.

## Timing semantics

The polycli timing contract unifies **state expression**, not numbers. Every metric carries one of four explicit states:

| State | Meaning |
|---|---|
| `measured` | Real, non-zero value |
| `zero` | Explicitly contributed zero |
| `missing` | Measurable in principle, not captured this run |
| `unsupported` | Provider/runtime fundamentally lacks this metric |

This stops cross-provider comparisons from collapsing "no capability", "no data", and "contributed 0" into a single column.

Each timing record also carries:

- `runtimePersistence` — `ephemeral | session | daemon`
- `measurementScope` — `request | turn | job`

## Packages

| Package | Purpose |
|---|---|
| [`@bbingz/polycli-utils`](./packages/polycli-utils) | Args parsing, process exec, stream decoding, NDJSON, atomic save, session-id, stream JSON parsing |
| [`@bbingz/polycli-timing`](./packages/polycli-timing) | Timing schema, runtime validation, percentiles, capability-aware aggregation |
| [`@bbingz/polycli-runtime`](./packages/polycli-runtime) | Provider registry, availability/auth probes, invocation builders, foreground/streaming execution, stream/log parsing |

Plugin distributions:

- [`plugins/polycli`](./plugins/polycli) — Claude Code host plugin
- [`plugins/polycli-codex`](./plugins/polycli-codex) — Codex
- [`plugins/polycli-copilot`](./plugins/polycli-copilot) — GitHub Copilot CLI
- [`plugins/polycli-opencode`](./plugins/polycli-opencode) — OpenCode

## Development

Requirements: Node.js `>=20`.

```bash
npm install
npm test                                       # build:plugins + full suite
node --test packages/polycli-runtime/test/     # focused per-package run
npm run build:plugins                          # rebundle plugin distributions
npm run release:check                          # publish-readiness checks
```

`npm test` already runs `build:plugins` first — do not invoke them sequentially.

## Release

Procedure: [`docs/release.md`](./docs/release.md). Per-version notes: [`docs/release-notes-*.md`](./docs/).

## Architecture and contributing

Read these before opening a PR:

- [`AGENTS.md`](./AGENTS.md) — repository map, editing rules, delivery expectations
- [`CLAUDE.md`](./CLAUDE.md) — Claude Code-specific patches
- [`docs/polycli-proposal.md`](./docs/polycli-proposal.md) — main architecture and product context
- [`docs/roadmap.md`](./docs/roadmap.md) — live open-work list

Hard architectural constraints (please honor):

- Provider-specific protocol parsing belongs in `polycli-runtime`, never in `polycli-utils`.
- The four timing states must not be collapsed. `cold` and `retry` deliberately remain unmeasured (no stable upstream signal).
- Legacy sibling repos (`gemini-plugin-cc` / `qwen-plugin-cc` / `kimi-plugin-cc` / `minimax-plugin-cc`) are read-only references — `grep` is fine, no edits.

## License

[MIT](./LICENSE) — see [`LICENSE`](./LICENSE) and individual package metadata under [`packages/*/package.json`](./packages/).
