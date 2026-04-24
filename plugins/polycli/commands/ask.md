---
description: Ask one provider a question through polycli, optionally in the background
argument-hint: '--provider <claude|copilot|opencode|pi|gemini|kimi|qwen|minimax> [--model <model>] [--background] [--resume-last|--resume <uuid>|--fresh] [--write] [--effort low|medium|high] <prompt>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" ask "$ARGUMENTS"
```

Return the companion stdout directly.

Rules:
- Do not add framing like "Provider says:" before the response.
- If the companion fails, show the error and suggest `/polycli:health --provider <same-provider>` for diagnosis.
- If the user passed `--background`, keep the started-job instructions intact so they can follow up with `/polycli:status` and `/polycli:result`.
- Kimi-only session flags:
  - `--resume-last` continues the most recent Kimi session for the current cwd.
  - `--resume <uuid>` resumes that specific Kimi session after wrapper-side validation.
  - `--fresh` explicitly starts a new Kimi session.
  - These three flags are mutually exclusive for Kimi. Other providers drop them with a one-line note and proceed.
- Gemini-only rescue/ask flags:
  - `--write` switches Gemini to its write approval gate.
  - `--effort low|medium|high` adjusts Gemini's reasoning budget prompt.
  - Other providers drop them with a one-line note and proceed. For Kimi + `--write`, the note is: "Kimi doesn't distinguish plan-mode from write-mode; it will act on what the prompt asks."
