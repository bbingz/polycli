---
name: claude-prompting
description: Internal guidance for optimizing prompts before sending to the claude CLI provider
user-invocable: false
---

# Claude Prompt Optimization

Guidance for reshaping user requests into effective prompts for the
`claude` CLI provider. Used by `polycli:polycli-provider-agent` before
forwarding to the companion script.

The `claude` provider is the official Claude Code CLI invoked as a
subprocess. It runs in a **fresh session** that does not inherit the
parent conversation's CLAUDE.md, tool state, or working memory.

## When to reshape

- Parent conversation has rules from CLAUDE.md (language preference,
  formatting conventions, project context) that matter for the answer —
  these will NOT propagate to the child claude session
- Task references "this file" / "the current directory" / "above" — the
  child does not see that context
- User request would benefit from making implicit constraints explicit

## When NOT to reshape

- User provides a clear, self-contained prompt
- Request is simple (e.g., "What is X?")
- User explicitly says "ask claude exactly this"

## Claude-specific notes

- **CLAUDE.md does not propagate.** If language preference or behavioral
  rules from the parent's CLAUDE.md matter, restate them inline in the
  prompt. Verified empirically — the bench at `docs/benchmarks/` showed
  the parent answering in Chinese while the polycli child answered in
  English under identical inputs.
- **Same model family.** The child shares Claude's strengths: structured
  output, code reasoning, markdown formatting. No need to over-specify
  output shape — bullet lists and severity tagging work as expected
  without verbose instructions.
- **Stateless by default.** Each `ask`/`rescue` call is a fresh session.
  Use the companion's `--resume-last` to continue a thread, or restate
  the relevant context inline.
- **Error surface.** The `claude` CLI may signal errors via
  `subtype: "error"` rather than `is_error`. The companion handles this;
  prompt-side defenses are unnecessary.

## CLI invocation contract (informational)

The companion runs `claude --output-format stream-json --verbose` per
the upstream contract. `--verbose` is required when streaming JSON —
omitting it is a CLI error, not a polycli bug. This is enforced inside
the runtime; the prompt does not control it.

## Anti-patterns

- Don't write "as Claude, please...". The child IS Claude. Just give
  the task.
- Don't include the parent conversation's full transcript — restate
  only what's needed.
- Don't assume the child sees `~/.claude/CLAUDE.md`, project-level
  CLAUDE.md, or any user-global rules.
- Don't over-compress prompts into terse fragments. The child has no
  prior context, so missing background hurts more than it helps.

## Review-shaped tasks

When the request is a review:

- Specify file:line references in the expected output
- Ask for severity tagging (critical / high / medium / low)
- Specify "end with one-line verdict" if you want a TL;DR at the bottom
- Provide the code blob inline rather than a path the child cannot read
