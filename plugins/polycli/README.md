# polycli Claude Plugin

Claude Code host adapter for the shared `polycli` companion.

## Install

```bash
claude plugin marketplace add bbingz/polycli
claude plugin install polycli@polycli-hosts
```

## First Run

Use one provider end to end before trying review flows:

```text
/polycli:setup --provider qwen
/polycli:ask --provider qwen Reply with OK only.
/polycli:timing --provider qwen
```

If `setup` reports `available=false` or `loggedIn=false`, fix the underlying provider CLI first. `polycli` does not install provider CLIs for you.

## Commands

- `/polycli:setup`
- `/polycli:ask`
- `/polycli:rescue`
- `/polycli:review`
- `/polycli:adversarial-review`
- `/polycli:status`
- `/polycli:result`
- `/polycli:cancel`
- `/polycli:timing`

## Common Invocations

```text
/polycli:setup --provider gemini
/polycli:ask --provider kimi Explain this stack trace
/polycli:rescue --provider qwen --background Audit the flaky test and explain the root cause
/polycli:review --provider gemini --scope staged
/polycli:adversarial-review --provider minimax --scope branch auth middleware
/polycli:status --wait
/polycli:result pr-1234abcd
/polycli:cancel pr-1234abcd
/polycli:timing --provider qwen
```

## Provider Model

This plugin is multi-provider. Pass `--provider` explicitly on every prompt-bearing command.

Current provider IDs:

- `claude`
- `copilot`
- `opencode`
- `pi`
- `gemini`
- `kimi`
- `qwen`
- `minimax`

By default, each provider uses the underlying CLI default model. Pass `--model` only when you want an override.

## Background Jobs

Long-running `ask`, `rescue`, `review`, and `adversarial-review` runs can use `--background`.

Flow:

1. Start with `--background`
2. Poll with `/polycli:status <jobId>` or `/polycli:status <jobId> --wait`
3. Read the saved output with `/polycli:result <jobId>`
4. Stop it with `/polycli:cancel <jobId>` if needed

## Repository Layout

- Plugin root: `plugins/polycli`
- Manifest: `plugins/polycli/.claude-plugin/plugin.json`
- Bundled companion: `plugins/polycli/scripts/polycli-companion.bundle.mjs`

The Claude command markdown files shell out to the bundled companion, so installed usage does not depend on this repo's source layout.
