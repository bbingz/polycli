# polycli v0.6.1

Docs and legal patch on top of `v0.6.0`. No runtime, plugin, or timing-schema code changes — host plugin and OpenCode npm versions are bumped because the marketplace manifests and `package.json` are how the four hosts identify a "release", not because user-facing behavior changed.

## What changed

### Documentation: international README

`README.md` rewritten from scratch as English-default, international-standard. Added full peer translations:

- [`README.md`](../README.md) — English (default)
- [`README.zh-CN.md`](../README.zh-CN.md) — 简体中文
- [`README.ja.md`](../README.ja.md) — 日本語

The three READMEs are kept in lockstep — not abbreviated versions. Technical terms (`runtime`, `streaming`, `session resume`, `Path B`) stay in English across all locales for consistency.

New structure: hero pitch → why polycli (3 differentiators) → hosts/providers → install → quick start → core commands → capability matrix → timing semantics → packages → development → release → contributing → license.

### Legal: root LICENSE file

Added MIT [`LICENSE`](../LICENSE) at the repository root (`Copyright (c) 2025 bbingz`). Sub-package `package.json` files already declared MIT, but the root file was missing — GitHub `licenseInfo` previously reported `null`. The repository now identifies as MIT-licensed at the GitHub level, fixing the License badge target and meeting community standards.

### Bug fix: dead absolute paths in old README

The `v0.6.0` README contained absolute paths like `/home/user/-Code-/polycli/...` from the maintainer's local machine. These rendered as broken links on GitHub. All internal links in the new READMEs are repo-relative; every referenced path was verified to exist before publish.

### Tooling: latent bug specs filed (not implemented)

A 2026-04-29 default-model audit (running each provider with a "what model are you" prompt and reading polycli's `result.model`) surfaced two latent bugs. Specs filed in [`tasks/model-extraction-fixes.md`](../tasks/model-extraction-fixes.md) for the next code release:

1. **`gemini.js:135`** extracts `Object.keys(stats.models)[0]` (first attempted model), not the actually-used model after `gemini-cli`'s auto-fallback when a preview returns 429 ("No capacity available for model X on the server" — Google server-side preview capacity, not user quota).
2. **`kimi.js:174`** has `readKimiDefaultModel()` reading `~/.kimi/config.toml`, but it's only consumed by `getKimiAuthStatus`, never threaded into `runKimiPromptStreaming` / `runKimiPrompt` results — so `result.model` stays `null` even when config has a default.

Both are non-breaking accuracy improvements. Targeting `v0.6.2` or `v0.7`.

## What did NOT change

- No source changes to `@bbingz/polycli-utils`, `@bbingz/polycli-timing`, or `@bbingz/polycli-runtime`.
- No new commands, providers, or hosts.
- No timing schema, capability matrix, or four-state semantics changes.
- No host plugin behavior changes.

## Verified release paths

- `Claude`: marketplace add/install from `bbingz/polycli`
- `Codex`: marketplace add from `bbingz/polycli`
- `Copilot`: marketplace add/install from `bbingz/polycli`
- `OpenCode`: `npm publish ./plugins/polycli-opencode --access public`

## Upgrade

No action required if `v0.6.0` works for you. To pull the new docs, reinstall in your host:

```bash
# Claude Code
claude plugin install polycli@polycli-hosts

# Codex
codex plugin marketplace add bbingz/polycli

# GitHub Copilot CLI
copilot plugin install polycli-copilot@polycli-hosts

# OpenCode
opencode plugin @bbingz/polycli-opencode
```
