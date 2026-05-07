# Session Memory — 2026-05-07

Public-safe handoff snapshot after the `v0.6.14` provider-path hardening release.

## Current Public State

- GitHub repository: `https://github.com/bbingz/polycli`
- Default branch: `main`
- Current `main` HEAD after post-publish docs closeout: `6e550b3`
- Latest GitHub release: `v0.6.14`
- Published npm packages:
  - `@bbingz/polycli-opencode@0.6.14`
  - `@bbingz/polycli@0.6.14`
  - `@bbingz/polycli-utils@1.0.1`
  - `@bbingz/polycli-timing@1.0.1`

## Completed In This Session

- Investigated qwen `maxSessionTurns=1` failures and removed the brittle one-turn ask cap.
- Added `docs/provider-paths.md` as the current best-provider path table and periodic review checklist.
- Corrected the OpenCode provider finding: local `opencode auth list` / `opencode models --refresh` are the source of truth; an empty `opencode.json` `provider` object does not mean OpenCode is empty.
- Reworked ask/review defaults toward conservative stateless calls:
  - qwen ask uses plan mode, tool exclusion, and a 20-turn bound.
  - Claude uses no tools plus an empty strict MCP config.
  - Copilot remains as fallback but ask/review no longer grant allow-all tool/path/url permissions.
  - Gemini, OpenCode, Pi, Kimi, and cmd use provider-specific conservative constraints.
- Replaced MiniMax `mini-agent` log scraping with official `mmx-cli` text-chat JSON non-interactive invocation.
- Fixed MiniMax real `mmx` response parsing for `content[]` payloads with separate `thinking` and `text` blocks.
- Installed `mmx-cli@1.0.12` locally and verified real `polycli ask --provider minimax` returns `ok: true`.
- Published GitHub release `v0.6.14` and npm packages `@bbingz/polycli-opencode@0.6.14` / `@bbingz/polycli@0.6.14`.
- Updated the GitHub release page after npm publication so it no longer says npm publish is pending.

## Verification Snapshot

- `npm run check:provider-paths`: passed with Claude, Gemini, qwen, Copilot, OpenCode, Pi, cmd, and MiniMax all ok.
- Live `polycli ask --provider minimax`: `ok: true`, model `MiniMax-M2.7`.
- `npm test`: 367/367 passed.
- `npm run release:check`: passed; includes bundle, fixture, manifest, host-map, Codex adapter, Claude plugin validation, and npm dry-run/pack checks.
- npm registry confirmed:
  - `npm view @bbingz/polycli-opencode version` -> `0.6.14`
  - `npm view @bbingz/polycli version` -> `0.6.14`

## Host Update Notes

- Codex marketplace update requires:

```bash
codex plugin marketplace upgrade polycli-hosts
```

- `codex plugin marketplace add bbingz/polycli` is idempotent for an existing marketplace and does not refresh the local clone.
- Local Codex marketplace cache was verified at `6e550b3` with `polycli-codex@0.6.14`.
- Claude users should update or reinstall `polycli@polycli-hosts`, then start a new Claude Code session so plugin commands/skills reload.
- Codex users should update/reinstall `Polycli` from `/plugins`, then start a new Codex thread so plugin skills reload.

## Operational Notes

- MiniMax key belongs in an exported environment variable, not a plain shell variable:

```bash
export MINIMAX_API_KEY='sk-...'
```

- `mmx auth status` may automatically save the env key into `~/.mmx/config.json`; use `mmx auth logout --non-interactive --output json` when a temporary local key write should be cleared.
- No MiniMax key was found in tracked repository files during the release run.
