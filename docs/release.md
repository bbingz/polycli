# Release Flow

This repository publishes in two different ways:

- `Claude` / `Codex` / `Copilot` ship from the GitHub repository marketplace files.
- `OpenCode` ships as the npm package `@bbingz/polycli-opencode`.

## Current Release State

As of `2026-04-22`, the latest published public release is still:

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

## Current Post-release Work

The public release is still `v0.3.0`, but the local post-release work now extends beyond the original stabilization pass.

Prepared next release line:

- local release target: `v0.4.0`
- release notes draft: [docs/release-notes-v0.4.0.md](/home/user/-Code-/polycli/docs/release-notes-v0.4.0.md)
- external steps still pending: local tag, push, GitHub release, npm publish

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

Latest hardening work fixed issues found by running real provider review / ask flows against the new adapters:

- `claude`
  - `stream-json` mode now adds `--verbose`, matching the real CLI requirement
  - JSON-mode success now respects the process exit status and no longer reports `ok: true` on non-zero exits
  - subtype-only terminal error results are now treated as failures in both sync and streaming paths
- `copilot`
  - parser now accepts the real `assistant.message_delta` / `assistant.message` event schema
  - final answers emitted via `data.content` are preserved instead of being treated as empty output
- `opencode`
  - parser now accepts the real `type: "text"` / `part.text` event schema
  - session IDs emitted as `sessionID` are now captured correctly
- `timing`
  - terminal summary events from `claude` / `copilot` / `opencode` / `pi` no longer extend the visible-text window after real streaming output has already started
- integration fakes
  - fake provider binaries now model these real event shapes more closely, so regressions are caught in CI instead of only in live runs
- host plugin hygiene
  - streamed preview dedupe now uses an in-memory tail cache instead of re-reading the full log file per event
  - preview text slices by code point so emoji do not get split mid-surrogate pair
  - auto-scope review now reports git fallback failures as warnings instead of flattening them into plain "no changes"
- real fixture replay
  - parser tests now replay saved real stdout for all eight providers
  - mini-agent replay also includes the captured log body parsed by the runtime

Verification status for the current post-release work:

- `npm test`
  - `184` passed
  - `0` failed
- focused runtime replay regression tests:
  - `rtk node --test packages/polycli-runtime/test/*.test.js`
  - `101` passed
  - `0` failed

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

For the next release once external publishing is approved:

```bash
git push origin main
git tag v0.4.0
git push origin v0.4.0
gh release create v0.4.0 dist/bbingz-polycli-opencode-0.4.0.tgz --title "v0.4.0"
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
