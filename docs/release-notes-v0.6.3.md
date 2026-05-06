# polycli v0.6.3

This patch makes the Codex host adapter more reliable in real agent sessions. The goal is simple: when `polycli-codex` is installed, Codex should discover and use `/polycli-codex:polycli ...` for provider work instead of silently falling back to direct official CLI shell calls.

## Codex adapter operability

- Strengthened the Codex plugin manifest so its default prompts and marketplace text point at the real slash-command entry point.
- Rewrote the Codex skill trigger description to name all runtime providers: `claude`, `copilot`, `opencode`, `pi`, `gemini`, `kimi`, `qwen`, and `minimax`.
- Documented raw official CLI calls as a bounded fallback only when the user explicitly requests raw shell or the plugin is unavailable.
- Added `docs/codex-adapter-operability.md` as the Codex routing, fallback, first-run, and observability contract.

## Observability guardrail

- Added `npm run validate:codex-adapter`.
- Added tests that reject weak Codex guidance where raw CLIs can remain the default path.
- Wired the new guard into CI and `npm run release:check`.
- Updated README, Codex plugin README, release docs, roadmap, and host command map with `health`, `status`, `result`, and `timing` guidance.

## Compatibility

- No provider runtime behavior changes.
- No new public package APIs.
- `@bbingz/polycli-utils` and `@bbingz/polycli-timing` remain at `1.0.1`.
- Host plugin manifests and `@bbingz/polycli-opencode` are updated to `0.6.3`.

## Verification

- `npm run validate:codex-adapter`
- `npm test`
- `npm run release:check`
