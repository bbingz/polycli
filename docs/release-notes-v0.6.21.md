# polycli v0.6.21

Patch on top of `v0.6.20` that ships Claude tmux TUI defaults and the third-party review remediation set. The Path B stance remains intact: provider modules stay flat, provider-specific parsing stays in runtime, and timing capability differences stay explicit.

## What changed

### Claude tmux TUI defaults

- Claude `ask` and `review` now start a detached tmux TUI session by default instead of using the `claude -p` path.
- Successful Claude tmux launches return `detached: true`, `responseKind: "tmux_tui_session_started"`, `tmuxSession`, `attachCommand`, and a warning that the model response is visible inside the tmux session.
- Fine-grained `ttft` / `gen` / `tail` timing is `unsupported` for Claude tmux TUI mode. `total` measures only tmux startup and prompt submission, with `timingMeta.tmuxDetached: true` and `llmCompletionObserved: false`.
- Claude tmux orchestration forwards only an allowlist of Claude/Anthropic/proxy/cert environment variables into the tmux server and cleans up the created tmux session on SIGINT/SIGTERM during startup.

### Review-remediation fixes

- Claude auth status now treats legacy non-JSON success output as authenticated/unauthenticated when explicit text is present, and marks unknown successful output as inconclusive instead of a logout.
- The session lifecycle hook now cleans up session jobs through the locked `updateState` path instead of a naked load/save write cycle.
- The stop-time review gate now uses a per-run `POLYCLI_STOP_REVIEW_*` sentinel token, so echoed `ALLOW:` / `BLOCK:` lines from the previous Claude response cannot be mistaken for the gate verdict.
- Fixture freshness probes now include the current 11-provider runtime surface, including `cmd`, `agy`, and `grok`.

### Docs and release hygiene

- README capability notes document Claude tmux TUI timing semantics.
- Provider path and v1 public-surface docs document `agy`, `grok`, and the Claude tmux TUI default.
- `CLAUDE.md` scopes the Claude `stream-json` + `--verbose` rule to print/headless mode.

## Verification

- `npm run release:check`
- GitHub Actions Node 20 verification

## Release artifacts

- GitHub release `v0.6.21`
- npm `@bbingz/polycli-opencode@0.6.21`
- npm `@bbingz/polycli@0.6.21`

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
