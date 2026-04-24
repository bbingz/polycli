---
description: Run end-to-end health probes and report healthy polycli providers
argument-hint: '[--provider <claude|copilot|opencode|pi|gemini|kimi|qwen|minimax>] [--model <model>] [--timeout-ms <ms>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" health "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- With no `--provider`, probe every integrated provider and report `healthyProviders`.
- With `--provider`, probe only that provider.
- Use this after installing, logging in, changing provider config, or debugging a failed provider run.
- Do not run this before every normal `ask`, `review`, or `rescue` call.
- If the probe fails, preserve the availability, auth, probe, and response details exactly as emitted.
