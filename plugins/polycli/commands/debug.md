---
description: Inspect the local polycli run ledger (runs / show / explain) for this repository
argument-hint: '<runs|show <run-id>|explain <run-id>> [--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" debug "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Preserve JSON or tabular ledger output exactly as emitted.
- Do not paraphrase provider decisions or counts.
- Do not auto-run follow-up commands.
