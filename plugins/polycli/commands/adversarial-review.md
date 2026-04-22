---
description: Run an adversarial provider-backed review on the current diff through polycli
argument-hint: '--provider <gemini|kimi|qwen|minimax> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" adversarial-review "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Keep framing focused on design challenge, hidden assumptions, and failure modes.
- Do not auto-fix findings.
- If the diff was truncated, keep the truncation notice at the top.
- If the user passed `--background`, keep the started-job instructions intact.
