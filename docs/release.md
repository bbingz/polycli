# Release Flow

This repository publishes in two different ways:

- `Claude` / `Codex` / `Copilot` ship from the GitHub repository marketplace files.
- `OpenCode` ships as the npm package `@bbingz/polycli-opencode`.

## Current Release State

As of `2026-04-22`, the initial public release has been executed:

- GitHub repo: `https://github.com/bbingz/polycli`
- GitHub release: `v0.3.0`
- npm package: `@bbingz/polycli-opencode@0.3.0`

Verified release paths:

- `Claude`: marketplace add/install from `bbingz/polycli`
- `Codex`: marketplace add from `bbingz/polycli`
- `Copilot`: marketplace add/install from `bbingz/polycli`
- `OpenCode`: package publish command completed successfully

Note:

- npm registry read-after-write may briefly lag immediately after the first publish of a new scoped package.

## Current Post-release Head

Current repo head after stabilization work:

- commit: `4d4c684`
- message: `fix: harden qwen and kimi review flows`

This commit is newer than the current public release artifacts and records post-release hardening work, mainly around:

- `qwen` / `kimi` review parser edge cases
- foreground/background review parity
- background job preview behavior
- timing correctness for `qwen result-only` flows
- expanded runtime and integration coverage

Verification status for this post-release head:

- `npm test`
  - `90` passed
  - `0` failed
- final multi-way retest:
  - static review: `No issues found.`
  - real `qwen review` foreground/background: passed
  - real `kimi review` foreground/background: passed

## Pre-release

Run the full release checks from the repository root:

```bash
npm run release:check
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

For subsequent releases:

```bash
git push origin main
git tag v0.3.0
git push origin v0.3.0
gh release create v0.3.0 dist/bbingz-polycli-opencode-0.3.0.tgz --title "v0.3.0"
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
