---
description: Show the stored final output for a finished polycli job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" result "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Preserve job metadata and the stored response exactly as emitted.
- If the job failed, keep the error block intact.
- Do not summarize or condense the stored output.
