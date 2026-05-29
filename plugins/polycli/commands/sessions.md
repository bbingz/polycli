---
description: List or purge polycli-recorded upstream session artifacts in this workspace (dry-run by default)
argument-hint: '[list] | purge [--confirm] [--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" sessions "$ARGUMENTS"
```

Present the companion stdout directly.

This command operates ONLY on upstream session files that polycli itself
recorded (a verified exact realpath captured at run time) for THIS workspace.
It never derives a path from a session id and never globs.

- `sessions` / `sessions list` — show recorded artifacts with exists/size.
- `sessions purge` — DRY RUN: prints what would be deleted, deletes nothing.
- `sessions purge --confirm` — actually delete the recorded artifacts. Each
  candidate is re-validated before deletion (rejects symlinks, paths whose
  realpath escaped the provider store root, missing files, and basenames that
  no longer match the recorded session id).

Rules:
- Default is dry-run; deletion requires `--confirm`.
- Preserve JSON or tabular output exactly as emitted.
- Do not auto-run `purge --confirm` after a dry run; surface the plan and let
  the user decide.
