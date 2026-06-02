---
name: grok-prompting
description: Internal guidance for composing Grok (xAI) prompts for coding, review, diagnosis, and research tasks inside the polycli plugin
---

# grok-prompting

Guidance for prompts sent to the Grok Build CLI via `/polycli:ask|rescue|review --provider grok`.

## When to reach for grok
- A fast, capable second opinion on coding/review tasks; `grok-composer-2.5-fast` (Compose 2.5) is
  the default and is tuned for code. Use `-m grok-build` for the heavier build-agent model.
- Reasoning-heavy diagnosis: pass `--effort high` (or `xhigh`/`max`) so grok spends more reasoning.

## Prompt shape
- grok one-shot mode (`-p`) returns a single visible answer — write self-contained prompts; it does
  not carry conversation unless you `--resume <id>` / `--continue`.
- For `/review`, polycli already forces `--permission-mode plan` (read-only) and the review prompt
  forbids tools/edits — keep the focus terse (the diff is supplied for you).
- grok emits a `thought` (reasoning) channel separate from the answer `text`; ask for a concise final
  answer so the visible `text` is self-sufficient, not only reasoning.

## Avoid
- Don't ask grok to run long multi-step tool loops in `ask` — `-p` is a one-shot print mode; for
  agentic work prefer a provider with a persistent session, or expect a single pass.
- Don't paste secrets; polycli redacts argv in the run ledger but the prompt body is sent verbatim.
