# Release Flow

This repository publishes in three different ways:

- `Claude` / `Codex` / `Copilot` ship from the GitHub repository marketplace files.
- `OpenCode` and the standalone terminal CLI ship as npm packages (`@bbingz/polycli-opencode` and `@bbingz/polycli`).
- Library packages `@bbingz/polycli-utils` and `@bbingz/polycli-timing` ship on their own v1.x cadence.

## Current Release State

As of `2026-05-29`, the current public patch release is:

- GitHub repo: `https://github.com/bbingz/polycli`
- Last published GitHub release: `v0.6.19` — https://github.com/bbingz/polycli/releases/tag/v0.6.19
- Published npm packages: `@bbingz/polycli-opencode@0.6.19` and `@bbingz/polycli@0.6.19`
- Utility packages remain `@bbingz/polycli-utils@1.0.1` and `@bbingz/polycli-timing@1.0.1` (independent v1.x cadence; unchanged in v0.6.19).

Verified release paths:

- `Claude`: marketplace add/install from `bbingz/polycli`
- `Codex`: marketplace add from `bbingz/polycli`, then install `Polycli` from TUI `/plugins`
- `Copilot`: marketplace add/install from `bbingz/polycli`
- `OpenCode`: `@bbingz/polycli-opencode`
- Terminal CLI: `npm install -g @bbingz/polycli`
- public utility packages: `@bbingz/polycli-utils`, `@bbingz/polycli-timing`

Note:

- npm registry read-after-write may briefly lag immediately after publishing a new package version.
- GitHub social preview uses `docs/assets/social-preview.png`; upload it from the repository settings UI when the preview needs refreshing.

## Current Scope

Current runtime scope in-repo:

- `claude`
- `copilot`
- `opencode`
- `pi`
- `cmd`
- `gemini`
- `kimi`
- `qwen`
- `minimax`

Current host scope:

- `Claude` marketplace plugin
- `Codex` marketplace plugin
- `Copilot` marketplace plugin
- `OpenCode` npm package

Model selection behavior remains intentionally simple:

- every provider uses the underlying CLI default model unless `--model` is explicitly passed through runtime options

v0.6.0 absorbed the four legacy provider plugins into the unified `polycli` host surface:

- Kimi session continuation flags: `--resume-last`, `--resume <uuid>`, `--fresh`
- Gemini approval and reasoning flags: `--write`, `--effort low|medium|high`
- Claude Code lifecycle hooks and opt-in stop-time review gate
- 12 provider guidance skills under the `polycli:` namespace
- one generic `polycli:polycli-provider-agent` subagent
- unified namespace UX: `/polycli:<command> --provider <provider>`

The four legacy provider repos are no longer migration targets. They remain reference-only history and should not be edited from this repository.

## Pre-release

Run the full release checks from the repository root:

```bash
npm run release:check
```

`release:check` includes:

- `npm test`, which rebuilds plugin bundles before running package, runtime, plugin, and release-script tests
- `npm run validate:bundles`
- `npm run validate:fixtures`
- `npm run validate:manifests`
- `npm run validate:host-map`
- `npm run validate:codex-adapter`
- `claude plugin validate` for the marketplace and Claude host plugin manifests
- dry-run or pack checks for OpenCode, terminal CLI, utils, and timing npm packages

Run the review hard-constraint drift watcher before release candidates that touch review flow:

```bash
npm run check:review-drift
```

Build a distributable OpenCode tarball:

```bash
npm run pack:opencode
```

The tarball is written to `dist/`.

## GitHub marketplace release

Create or update the public repository:

```bash
gh repo create bbingz/polycli --public --source=. --remote=origin --push
```

For the next release once external publishing is approved, replace `<version>` with the host plugin release version:

```bash
git push origin main
git tag v<version>
git push origin v<version>
gh release create v<version> --title "v<version>" --notes-file docs/release-notes-v<version>.md
```

Consumers install from the repository:

```bash
claude plugin marketplace add bbingz/polycli
claude plugin install polycli@polycli-hosts

codex plugin marketplace add bbingz/polycli
# then open Codex TUI /plugins and install Polycli from polycli-hosts

copilot plugin marketplace add bbingz/polycli
copilot plugin install polycli-copilot@polycli-hosts
```

## OpenCode npm release

Publish the package directory directly:

```bash
npm publish ./plugins/polycli-opencode --access public
```

Consumers install with:

```bash
opencode plugin @bbingz/polycli-opencode
```

If npm account policy requires interactive browser verification, complete the CLI auth challenge and then re-run the same `npm publish` command.

## Terminal CLI npm release (`@bbingz/polycli`)

`@bbingz/polycli` is the PATH-callable wrapper around the bundled companion. It ships in lockstep with the host plugin version (`validate:manifests` enforces alignment).

Pre-publish sanity checks (already wired into `release:check`):

- `npm publish ./packages/polycli-terminal --dry-run --access public` returns `+ @bbingz/polycli@<version>` with no `npm pkg fix` warning.
- `npm pack ./packages/polycli-terminal --dry-run --json` lists `LICENSE`, `README.md`, `package.json`, `bin/polycli.mjs`, and `bin/polycli-companion.bundle.mjs`.

Publish with:

```bash
npm publish ./packages/polycli-terminal --access public
```

Consumers install with:

```bash
npm install -g @bbingz/polycli
polycli health --json
```

The terminal package re-uses the same `polycli-companion.bundle.mjs` that every host adapter ships, so `npm run build:plugins` must succeed before publishing — `validate:bundles` confirms the five companion bundle copies are byte-identical.
