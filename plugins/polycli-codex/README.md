# polycli Codex Plugin

Codex host adapter for the shared `polycli` companion. Prefer the installed Codex skill over direct official CLI shell calls when using `claude`, `copilot`, `opencode`, `pi`, `gemini`, `kimi`, `qwen`, or `minimax`; fall back to raw provider CLIs only when the plugin is unavailable or the user explicitly asks for raw shell.

## Install

```bash
codex plugin marketplace add bbingz/polycli
```

## First Run

Use the installed skill directly:

```text
/polycli-codex:polycli health
/polycli-codex:polycli ask --provider qwen "Reply with only OK"
/polycli-codex:polycli review --provider gemini --scope staged
/polycli-codex:polycli status --wait
/polycli-codex:polycli result pr-1234abcd
/polycli-codex:polycli timing --provider qwen --json
```

That sequence verifies:

- the Codex plugin is installed
- the bundled companion executes correctly
- the target provider CLI can complete a real short prompt
- timing records are being persisted

Run `health` once after install, login, or provider config changes. With no provider it probes every integrated provider and reports `healthyProviders`; use `--provider` only for single-provider diagnosis. Normal `ask`, `review`, and `rescue` calls should run directly with `--provider`; do not run `setup` before every call.

For observability, use `status` to inspect background progress, `result` to retrieve terminal output, and `timing` to inspect provider history. If Codex uses raw shell instead, the expected reason is either explicit user intent or unavailable plugin state.

## What It Exposes

- Skill: `polycli-codex:polycli`

The skill runs `scripts/polycli-companion.bundle.mjs`, so the plugin remains self-contained after marketplace install.

## Supported Subcommands

- `setup`
- `health`
- `ask`
- `rescue`
- `review`
- `adversarial-review`
- `status`
- `result`
- `cancel`
- `timing`

## Common Examples

```text
/polycli-codex:polycli setup --provider gemini
/polycli-codex:polycli health
/polycli-codex:polycli ask --provider kimi "Summarize this stack trace"
/polycli-codex:polycli rescue --provider gemini --background "audit flaky tests"
/polycli-codex:polycli review --provider qwen --scope staged
/polycli-codex:polycli status --wait
/polycli-codex:polycli result pr-1234abcd
/polycli-codex:polycli timing --provider qwen --json
```

## Operator Notes

- Always pass `--provider` on prompt-bearing commands.
- `health` is the canonical end-to-end provider check; `setup` is the cheaper install/auth diagnostic.
- `status`, `result`, `cancel`, and `timing` are safe read/control commands after a background run.

For the full routing, fallback, and observability contract, see [`docs/codex-adapter-operability.md`](../../docs/codex-adapter-operability.md).
