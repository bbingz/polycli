---
description: Check which polycli providers are installed and authenticated
argument-hint: '[--provider <claude|copilot|opencode|pi|gemini|kimi|qwen|minimax>]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" setup --json "$ARGUMENTS"
```

Render the JSON faithfully.

Rules:
- Do not paraphrase provider state into vague prose.
- If a provider is unavailable or unauthenticated, report its `authDetail` / `availabilityDetail`.
- Do not auto-install anything.
- This is a diagnostic command, not a required preflight before every prompt-bearing command.
