# polycli v0.6.4

This patch corrects the Codex adapter install and invocation guidance after real Codex TUI verification showed the v0.6.3 docs described a non-existent slash command.

## Codex install surface correction

- Codex users now get the real flow: run `codex plugin marketplace add bbingz/polycli`, install `Polycli` from TUI `/plugins`, then start a new thread so the `polycli` skill is loaded.
- Codex examples now use `Choose Polycli with @, then ask it to run: ...` instead of a fake slash-command form.
- The Codex skill now resolves the plugin root from its installed `SKILL.md` file path, rather than requiring a manually exported `PLUGIN_ROOT`.

## Regression guardrail

- `npm run validate:codex-adapter` now rejects `/polycli-codex:polycli` examples and requires Codex skill examples for daily commands.
- `npm run validate:host-map` now checks the host map for the actual Codex skill surface.

## Compatibility

- No provider runtime behavior changes.
- No public utility package changes.
- `@bbingz/polycli-utils` and `@bbingz/polycli-timing` remain at `1.0.1`.
- Host plugin manifests and `@bbingz/polycli-opencode` are updated to `0.6.4`.

## Verification

- `npm run validate:codex-adapter`
- `npm run validate:host-map`
- `npm test`
- `npm run release:check`
