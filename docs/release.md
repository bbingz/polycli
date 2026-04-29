# Release Flow

This repository publishes in two different ways:

- `Claude` / `Codex` / `Copilot` ship from the GitHub repository marketplace files.
- `OpenCode` ships as the npm package `@bbingz/polycli-opencode`.

## Current Release State

As of `2026-04-29`, the next public patch release prepared in this working tree is:

- GitHub repo: `https://github.com/bbingz/polycli`
- GitHub release: `v0.6.2`
- npm package: `@bbingz/polycli-opencode@0.6.2`
- npm packages: `@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`

Verified release paths:

- `Claude`: marketplace add/install from `bbingz/polycli`
- `Codex`: marketplace add from `bbingz/polycli`
- `Copilot`: marketplace add/install from `bbingz/polycli`
- `OpenCode`: `@bbingz/polycli-opencode`
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
- `claude plugin validate` for the marketplace and Claude host plugin manifests
- dry-run or pack checks for OpenCode, utils, and timing npm packages

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
