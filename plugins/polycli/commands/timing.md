---
description: Show stored polycli timing history and aggregates for this repository
argument-hint: '[--provider <claude|copilot|opencode|pi|cmd|gemini|kimi|qwen|minimax>] [--history <count>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" timing "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Preserve JSON or tabular timing output exactly as emitted.
- Do not paraphrase aggregate percentiles.
- Do not auto-run follow-up commands.
