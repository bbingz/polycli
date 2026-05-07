# polycli v0.6.14

Patch on top of `v0.6.13` that hardens provider routing and stateless provider calls after qwen hit the `maxSessionTurns=1` failure mode.

## What changed

- Added `docs/provider-paths.md` as the current best-provider path table and periodic review checklist.
- Corrected OpenCode discovery guidance: local `opencode auth list` / `opencode models --refresh` are the source of truth, not an empty `provider` object in `opencode.json`.
- Reworked ask/review defaults for stateless calls:
  - qwen ask now uses plan mode, excludes tools, and is bounded at 20 turns instead of the failing one-turn cap.
  - Claude uses no tools plus an empty strict MCP config.
  - Gemini, OpenCode, Pi, Kimi, cmd, and Copilot use conservative provider-specific constraints.
  - Copilot remains a fallback provider but no longer grants allow-all tool/path/url permissions for ask/review.
- Replaced MiniMax `mini-agent` log scraping with official `mmx-cli` text-chat JSON non-interactive invocation.
- Added MiniMax parsing for real `mmx` `content[]` JSON responses that include separate thinking and text blocks.
- Extended provider drift checks so MiniMax validates both command-local and global `mmx` flags.

## Verification

- `npm run check:provider-paths` passed with Claude, Gemini, qwen, Copilot, OpenCode, Pi, cmd, and MiniMax all ok.
- Live `polycli ask --provider minimax` smoke returned `ok: true` with `MiniMax-M2.7`.
- `npm test` passed with 367/367 tests.
- `npm run release:check` passed before publishing.

## Release artifacts

- GitHub release `v0.6.14`
- npm `@bbingz/polycli-opencode@0.6.14`
- npm `@bbingz/polycli@0.6.14`

Utility packages stay on the independent v1.x cadence and are unchanged.
