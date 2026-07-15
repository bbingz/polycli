---
name: kimi-cli-runtime
description: Internal helper contract for calling the polycli companion runtime for Kimi from Claude Code
---

# kimi-cli-runtime

Internal contract for code invoking `scripts/polycli-companion.bundle.mjs`. Not user-facing. Claude uses this skill implicitly when dispatched via `/polycli:* --provider kimi` commands or the `polycli:polycli-provider-agent` subagent.

> **Migrated to `kimi-code` (initial migration 2026-06-02).** This provider wraps the new `kimi-code` CLI, NOT the legacy Python `kimi-cli`. Local CLI help was rechecked against `kimi-code` 0.23.6 on 2026-07-14; preserve the current adapter's explicit one-shot and resume contracts rather than carrying forward legacy Python CLI flags.

## Runtime requirements

- The `kimi` (kimi-code) binary on PATH — local verification used `kimi --version` = `0.23.6`. The legacy Python `kimi-cli` install is migrated (marker `~/.kimi-code/.migrated-to-kimi-code`).
- Auth is **CLI-managed** — the companion never injects `KIMI_API_KEY` or similar; the user runs `kimi login`. Rotating tokens is `kimi logout && kimi login`, no plugin work.
- Default model + config live in `~/.kimi-code/config.toml`.
- Node.js ≥ 18. Zero npm dependencies — plugin uses only Node built-ins.

## Companion script subcommands

| Subcommand | Purpose | JSON shape |
|---|---|---|
| `setup [--probe-auth] --json` | Check installation and auth state | Array of `{provider, available, loggedIn, authState, authChecked, authProbeCost, authDetail, model, ...}`; default skips Kimi's model-based auth ping, `--probe-auth` opts in |
| `health --json` | End-to-end ping (uses `POLYCLI_HEALTH_OK` sentinel) | `{provider, healthy, detail, model}` |
| `ask [options] "<prompt>"` | One-shot query (120s timeout) | streaming events then `{response, sessionId}` |
| `rescue [options] "<prompt>"` | Multi-step agent task (600s timeout, supports `--background`) | `{response, sessionId}` foreground; `{jobId, status}` background |
| `review [options]` / `adversarial-review [options]` | Code review on current diff (prompt-only for kimi) | `{verdict, summary, findings[], next_steps[]}` family — see `runReview` for exact keys |
| `status [jobId]` / `result [jobId]` / `cancel [jobId]` | Background job lifecycle | per provider parity |
| `timing [options]` | Inspect persisted timing history | `{provider, history[]}` |

## Current kimi-code invocation facts

Grounded in `packages/polycli-runtime/src/kimi.js` (the merged adapter) and local `kimi --help` on `kimi-code` 0.23.6 (2026-07-14). Do NOT re-derive against the old Python CLI.

- **Version flag**: `kimi -V` / `kimi --version` → local verification `0.23.6`.
- **One-shot headless**: `kimi -p "<prompt>" --output-format stream-json` (optionally `-m <model>`). The `-p`/`--prompt` runner is itself non-interactive — there is no `--print` / `--input-format` (those were the old CLI). `--output-format` ∈ `{text, stream-json}`.
- **Prompt safety stance**: the companion passes no `--yolo`, `--auto`, or `--plan` flag on the `-p` path. Do not add one without a fresh non-interactive compatibility proof.
- **Event shape** (`stream-json`, per-message JSONL): `{role, content, ...}`. `content` may be a **string** OR a list of `{type, text}` blocks. `role` ∈ `{assistant, tool, meta}`. A single run can emit multiple lines — accumulate.
- **Session id is STRUCTURED, in stdout**: it arrives in a `{role:"meta", type:"session.resume_hint", session_id:"session_<uuid>"}` event. Read it from there, keeping the `session_` prefix. NEVER scan prose stdout for a bare UUID (drops the prefix; can fabricate from a UUID the user asked about). `sessionId` is `null` when no `session.resume_hint` is emitted.
- **Resume**: `--session <id>` (alias `-S`) resumes a specific session; `-c` / `--continue` continues the last session for the cwd. `-r` is not used by polycli and is not advertised by the current root help.
- **Config / default model**: top-level `default_model` in `~/.kimi-code/config.toml`. The per-turn step budget moved to `[loop_control]` there — `--max-steps-per-turn` is **no longer a CLI flag**.
- **Auth probe**: a plain non-interactive `-p` ping (no step flag), 30s timeout. Default `setup --json` skips this model-based probe; use `setup --probe-auth --json` when the caller explicitly wants it. Transient failures (timeout/429/network) remain inconclusive rather than proving logout.
- **Model**: `-m <name>` selects the model; validate against `configured_models` (config `[models.<name>]` sections) before spawning.

## Exit code map

| exit | Meaning | User-facing message |
|---|---|---|
| 0 | Success | (parse JSONL, render response) |
| 1 | Unknown/unset model | "Model `<X>` not configured in `~/.kimi-code/config.toml`" |
| 2 | Usage error (bad flag) | Show stderr error box verbatim |
| 124 | Local timeout (companion-enforced) | "kimi timed out after Xs" |
| 130 | SIGINT | "Cancelled by user" |
| 143 | SIGTERM (external kill; distinct from 124) | "Request was interrupted" |
| other | Internal | Show exit code + stderr first 200 chars |

## Assistant text extraction

`extractKimiText` handles both content shapes:

```js
// content may be a string …
if (typeof event.content === "string") return event.content;
// … or a list of blocks (only type === "text" contributes; drop "think")
return (event.content || [])
  .filter(b => b && b.type === "text" && typeof b.text === "string")
  .map(b => b.text)
  .join("");
```

- Drop `type === "think"` blocks by default (reasoning channel).
- Skip unknown block types without erroring.
- `role:"tool"` events are collected separately for `/polycli:rescue --provider kimi` job tracking; ignored for `/polycli:ask`.

## Review

`/review --provider kimi` and `/adversarial-review --provider kimi` are **prompt-only** (like minimax): no independently verified flag-based no-tool/read-only lever is available for Kimi prompt mode, so no extra review flags are passed. Read-only behavior is enforced through the prompt contract; `scripts/check-review-cli-drift.mjs` guards the load-bearing `-p` / `--output-format` invocation flags so an upstream rename is caught.

## Do NOT

- Do NOT add `--yolo`, `--auto`, or `--plan` to `-p` without a fresh non-interactive compatibility proof.
- Do NOT scan prose stdout for a session UUID — read the structured `session.resume_hint` event.
- Do NOT pass legacy `--print` / `--input-format` / `--max-steps-per-turn`; do not use `-r` in the polycli adapter.
- Do NOT write to `~/.kimi-code/`.
- Do NOT parse the kimi TUI — always go through `-p`.
