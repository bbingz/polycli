# Session Memory - 2026-04-22

This file is the handoff context for the next Codex session in `/home/user/-Code-/polycli`.

## Current State

Repo:

- path: `/home/user/-Code-/polycli`
- branch: `main`
- remote: `https://github.com/bbingz/polycli.git`
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

## Validation Status

Primary verification command:

```bash
npm test
```

Current result at handoff:

- `71` tests passed
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

## Key Files

Read these first in the next session:

1. [README.md](/home/user/-Code-/polycli/README.md)
2. [docs/release.md](/home/user/-Code-/polycli/docs/release.md)
3. [docs/session-memory-2026-04-22.md](/home/user/-Code-/polycli/docs/session-memory-2026-04-22.md)
4. [packages/polycli-runtime/README.md](/home/user/-Code-/polycli/packages/polycli-runtime/README.md)

Important implementation files:

- [packages/polycli-runtime/src/registry.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/registry.js:1)
- [packages/polycli-runtime/src/timing.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/timing.js:1)
- [plugins/polycli/scripts/polycli-companion.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/polycli-companion.mjs:1)
- [plugins/polycli/scripts/tests/integration.test.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/tests/integration.test.mjs:1)
- [plugins/polycli/scripts/tests/host-packaging.test.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/tests/host-packaging.test.mjs:1)

## Suggested Next Focus

The core initial goals are done. Next work should be one of:

1. Post-release stabilization:
   - watch for marketplace or npm install issues from real consumption
2. Documentation cleanup:
   - tighten wording now that release is public
3. CI/release automation:
   - automate tag/release/npm publish once desired
4. New capability work:
   - only after confirming upstream providers actually expose the needed signals

## Do Not Regress

- Do not reintroduce source-path coupling from host plugins to monorepo source layout.
- Do not weaken timing semantics by collapsing `unsupported`, `missing`, `zero`, and `measured`.
- Do not claim `cold` or `retry` metrics unless upstreams expose a real signal.
- Do not treat legacy provider repos as active integration targets.
