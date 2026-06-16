# polycli v0.6.22

Patch on top of `v0.6.21` that restores Claude `ask` / `review` to the synchronous headless `claude -p` path after Anthropic paused the Agent SDK / `claude -p` dedicated-credit change.

The Path B stance remains intact: provider modules stay flat, provider-specific parsing stays in runtime, and timing capability differences stay explicit.

## What changed

### Claude print defaults restored

- Claude `ask` and `review` now use headless `claude -p` by default again, so callers get a synchronous model answer instead of a detached tmux startup payload.
- The conservative Claude constraints remain in place: `--permission-mode plan --tools "" --mcp-config '{"mcpServers":{}}' --strict-mcp-config`.
- Fine-grained Claude stream timing (`ttft`, `gen`, and `tail`) is measured again for ordinary `ask` / `review` calls.
- Detached tmux TUI mode remains available in runtime for explicit/internal callers, especially workflow cases that need an interactive Claude Code runtime.

### Docs and memory

- README, provider-path, roadmap, v1 public-surface, and workflow design docs now distinguish current `main` behavior from the historical v0.6.21 tmux-default release.
- The audit follow-up and project-local memory records mark the 2026-06-14/15 tmux-default policy as superseded by the 2026-06-16 Anthropic credit pause.

## Verification

- `npm run release:check`
- Live Claude companion smoke: `node plugins/polycli/scripts/polycli-companion.mjs ask --provider claude --json ...` returned `POLYCLI_CLAUDE_PRINT_SMOKE_20260616`.
- Live terminal CLI smoke: `node packages/polycli-terminal/bin/polycli.mjs ask --provider claude --json ...` returned `POLYCLI_TERMINAL_PRINT_SMOKE_20260616`.

## Release artifacts

- GitHub release `v0.6.22`: https://github.com/bbingz/polycli/releases/tag/v0.6.22 (`publishedAt` `2026-06-16T02:52:57Z`)
- npm `@bbingz/polycli-opencode@0.6.22` (`latest`, `time.modified` `2026-06-16T02:51:05.698Z`, shasum `09e36dbd10d2bc72257f3c27ed3b6b910809901e`)
- npm `@bbingz/polycli@0.6.22` (`latest`, `time.modified` `2026-06-16T02:51:14.262Z`, shasum `28b00344f743ec0b37342242c80b81867b293c73`)

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
