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
polycli health
polycli timing --provider qwen --json
```

Run `health` once after install, login, or provider config changes. With no provider it probes every integrated provider and reports `healthyProviders`; use `--provider` only for single-provider diagnosis. Normal `ask`, `review`, and `rescue` calls should run directly with `--provider`. If `health` shows the provider is unavailable or the probe fails, fix that provider CLI first. The Copilot host adapter only wraps the shared companion.

## What It Exposes

- Skill: `polycli`

The skill runs the bundled companion at `scripts/polycli-companion.bundle.mjs`, so the installed plugin does not depend on the source repository layout.

## Supported Subcommands

- `agent-context`
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
- `debug`
- `sessions`

## Common Examples

```text
polycli setup --provider gemini
polycli agent-context --json
polycli health
polycli ask --provider kimi Explain this stack trace
polycli rescue --provider qwen --background Audit the flaky test and explain the root cause
polycli review --provider gemini --scope staged
polycli status --wait
polycli result pr-1234abcd
polycli cancel pr-1234abcd
polycli timing --provider qwen --json
polycli debug runs
polycli debug tail --after evt_abc --limit 100 --wait --json-v2
polycli sessions list --json
```

Operational commands retain legacy `--json` as the host default and offer opt-in `--json-v2` envelopes. Job commands also accept explicit `--job id:<id>|prefix:<prefix>|latest|latest-active|latest-terminal` selectors; `status --wait --for <state>` reports typed satisfaction, timeout, or terminal mismatch.

## Background Flow

1. Start a long task with `--background`
2. Check progress with `polycli status <jobId>` or `polycli status <jobId> --wait`
3. Read the final output with `polycli result <jobId>`
4. Cancel an active job with `polycli cancel <jobId>`
