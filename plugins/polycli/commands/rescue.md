---
description: Run a long provider-backed task through polycli, in foreground or background
argument-hint: '--provider <claude|copilot|opencode|pi|gemini|kimi|qwen|minimax> [--model <model>] [--background] [--resume-last|--resume <uuid>|--fresh] [--write] [--effort low|medium|high] <prompt>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" rescue "$ARGUMENTS"
```

Present the companion stdout directly.

Rules:
- Use this for longer prompts that may need background execution.
- If the command starts a background job, preserve the follow-up instructions exactly.
- Do not auto-poll `/polycli:status` or auto-fetch `/polycli:result`.
- If the companion fails, surface the error directly.
- Kimi-only session flags:
  - `--resume-last` continues the most recent Kimi session for the current cwd.
  - `--resume <uuid>` resumes that specific Kimi session after wrapper-side validation.
  - `--fresh` explicitly starts a new Kimi session.
  - These three flags are mutually exclusive for Kimi. Other providers drop them with a one-line note and proceed.
- Gemini-only rescue/ask flags:
  - `--write` switches Gemini to its write approval gate.
  - `--effort low|medium|high` adjusts Gemini's reasoning budget prompt.
  - Other providers drop them with a one-line note and proceed. For Kimi + `--write`, the note is: "Kimi doesn't distinguish plan-mode from write-mode; it will act on what the prompt asks."
