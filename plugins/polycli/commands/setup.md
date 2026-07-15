---
description: Check provider installation and status-only authentication; opt in to model auth probes with --probe-auth
argument-hint: '[--provider <claude|copilot|opencode|pi|cmd|agy|gemini|kimi|qwen|minimax|grok>] [--probe-auth] [--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" setup --json "$ARGUMENTS"
```

Render the JSON faithfully.

Rules:
- Do not paraphrase provider state into vague prose.
- If a provider is unavailable or unauthenticated, report its `authDetail` / `availabilityDetail`. `authState: "unknown"` with `authChecked: false` is an intentional skipped auth probe, not a logout.
- The default skips provider authentication checks that would send a model prompt. Use `--probe-auth` only when the caller explicitly wants that probe.
- If `--enable-review-gate` or `--disable-review-gate` was passed, report the returned `stopReviewGate` and `stopReviewGateWorkspace` fields.
- The stop-time review gate invokes only a last-used provider with enforced runtime constraints; it skips instead of running `health` when no safe provider is recorded.
- Do not auto-install anything.
- This is a diagnostic command, not a required preflight before every prompt-bearing command.
