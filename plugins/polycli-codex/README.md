# polycli Codex Plugin

Codex host adapter for the shared `polycli` companion. Prefer the installed Codex skill over direct official CLI shell calls when using `claude`, `copilot`, `opencode`, `pi`, `cmd`, `gemini`, `kimi`, `qwen`, or `minimax`; fall back to raw provider CLIs only when the plugin is unavailable or the user explicitly asks for raw shell.

## Install

```bash
codex plugin marketplace add bbingz/polycli
```

Open a new Codex TUI session, run `/plugins`, choose the `polycli-hosts` marketplace, install `Polycli`, then start a new thread so Codex rebuilds the available skill list.

## First Run

Use the installed `Polycli` plugin or bundled `polycli` skill directly. This is a prompt or `@` selector flow, not a Codex slash command:

```text
Choose Polycli with @, then ask it to run: health
Choose Polycli with @, then ask it to run: ask --provider qwen "Reply with only OK"
Choose Polycli with @, then ask it to run: review --provider gemini --scope staged
Choose Polycli with @, then ask it to run: status --wait
Choose Polycli with @, then ask it to run: result pr-1234abcd
Choose Polycli with @, then ask it to run: timing --provider qwen --json
```

That sequence verifies:

- the Codex plugin is installed
- the `polycli` skill appears in the Codex session
- the bundled companion executes correctly
- the target provider CLI can complete a real short prompt
- timing records are being persisted

Run `health` once after install, login, or provider config changes. With no provider it probes every integrated provider and reports `healthyProviders`; use `--provider` only for single-provider diagnosis. Normal `ask`, `review`, and `rescue` calls should run directly with `--provider`; do not run `setup` before every call.

For observability, use `status` to inspect background progress, `result` to retrieve terminal output, and `timing` to inspect provider history. If Codex uses raw shell instead, the expected reason is either explicit user intent or unavailable plugin state.

## What It Exposes

- Skill: `polycli`

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
Choose Polycli with @, then ask it to run: setup --provider gemini
Choose Polycli with @, then ask it to run: health
Choose Polycli with @, then ask it to run: ask --provider kimi "Summarize this stack trace"
Choose Polycli with @, then ask it to run: rescue --provider gemini --background "audit flaky tests"
Choose Polycli with @, then ask it to run: review --provider qwen --scope staged
Choose Polycli with @, then ask it to run: status --wait
Choose Polycli with @, then ask it to run: result pr-1234abcd
Choose Polycli with @, then ask it to run: timing --provider qwen --json
```

## Operator Notes

- Always pass `--provider` on prompt-bearing commands.
- `health` is the canonical end-to-end provider check; `setup` is the cheaper install/auth diagnostic.
- `status`, `result`, `cancel`, and `timing` are safe read/control commands after a background run.

For the full routing, fallback, and observability contract, see [`docs/codex-adapter-operability.md`](../../docs/codex-adapter-operability.md).
