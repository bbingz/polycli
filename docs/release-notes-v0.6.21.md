# polycli v0.6.21 (draft)

Draft patch on top of `v0.6.20`. This is not a published release note yet; keep it aligned with the current workspace until the release is cut.

## What changed

### Claude tmux TUI defaults

- Claude `ask` and `review` now start a detached tmux TUI session by default instead of using the `claude -p` path.
- Successful Claude tmux launches return `detached: true`, `responseKind: "tmux_tui_session_started"`, `tmuxSession`, `attachCommand`, and a warning that the model response is visible inside the tmux session.
- Fine-grained `ttft` / `gen` / `tail` timing is `unsupported` for Claude tmux TUI mode. `total` measures only tmux startup and prompt submission, with `timingMeta.tmuxDetached: true` and `llmCompletionObserved: false`.
- Claude tmux orchestration forwards only an allowlist of Claude/Anthropic/proxy/cert environment variables into the tmux server and cleans up the created tmux session on SIGINT/SIGTERM during startup.

### Review-remediation fixes

- Claude auth status now treats legacy non-JSON success output as authenticated/unauthenticated when explicit text is present, and marks unknown successful output as inconclusive instead of a logout.
- The session lifecycle hook now cleans up session jobs through the locked `updateState` path instead of a naked load/save write cycle.
- Fixture freshness probes now include the current 11-provider runtime surface, including `cmd`, `agy`, and `grok`.

### Docs and release hygiene

- README capability notes document Claude tmux TUI timing semantics.
- Provider path and v1 public-surface docs document `agy`, `grok`, and the Claude tmux TUI default.
- `CLAUDE.md` scopes the Claude `stream-json` + `--verbose` rule to print/headless mode.

## Verification

- To be filled at release cut.
