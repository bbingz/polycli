---
name: qwen-cli-runtime
description: Internal helper contract for calling the polycli companion runtime for Qwen from Claude Code
user-invocable: false
---

# Qwen Runtime

Use this skill only inside the `polycli:polycli-provider-agent` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/polycli-companion.bundle.mjs" rescue --provider qwen "<raw arguments>"`

The companion exposes `setup`, `health`, `ask`, `rescue`, `review`, `adversarial-review`, `status`, `result`, `cancel`, and `timing`. The provider-agent forwards whatever subcommand the caller supplied; this skill describes the rescue path because that is the long-running multi-step variant. Use `ask` for one-shot questions (120s timeout) and `rescue` for multi-step agent tasks (600s timeout).

## Execution rules

- The provider subagent is a **forwarder**, not an orchestrator. Its only job is to invoke the companion once and return stdout unchanged.
- Prefer the helper over hand-rolled `git`, direct `qwen` CLI strings, or other Bash activity.
- Use `rescue` for multi-step agent work; use `ask` for one-shot questions. Do not invent new subcommands.

## Default behavior

- `--model` left unset unless user explicitly specifies.
- `--approval-mode` default is `auto-edit`(v3.1 / Phase 0 case-11 实测:无 TTY 时 auto-deny shell tools,不 hang).
- `--unsafe` switches approval to `yolo`. **Required if you want qwen to run shell/write in background** (否则 qwen auto-deny,`permissionDenials` 非空)。
- **Precedence** (per `buildQwenInvocation` in `packages/polycli-runtime/src/qwen.js`): if `--approval-mode <mode>` is **explicitly** passed, it wins — `--unsafe` does NOT override an explicit `--approval-mode`. `--unsafe` only acts as a shortcut to `yolo` when `--approval-mode` is omitted. Independently, in `--background` mode an effective `yolo` approval still requires `--unsafe` to be set, otherwise the runtime throws — this is a safety guard, not approval-mode resolution.
- `--effort` is a pass-through but the companion drops it (qwen has no equivalent).

## Command selection

- Use exactly one companion invocation per rescue.
- If the forwarded request includes `--background` or `--wait`, keep it as a CLI flag (it's an execution control), not part of the prompt text.
- If the forwarded request includes `--model`, pass through.
- If the forwarded request includes `--resume-last`, pass it through as-is (companion CLI uses `--resume-last`, not `--resume`).
- If the forwarded request includes `--fresh`, strip it and do NOT add `--resume-last`.
- If the forwarded request includes `--unsafe`, pass through.

## Safety rules

- Default to `auto-edit` unless user explicitly asks `--unsafe`.
- Preserve user's task text as-is after stripping routing flags.
- Do not inspect repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work.
- Return stdout of the companion command exactly as-is.
- If Bash call fails or qwen cannot be invoked, return nothing. **Rationale**: the companion already encodes failure (non-zero exit, stderr, `error` field in `--json` output). The subagent re-emitting that as prose would either duplicate or paraphrase it — Claude Code reads the raw failure directly and decides whether to retry, fall back, or surface to the user. "Silent on failure" is a forwarder contract, not a swallow.
