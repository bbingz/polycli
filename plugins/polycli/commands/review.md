---
description: Run a provider-backed code review on the current diff through polycli
argument-hint: '--provider <claude|copilot|opencode|pi|cmd|agy|gemini|kimi|qwen|minimax> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [focus ...]'
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
- The companion does not cap the diff by default. Pass `--max-diff-bytes <n>` only when the caller's own context budget makes truncation necessary.
