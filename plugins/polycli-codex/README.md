# polycli Codex Plugin

Codex host adapter for the shared `polycli` companion.

## Install

```bash
codex plugin marketplace add bbingz/polycli
```

## First Run

Use the installed skill directly:

```text
/polycli-codex:polycli setup --provider qwen
/polycli-codex:polycli ask --provider qwen "Reply with OK only."
/polycli-codex:polycli timing --provider qwen --json
```

That sequence verifies:

- the Codex plugin is installed
- the bundled companion executes correctly
- the target provider CLI is available and authenticated
- timing records are being persisted

## What It Exposes

- Skill: `polycli-codex:polycli`

The skill runs `scripts/polycli-companion.bundle.mjs`, so the plugin remains self-contained after marketplace install.

## Supported Subcommands

- `setup`
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
/polycli-codex:polycli ask --provider kimi "Summarize this stack trace"
/polycli-codex:polycli rescue --provider gemini --background "audit flaky tests"
/polycli-codex:polycli review --provider qwen --scope staged
/polycli-codex:polycli status --wait
/polycli-codex:polycli result pr-1234abcd
/polycli-codex:polycli timing --provider qwen --json
```

## Operator Notes

- Always pass `--provider` on prompt-bearing commands.
- `setup` is the fastest way to distinguish plugin issues from upstream provider CLI issues.
- `status`, `result`, `cancel`, and `timing` are safe read/control commands after a background run.
