---
name: minimax-cli-runtime
description: Internal helper contract for calling the polycli companion runtime for MiniMax through official mmx-cli.
---

# minimax-cli-runtime

Internal contract for code invoking `scripts/polycli-companion.bundle.mjs` with `--provider minimax`.

## Runtime requirements

- Official `mmx-cli` on PATH as `mmx`, or set `MMX_CLI_BIN` / `MINIMAX_CLI_BIN`.
- `mmx auth status --output json --non-interactive` reports authenticated.
- Node.js >= 20 for this repo runtime.

## Invocation contract

Polycli calls:

```bash
mmx text chat --message "<prompt>" --output json --non-interactive
```

Optional model selection is passed as `--model <model>`. The runtime parses the JSON response directly and no longer depends on Mini-Agent logs or `MINI_AGENT_CONFIG_PATH`.

## Command behavior

| Command | MiniMax behavior |
|---|---|
| `setup --json` / `health --json` | check `mmx --version`, `mmx auth status`, and a sentinel text call |
| `ask` | one stateless text call |
| `review` / `adversarial-review` | one stateless text call over collected diff |
| `rescue` | same text-call runtime; MiniMax is not a workspace-editing agent through this provider |
| `status` / `result` / `cancel` | shared Polycli background job lifecycle |
| `timing` | shared timing history; MiniMax reports session persistence as `ephemeral` |

## Important constraints

- Do not write or read `~/.mini-agent/`; that path belongs to the retired Mini-Agent integration.
- Do not parse `Log file:` stdout for current MiniMax calls.
- Do not report session resume for MiniMax; each `mmx text chat` invocation is stateless.
- MiniMax text output may be Chinese when the prompt is Chinese; quote it verbatim unless the user asks for translation.

## Troubleshooting

- `mmx` missing: install `npm install -g mmx-cli` or set `MMX_CLI_BIN`.
- Auth missing: run `mmx auth login --api-key <token>`.
- Region mismatch: use the upstream `--region global|cn` / `--base-url` mechanism through `extraArgs` only when the user explicitly needs it.
