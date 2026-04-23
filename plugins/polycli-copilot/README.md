# polycli Copilot Plugin

GitHub Copilot CLI host adapter for the shared `polycli` companion.

## Install

```bash
copilot plugin marketplace add bbingz/polycli
copilot plugin install polycli-copilot@polycli-hosts
```

## First Run

Invoke the installed `polycli` skill with:

```text
polycli setup --provider qwen
polycli ask --provider qwen Reply with OK only.
polycli timing --provider qwen --json
```

If the first command shows the provider is unavailable or unauthenticated, fix that provider CLI first. The Copilot host adapter only wraps the shared companion.

## What It Exposes

- Skill: `polycli`

The skill runs the bundled companion at `scripts/polycli-companion.bundle.mjs`, so the installed plugin does not depend on the source repository layout.

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
polycli setup --provider gemini
polycli ask --provider kimi Explain this stack trace
polycli rescue --provider qwen --background Audit the flaky test and explain the root cause
polycli review --provider gemini --scope staged
polycli status --wait
polycli result pr-1234abcd
polycli cancel pr-1234abcd
polycli timing --provider qwen --json
```

## Background Flow

1. Start a long task with `--background`
2. Check progress with `polycli status <jobId>` or `polycli status <jobId> --wait`
3. Read the final output with `polycli result <jobId>`
4. Cancel an active job with `polycli cancel <jobId>`
