# polycli Codex Plugin

Codex host adapter for the shared `polycli` companion.

## What it exposes

- Skill: `polycli-codex:polycli`

The skill runs the bundled companion at `scripts/polycli-companion.bundle.mjs`, so the plugin remains self-contained after marketplace install.

## Install

```bash
codex plugin marketplace add bbingz/polycli
```

## Supported subcommands

- `setup`
- `ask`
- `rescue`
- `review`
- `adversarial-review`
- `status`
- `result`
- `cancel`
- `timing`

## Example

```text
/polycli-codex:polycli review --provider qwen --scope staged
/polycli-codex:polycli rescue --provider gemini --background "audit flaky tests"
/polycli-codex:polycli timing --provider qwen --json
```
