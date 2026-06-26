# polycli v0.6.28

Patch on top of `v0.6.27` that publishes the 2026-06-26 provider-state re-verification and the two adapter fixes it found: Copilot exact session resume and MiniMax finish-reason parsing.

The v0.6.22 Claude behavior remains unchanged: ordinary Claude `ask` / `review` calls use headless `claude -p` with plan/no-tools/no-MCP constraints, while explicit/internal tmux TUI runtime support remains available.

## What changed

### Provider-state re-verification

- Re-checked all 11 provider CLIs against live local installs, upstream version sources where available, and adapter flag/auth/argv contracts: `claude`, `gemini`, `qwen`, `copilot`, `opencode`, `pi`, `cmd`, `minimax`, `kimi`, `grok`, and `agy`.
- No version gaps or breaking CLI drift were found. Confirmed local versions include claude 2.1.193, gemini 0.49.0, qwen 0.19.2, copilot 1.0.65, opencode 1.17.11, pi 0.80.2, cmd 0.40.8, mmx 1.0.16, kimi-code 0.19.1, grok 0.2.64, and agy 1.0.12.

### Copilot exact resume

- `buildCopilotInvocation` now emits `--session-id <id>` for resume-by-exact-id instead of `--resume <id>`. Copilot CLI 1.0.65 treats `--resume` as an optional-value flag whose by-id examples use `--resume=<id>`; the documented exact by-id flag is `--session-id <id>`.
- This is reachable from host `ask` / `rescue --provider copilot --resume <id>` paths because the companion maps that option to `resumeSessionId`.

### MiniMax finish reason

- `extractMiniMaxResponseFromMmxJson` now preserves root-level `stop_reason` as `finishReason`, matching Anthropic Messages-shaped `mmx` JSON responses with `content[]` text blocks.

### Docs and durable context

- Refreshed Kimi labels from the old `kimi-code v0.6.0` reference to `kimi-code 0.19.1`.
- Updated provider-paths, roadmap current state, and local project memory with the 11-provider snapshot and the deliberately deferred follow-ups.

## Verification

- Focused runtime tests: Copilot invocation argv and MiniMax `stop_reason` parsing.
- `npm test` and `npm run release:check` green before release.

## Release artifacts

- GitHub release `v0.6.28`: https://github.com/bbingz/polycli/releases/tag/v0.6.28
- npm `@bbingz/polycli@0.6.28` and `@bbingz/polycli-opencode@0.6.28` (`latest`).

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
