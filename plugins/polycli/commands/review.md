---
description: Run a provider-backed code review on the current diff through polycli
argument-hint: '--provider <gemini|kimi|qwen|minimax> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" review "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Do not auto-fix findings.
- If the companion says there are no changes, tell the user there is nothing to review.
- If the diff was truncated, keep the truncation notice at the top.
- If the user passed `--background`, keep the started-job instructions intact.
