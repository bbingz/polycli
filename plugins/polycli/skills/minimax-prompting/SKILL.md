---
name: minimax-prompting
description: Internal guidance for composing MiniMax prompts through official mmx-cli inside the polycli plugin.
---

# minimax-prompting

Guidance for prompt construction for `/polycli:* --provider minimax`.

## Scope

Polycli sends MiniMax prompts through `mmx text chat --output json --non-interactive`. This provider is a stateless text endpoint, not a workspace-editing Mini-Agent runtime.

## Universal rules

1. **Output contract first.** State the expected output format in the first paragraph. For JSON: say "Return ONLY a JSON object matching this schema. No prose before or after. No markdown code fence."
2. **Context in labeled blocks.** Wrap code/diff/docs in labeled blocks (`### Diff to review`, `### Context`, `### User request`).
3. **Language parity.** MiniMax is strong in Chinese; keep instruction language aligned with the user prompt. Schema enum values can stay English when needed.
4. **No tool assumptions.** Do not tell MiniMax it can edit files, run bash, invoke skills, or use MCP tools through this provider.
5. **Review stance stays single-purpose.** For review/adversarial-review, ask only for findings grounded in the supplied diff/context.
6. **Retry hints.** If JSON parsing fails, retry with the schema error and capped previous response so the model can self-correct.

## Practical defaults

- For `ask`: concise direct answer.
- For `review`: findings-first; if no issues, exact no-issue sentence requested by the caller.
- For `rescue`: diagnosis and patch suggestions only; the caller/host performs any actual file edits.
