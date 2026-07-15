---
description: Show active and recent polycli jobs for this repository
argument-hint: '[job-selector] [--job <selector>] [--all] [--wait] [--for <terminal|completed|failed|cancelled>] [--timeout-ms <ms>] [--json|--json-v2]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" status "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- If the output is a markdown table, keep it compact and do not add extra prose around it.
- If the output is a single-job detail block, preserve it verbatim.
- Do not auto-fetch `/polycli:result`.
