---
description: Run a long provider-backed task through polycli, in foreground or background
argument-hint: '--provider <claude|copilot|opencode|pi|gemini|kimi|qwen|minimax> [--model <model>] [--background] <prompt>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" rescue "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Use this for longer prompts that may need background execution.
- If the command starts a background job, preserve the follow-up instructions exactly.
- Do not auto-poll `/polycli:status` or auto-fetch `/polycli:result`.
- If the companion fails, surface the error directly.
