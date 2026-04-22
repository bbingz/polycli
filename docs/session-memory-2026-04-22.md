# Session Memory - 2026-04-22

This file is the handoff context for the next Codex session in `/home/user/-Code-/polycli`.

## Current State

Repo:

- path: `/home/user/-Code-/polycli`
- branch: `main`
- remote: `https://github.com/bbingz/polycli.git`
- HEAD: `4d4c684 fix: harden qwen and kimi review flows`
- working tree: clean at the time this file was updated

Release state:

- GitHub repository exists and is public:
  - `https://github.com/bbingz/polycli`
- GitHub Release exists:
  - `v0.3.0`
  - `https://github.com/bbingz/polycli/releases/tag/v0.3.0`
- npm package publish command completed for:
  - `@bbingz/polycli-opencode@0.3.0`
- local OpenCode tarball artifact exists at:
  - [dist/bbingz-polycli-opencode-0.3.0.tgz](/home/user/-Code-/polycli/dist/bbingz-polycli-opencode-0.3.0.tgz)
- published release state is still `v0.3.0`; the latest hardening work is committed locally in `4d4c684` and not yet tagged/released

Important note:

- Immediately after the first npm publish of a new scoped package, `npm view` may briefly return `404` due to registry propagation lag even though the publish command already succeeded.

## Product Boundary

The product is now:

- `@bbingz/polycli-utils`
- `@bbingz/polycli-timing`
- `@bbingz/polycli-runtime`
- host adapters for:
  - Claude
  - Codex
  - GitHub Copilot CLI
  - OpenCode

Legacy repos remain reference-only and must not be edited as part of normal `polycli` work:

- `gemini-plugin-cc`
- `qwen-plugin-cc`
- `kimi-plugin-cc`
- `minimax-plugin-cc`

## What Was Finished

### Runtime integration

Provider runtime integration is implemented for:

- `gemini`
- `kimi`
- `qwen`
- `minimax`

The runtime package includes:

- provider registry
- availability/auth probes
- foreground prompt execution
- streaming execution
- per-provider parser logic
- timing attachment

### Timing

Timing is implemented as a capability-aware local telemetry layer.

Working metrics now are:

- `qwen`
  - `total`
  - `ttft`
  - `gen`
  - `tool`
  - `tail`
  - `runtimePersistence=session`
- `gemini`
  - `total`
  - `ttft`
  - `gen`
  - `tail`
  - `runtimePersistence=session`
- `kimi`
  - `total`
  - `ttft`
  - `gen`
  - `tail`
  - `runtimePersistence=session`
- `minimax`
  - `total`
  - the rest stay explicit `unsupported`

Still intentionally not implemented:

- `cold`
- `retry`

Reason:

- upstream CLIs do not currently expose a stable enough signal to measure them honestly

Do not fake them and do not silently convert them to `missing`.

### Host adapters

Host adapters exist and are bundled:

- Claude plugin at `plugins/polycli`
- Codex plugin at `plugins/polycli-codex`
- Copilot plugin at `plugins/polycli-copilot`
- OpenCode package at `plugins/polycli-opencode`

All host-facing companion entrypoints now use bundled files rather than raw source paths.

### Review and background-job hardening

The post-release stabilization work completed in `4d4c684` specifically hardened `review` flows for `qwen` and `kimi`.

What is now fixed:

- `qwen review`
  - accepts `result-only` success replies when assistant text is absent
  - rejects `result` events marked as error even if the process exits `0`
  - rejects mixed flows where assistant text appears before an error terminal result
  - keeps timing semantics honest by only using `result.result` for timing when no earlier visible text exists
- `kimi review`
  - accepts `assistant.content` as either block array or raw string
  - returns explicit failure text when a run exits cleanly but produces no visible assistant output
- companion / background jobs
  - provider-specific `runtimeOptions` now propagate to background review workers
  - review prompts explicitly forbid tools / extra repo inspection and require a visible final answer
  - background preview deduplicates repeated final text when both assistant text and result summary are emitted

This means foreground and background `review` behavior is now aligned for:

- `qwen`
- `kimi`

## Validation Status

Primary verification command:

```bash
npm test
```

Current result at handoff:

- `90` tests passed
- `0` failed

Additional verified release checks:

```bash
npm run release:check
npm run pack:opencode
```

Claude manifest validation passed for:

- `.claude-plugin/marketplace.json`
- `plugins/polycli/.claude-plugin/plugin.json`

Remote-install smoke checks were completed against `bbingz/polycli`:

- Claude:
  - `claude plugin marketplace add bbingz/polycli`
  - `claude plugin install polycli@polycli-hosts`
- Codex:
  - `codex plugin marketplace add bbingz/polycli`
- Copilot:
  - `copilot plugin marketplace add bbingz/polycli`
  - `copilot plugin install polycli-copilot@polycli-hosts`

OpenCode packaging checks completed:

- `npm publish ./plugins/polycli-opencode --dry-run --access public`
- real `npm publish ./plugins/polycli-opencode --access public` was run successfully after interactive npm auth

Final stabilization verification completed after `4d4c684`:

- local `npm test` passed repeatedly with final result:
  - `90` passed
  - `0` failed
- multi-way review / retest completed on the final code:
  - test lane: green
  - static review lane: `No issues found.`
  - real `qwen review` foreground/background: green, non-empty responses
  - real `kimi review` foreground/background: green, non-empty responses

Observed provider notes:

- `qwen` review timings are functional and now semantically tighter around `tail`
- `kimi` can still show high TTFT variance in foreground runs, but both foreground and background review flows completed successfully within current timeout windows

## Key Files

Read these first in the next session:

1. [README.md](/home/user/-Code-/polycli/README.md)
2. [docs/release.md](/home/user/-Code-/polycli/docs/release.md)
3. [docs/session-memory-2026-04-22.md](/home/user/-Code-/polycli/docs/session-memory-2026-04-22.md)
4. [packages/polycli-runtime/README.md](/home/user/-Code-/polycli/packages/polycli-runtime/README.md)

Important implementation files:

- [packages/polycli-runtime/src/registry.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/registry.js:1)
- [packages/polycli-runtime/src/timing.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/timing.js:1)
- [packages/polycli-runtime/src/qwen.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/qwen.js:1)
- [packages/polycli-runtime/src/kimi.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/kimi.js:1)
- [plugins/polycli/scripts/polycli-companion.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/polycli-companion.mjs:1)
- [plugins/polycli/scripts/tests/integration.test.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/tests/integration.test.mjs:1)
- [plugins/polycli/scripts/tests/host-packaging.test.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/tests/host-packaging.test.mjs:1)

## Suggested Next Focus

The core initial goals are done. Next work should be one of:

1. Cut the next release:
   - decide whether `4d4c684` should become `v0.3.1` or later
   - if yes, repeat `npm run release:check`, tag, GitHub release, and OpenCode publish flow
2. Post-release stabilization:
   - watch for marketplace or npm install issues from real consumption
3. Documentation cleanup:
   - tighten wording now that release is public
4. CI/release automation:
   - automate tag/release/npm publish once desired
5. New capability work:
   - only after confirming upstream providers actually expose the needed signals

## Do Not Regress

- Do not reintroduce source-path coupling from host plugins to monorepo source layout.
- Do not weaken timing semantics by collapsing `unsupported`, `missing`, `zero`, and `measured`.
- Do not claim `cold` or `retry` metrics unless upstreams expose a real signal.
- Do not treat legacy provider repos as active integration targets.
