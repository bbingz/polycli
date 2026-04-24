---
description: Cancel an active polycli background job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" cancel "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Keep the cancellation result terse.
- If cancellation fails, show the exact failure message.
- Treat "no active job found" as a non-zero no-op.
