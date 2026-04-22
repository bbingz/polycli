---
description: Ask one provider a question through polycli, optionally in the background
argument-hint: '--provider <claude|copilot|opencode|pi|gemini|kimi|qwen|minimax> [--model <model>] [--background] <prompt>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" ask "$ARGUMENTS"
```

Return the companion stdout directly.

Rules:
- Do not add framing like "Provider says:" before the response.
- If the companion fails, show the error and suggest `/polycli:setup`.
- If the user passed `--background`, keep the started-job instructions intact so they can follow up with `/polycli:status` and `/polycli:result`.
