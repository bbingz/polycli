---
description: Describe the installed polycli command and provider contract without probes
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" agent-context "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Preserve the machine-readable contract exactly as emitted.
- Do not run `setup`, `health`, or any provider command before or after discovery.
- This command is offline: it must not probe providers, inspect authentication, or connect to a background service.
