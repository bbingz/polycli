---
description: Show stored polycli timing history and aggregates for this repository
argument-hint: '[--provider <claude|copilot|opencode|pi|cmd|agy|gemini|kimi|qwen|minimax|grok>] [--history <count>]'
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
- Percentiles in the text output are comparable only within the displayed cohort: provider, kind, measurement scope, outcome, and runtime persistence. Do not combine or paraphrase them across cohorts.
- Do not auto-run follow-up commands.
