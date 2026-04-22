# polycli Copilot Plugin

GitHub Copilot CLI host adapter for the shared `polycli` companion.

## What it exposes

- Skill: `polycli`

The skill runs the bundled companion at `scripts/polycli-companion.bundle.mjs`, so the installed plugin does not depend on the source repository layout.

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

## Install

```bash
copilot plugin marketplace add bbingz/polycli
copilot plugin install polycli-copilot@polycli-hosts
```
