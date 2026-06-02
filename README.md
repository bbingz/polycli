<div align="center">

<img src="./docs/assets/readme-header.svg" alt="polycli: one command surface across AI coding CLIs" width="100%">

# polycli

**One command surface across 9 AI coding CLIs, inside the host you already use.**

[![GitHub release](https://img.shields.io/github/v/release/bbingz/polycli?label=release&color=111827)](https://github.com/bbingz/polycli/releases)
[![CI](https://github.com/bbingz/polycli/actions/workflows/ci.yml/badge.svg)](https://github.com/bbingz/polycli/actions/workflows/ci.yml)
[![npm: polycli](https://img.shields.io/npm/v/@bbingz/polycli?label=%40bbingz%2Fpolycli&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli)
[![npm: polycli-opencode](https://img.shields.io/npm/v/@bbingz/polycli-opencode?label=%40bbingz%2Fpolycli-opencode&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-opencode)
[![npm: polycli-utils](https://img.shields.io/npm/v/@bbingz/polycli-utils?label=%40bbingz%2Fpolycli-utils&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-utils)
[![npm: polycli-timing](https://img.shields.io/npm/v/@bbingz/polycli-timing?label=%40bbingz%2Fpolycli-timing&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-timing)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**English** · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md)

</div>

---

## What is polycli?

`polycli` lets you drive **`claude`**, **`gemini`**, **`kimi`**, **`qwen`**, **`copilot`**, **`opencode`**, **`pi`**, **`cmd`** (Command Code), **`agy`** (Antigravity), **`grok`** (xAI Grok), and **`mmx-cli`** (MiniMax) from a single command vocabulary — `health`, `ask`, `review`, `rescue`, `timing`, `debug`, background-job controls, and terminal inspection — inside whichever AI host you already use: Claude Code, Codex, GitHub Copilot CLI, or OpenCode.

> **polycli is primarily an in-host plugin.** Each host adapter exposes the same `health / ask / review / rescue / timing / debug` vocabulary through that host's native invocation style (e.g. `/polycli:health` in Claude Code, an installed `polycli` skill in Codex). For environments without a supported host, the optional `@bbingz/polycli` terminal package adds a PATH-callable wrapper around the same companion. See [Outside a supported host](#outside-a-supported-host).

It is a **utility-only Path B monorepo**: it does not unify provider differences behind fake abstractions, and it does not invent a runtime base class. It composes the official upstream CLIs as subprocesses, exposes one command surface, and surfaces honest capability differences in a four-state timing schema.

## Latest release: v0.6.19

The latest patch adds upstream session-pollution control and provider-drift maintenance hardening (spec-driven, gated by two Codex review rounds):

- New `polycli sessions [list | purge --confirm]` command cleans up the session/history files upstream CLIs leave under `$HOME`. Dry-run by default; deletion is driven only by ledger-recorded, re-validated realpaths — never a path guess or glob.
- Run-ledger events now record the upstream `sessionId` + a verified `sessionArtifactPath`, so polycli-created sessions are auditable and purgeable.
- `npm run check:fixture-freshness` flags fixtures pinned to a stale CLI version; `REVIEW_FLAG_EXPECTATIONS` is now the single source of review-flag truth (consistency-tested); `check:review-drift` is wired into the release gate.
- No provider behavior, host command grammar, or timing schema changed.

See [`docs/release-notes-v0.6.19.md`](./docs/release-notes-v0.6.19.md).

## Why polycli?

Most "multi-AI orchestrators" lie about capability differences to fit a uniform API. polycli does the opposite:

- **Honest 4-state timing** — every metric is `measured`, `zero`, `missing`, or `unsupported`, never collapsed. You always know which provider could not be measured vs. which one ran with zero output.
- **No fake unification** — provider differences (session resume, tool support, structured output) are surfaced explicitly in a capability matrix, not hidden behind glue code.
- **Direct CLI passthrough** — spawns the official upstream CLIs (`gemini`, `kimi`, etc.) as subprocesses. You inherit your existing local auth and configs; polycli does not collect, upload, or host API keys.
- **Multi-host, single surface** — the same command vocabulary works across Claude Code, Codex, Copilot CLI, and OpenCode. Switch hosts without re-learning.

## Cost vs raw shell calls

A common question: if I can shell-call `gemini -p "..."` directly, why install a plugin?

Answering honestly requires accounting for **probing cost**. A cold Claude conversation that has never invoked a given CLI must first read its `--help` (several KB) before it knows the right flags. polycli encapsulates that invocation knowledge — the host skips the probing turn entirely.

| Scenario | Provider | Bare-shell + probing[^1] | polycli | Δ |
|---|---|---|---|---|
| `ask` | `gemini` | 4069 B | 236 B | **−94%** |
| `ask` | `qwen` | 8242 B | 164 B | **−98%** |
| `review` | `gemini` | 5667 B | 1733 B | **−69%** |
| `review` | `qwen` | 9633 B | 1389 B | **−86%** |
| `rescue` | `gemini` | 5364 B | 1289 B | **−76%** |
| `rescue` | `qwen` | 8848 B | 1026 B | **−88%** |

[^1]: "Bare-shell + probing" = response median bytes + the one-time probing-cost lower bound from `docs/benchmarks/probing-cost.json`. The raw response medians alone (without probing) are visible in the linked results doc.

Without the probing-cost adjustment, boundary bytes between bare-shell and polycli vary by cell, sometimes in polycli's favor, sometimes against — **polycli is not compressing output**, it is amortizing invocation discovery.

Methodology: live CLI calls, N=3 medians (one snapshot, not a stable distribution estimate). Probing cost is a lower bound (`which <provider>` + `<provider> --help`; excludes trial calls and error retries). Bytes ≠ tokens — tokenization rates vary across English, CJK, and code. See [`docs/benchmarks/results-2026-04-29.md`](./docs/benchmarks/results-2026-04-29.md) and [`tasks/bench-vs-bare-cli-spec.md`](./tasks/bench-vs-bare-cli-spec.md) for raw data, caveats, and falsification conditions.

Workflows where bare-shell has **no equivalent at all** (adversarial-review, background job control, session resume, multi-host consistency, etc.) are listed separately in [`docs/benchmarks/capability-matrix.md`](./docs/benchmarks/capability-matrix.md) — those are presence/absence claims, not byte ratios.

## Hosts and providers

| Hosts (where polycli is installed) | Providers (what polycli can call) |
|---|---|
| Claude Code · Codex · GitHub Copilot CLI · OpenCode | `claude` · `copilot` · `gemini` · `kimi` · `qwen` · `opencode` · `pi` · `cmd` · `agy` · `grok` · `minimax` (`mmx-cli`) |

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

Then open a new Codex TUI session, run `/plugins`, choose the `polycli-hosts` marketplace, install `Polycli`, and start a new thread so the bundled skill is available.

After install, prefer the installed `Polycli` plugin or bundled `polycli` skill over direct official CLI shell calls when Codex needs `claude`, `copilot`, `opencode`, `pi`, `cmd`, `agy`, `gemini`, `kimi`, `qwen`, `minimax`, or `grok`. Raw provider CLIs are the fallback only when the plugin is unavailable or the user explicitly asks for raw shell.

### GitHub Copilot CLI

```bash
copilot plugin marketplace add bbingz/polycli
copilot plugin install polycli-copilot@polycli-hosts
```

### OpenCode

```bash
opencode plugin @bbingz/polycli-opencode
```

### Terminal CLI

Install `@bbingz/polycli` when you need a PATH-callable terminal surface outside Claude Code, Codex, Copilot CLI, or OpenCode (e.g. CI runners, ad-hoc shells, agents that cannot host plugins).

```bash
npm install -g @bbingz/polycli
polycli health --json
POLYCLI_RUN_ID=review-20260507 polycli debug explain review-20260507
```

The terminal CLI uses the same companion command behavior as the host adapters. Provider runtime internals remain bundled implementation details.

## Quick start

After installing, verify the integration in your host:

```text
# Claude Code (slash command)
/polycli:health

# Codex (installed plugin/skill, not a slash command)
Choose Polycli with @, then ask it to run: health

# GitHub Copilot CLI (skill word — NOT a PATH binary; only inside the copilot prompt)
polycli health

# OpenCode (tool call — call polycli_run with ["health","--json"])
```

`health` runs an end-to-end probe against every provider with valid auth and reports which ones are alive in `healthyProviders`. After that, daily use is direct. In Codex, either describe the task directly or type `@`, choose Polycli, and ask it to run the companion command:

```text
Choose Polycli with @, then ask it to run: ask --provider qwen "explain this stack trace ..."
Choose Polycli with @, then ask it to run: review --provider claude --scope staged
Choose Polycli with @, then ask it to run: rescue --provider gemini --background "audit flaky tests"
Choose Polycli with @, then ask it to run: status --wait
Choose Polycli with @, then ask it to run: result pr-1234abcd
Choose Polycli with @, then ask it to run: timing --provider qwen --json
```

For longer tasks, append `--background` and use `status <jobId>` / `result <jobId>` to retrieve.

## Outside a supported host

If your agent / harness is **not** Claude Code, Codex, Copilot CLI, or OpenCode (e.g. Aider, Cursor, a bare shell script, a CI runner, or a Codex session that did not install the polycli-codex marketplace), you have three honest options, in order of preference:

1. **Install the host adapter for your environment.** Codex users: run `codex plugin marketplace add bbingz/polycli`, install `Polycli` from `/plugins`, then start a new thread and ask Codex to use Polycli for the desired subcommand. The same host-native pattern applies to Copilot CLI and OpenCode (see [Installation](#installation)).

2. **Install the terminal CLI.** `npm install -g @bbingz/polycli` exposes a PATH-callable `polycli` binary that wraps the same companion behavior as the host adapters. It is the supported entry point when no host plugin can be installed.

3. **Call the underlying provider CLI directly.** polycli is a thin wrapper over `gemini` / `qwen` / `kimi` / etc. — if you only need a one-shot prompt, `qwen -p "..."` works without polycli. You lose: probing-cost amortization, four-state timing, background job control, multi-host consistency. You keep: simplicity.

The other npm packages (`@bbingz/polycli-utils`, `@bbingz/polycli-timing`) are libraries, not routing entry points. `@bbingz/polycli-runtime` exposes the registry but is documented as internal — see [`docs/polycli-v1-public-surface.md`](./docs/polycli-v1-public-surface.md) for the v1 contract.

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
| `debug` | Inspect redacted run-ledger history with `runs`, `show`, and `explain` |
| `tui` | Terminal-only read-only inspector for run-ledger/debug data |
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
| `minimax` (`mmx-cli`) | ✓ | — | ✓ | — | — | — | — |
| `opencode` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `pi` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `cmd` | ✓ | — | — | ✓ | ✓ | ✓ | — |
| `agy` | ✓ | ✓ | — | ✓ | ✓ | ✓ | — |
| `grok` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |

Notes:

- `cold` and `retry` are `unsupported` for every provider. Upstream CLIs lack a stable signal, and polycli refuses to fake them. `total` is always `measured`.
- `minimax` uses official `mmx text chat --output json --non-interactive`; no session resume and no fine-grained streaming timing. `cmd` uses documented Command Code headless mode, where each invocation is a standalone session and stdout is the visible answer.
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
- outcome diagnostics — `outcome`, `exitCode`, `terminationReason`, `responseMatched`, and `errorCode`

## Packages

| Package | Purpose |
|---|---|
| [`@bbingz/polycli`](./packages/polycli-terminal) | PATH-callable terminal CLI wrapper, including the read-only `polycli tui` inspector |
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
npm run validate:codex-adapter                 # Codex trigger/fallback/observability guard
npm run release:check                          # publish-readiness checks
```

`npm test` already runs `build:plugins` first — do not invoke them sequentially.

## Release

Procedure: [`docs/release.md`](./docs/release.md). Per-version notes: [`docs/release-notes-*.md`](./docs/).

## Architecture and contributing

Read these before opening a PR:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contribution workflow and release-facing checks
- [`AGENTS.md`](./AGENTS.md) — repository map, editing rules, delivery expectations
- [`CLAUDE.md`](./CLAUDE.md) — Claude Code-specific patches
- [`docs/polycli-proposal.md`](./docs/polycli-proposal.md) — main architecture and product context
- [`docs/codex-adapter-operability.md`](./docs/codex-adapter-operability.md) — Codex routing, fallback, and observability contract
- [`docs/roadmap.md`](./docs/roadmap.md) — live open-work list

Security reports: see [`SECURITY.md`](./SECURITY.md).

Hard architectural constraints (please honor):

- Provider-specific protocol parsing belongs in `polycli-runtime`, never in `polycli-utils`.
- The four timing states must not be collapsed. `cold` and `retry` deliberately remain unmeasured (no stable upstream signal).
- Legacy sibling repos (`gemini-plugin-cc` / `qwen-plugin-cc` / `kimi-plugin-cc` / `minimax-plugin-cc`) are read-only references — `grep` is fine, no edits.

## License

[MIT](./LICENSE) — see [`LICENSE`](./LICENSE) and individual package metadata under [`packages/*/package.json`](./packages/).
