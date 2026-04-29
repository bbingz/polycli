# Session Memory - 2026-04-22

This file is the handoff context for the next Codex session in `/home/user/-Code-/polycli`.

## Current State

Repo:

- path: `/home/user/-Code-/polycli`
- branch: `main`
- remote: `https://github.com/bbingz/polycli.git`
- release line: public artifacts are still on `v0.3.0`
- local head state: includes provider expansion, post-review hardening, host-plugin hygiene, real-fixture replay coverage, and local `v0.4.0` release prep beyond `v0.3.0`
- working tree expectation: clean immediately after the latest implementation + documentation commits

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
- published release state is still `v0.3.0`; the latest provider expansion and parser hardening work is local and not yet tagged/released
- next release prep exists locally:
  - release-facing host artifacts are bumped to `0.4.0`
  - release notes draft lives at [docs/release-notes-v0.4.0.md](/home/user/-Code-/polycli/docs/release-notes-v0.4.0.md)
  - internal workspace packages intentionally remain at `1.0.0` to avoid a semver downgrade

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

Runtime coverage now lives in this repo for:

- `claude`
- `copilot`
- `opencode`
- `pi`
- `gemini`
- `kimi`
- `qwen`
- `minimax`

Default model behavior:

- all providers defer to the respective CLI default model unless a runtime `model` override is passed

Legacy repos remain reference-only and must not be edited as part of normal `polycli` work:

- `gemini-plugin-cc`
- `qwen-plugin-cc`
- `kimi-plugin-cc`
- `minimax-plugin-cc`

## What Was Finished

### Runtime integration

Provider runtime integration is implemented for:

- `claude`
- `copilot`
- `opencode`
- `pi`
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

- `claude`
  - `total`
  - `ttft`
  - `gen`
  - `tail`
  - `runtimePersistence=session`
- `copilot`
  - `total`
  - `ttft`
  - `gen`
  - `tail`
  - `runtimePersistence=session`
- `opencode`
  - `total`
  - `ttft`
  - `gen`
  - `tail`
  - `runtimePersistence=session`
- `pi`
  - `total`
  - `ttft`
  - `gen`
  - `tail`
  - `runtimePersistence=session`
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

The original post-release stabilization work hardened `review` flows for `qwen` and `kimi`. The latest follow-up pass then added real-provider parser hardening for the newly integrated adapters.

What is now fixed:

- `qwen review`
  - accepts `result-only` success replies when assistant text is absent
  - rejects `result` events marked as error even if the process exits `0`
  - rejects mixed flows where assistant text appears before an error terminal result
  - keeps timing semantics honest by only using `result.result` for timing when no earlier visible text exists
- `kimi review`
  - accepts `assistant.content` as either block array or raw string
  - returns explicit failure text when a run exits cleanly but produces no visible assistant output
- `claude prompt / review transport`
  - `stream-json` runs now include `--verbose`, matching the real CLI contract
  - JSON-mode success now respects the process exit code instead of trusting parsed payload shape alone
  - subtype-only terminal error results now fail consistently in both sync and streaming paths
- `copilot prompt / review transport`
  - accepts real `assistant.message_delta` events with `data.deltaContent`
  - accepts real `assistant.message` final answers with `data.content`
  - keeps successful full-answer runs from being misclassified as `produced no visible text`
- `opencode prompt / review transport`
  - accepts real `type: "text"` events with `part.text`
  - captures `sessionID` from real CLI output instead of dropping resume identity
- `timing for streamed providers`
  - terminal summary events from `claude` / `copilot` / `opencode` / `pi` no longer extend the visible-text window once real streaming text has already started
  - this keeps `tail` aligned with the last visible token instead of the final bookkeeping/result envelope
- companion / background jobs
  - provider-specific `runtimeOptions` now propagate to background review workers
  - review prompts explicitly forbid tools / extra repo inspection and require a visible final answer
  - background preview deduplicates repeated final text when both assistant text and result summary are emitted

This means foreground and background `review` behavior is now aligned for:

- `claude`
- `copilot`
- `opencode`
- `qwen`
- `kimi`

Latest follow-up fixes completed after the original P0/P1 review batches:

- host plugin hygiene
  - `appendPreview` now deduplicates from an in-memory tail cache instead of re-reading the whole preview log
  - `previewText` slices by code point, so emoji are not split mid-surrogate pair
  - auto-scope review now returns `warnings` when branch fallback diff resolution fails, distinguishing shallow/single-commit repos from true "no changes"
- real saved-stdout replay coverage
  - added replay fixtures for `claude`, `copilot`, `gemini`, `kimi`, `opencode`, `pi`, `qwen`, and `minimax`
  - added a shared `fixture-replay` helper for runtime tests
  - kept the synthetic parser-shape tests; real fixtures are additive, not replacements

## Validation Status

Primary verification command:

```bash
npm test
```

Current result at handoff:

- `119` tests passed
- `0` failed

Latest verification completed after Group 4 / Group 5 and local release prep:

- local `npm test` passed with final result:
  - `184` passed
  - `0` failed
- focused runtime replay regressions passed:
  - `rtk node --test packages/polycli-runtime/test/*.test.js`
  - `101` passed
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

Earlier live smoke checks still remain relevant:

- real bundled-companion smoke asks passed:
  - `claude`: returned `OK`
  - `copilot`: returned `OK`
  - `opencode`: returned `OK`
- earlier real review stabilization checks remain green for:
  - `qwen` foreground/background review
  - `kimi` foreground/background review

Latest real-usage follow-up fixes completed on `2026-04-22`:

- `gemini setup`
  - auth probing no longer treats transient runtime failures as logged-out
  - real fix target: timeouts / capacity failures now surface as `loggedIn=true` with `auth probe inconclusive: ...`
  - this matches live behavior where `setup` had previously said `loggedIn=false` while `ask` still succeeded
- `pi ask / timing`
  - parser now captures top-level `{"type":"session","id":"..."}` envelopes
  - real fix target: `sessionId` is no longer dropped for current live PI JSON mode
  - timing now correctly reports `runtimePersistence=session` instead of falling back to `ephemeral`
- bundle parity
  - plugin bundles were rebuilt after both runtime fixes, so host adapters and tests are aligned with source

Latest review-driven hardening completed on `2026-04-22`:

- P0 fixes shipped:
  - sync `runProviderPrompt` timing now preserves provider capability metadata instead of falsely emitting `unsupported`
  - background job completion and cancel now coordinate through one locked CAS path, so a late worker cannot overwrite `cancelled`
  - corrupt `state.json` now gets renamed to `state.json.corrupt-<timestamp>` before recovery instead of being silently clobbered
  - `spawnStreamingCommand` now escalates timed-out children from `SIGTERM` to `SIGKILL`, and detached runs signal the whole process group
  - session-id matching now accepts modern UUID versions including v7
  - timing aggregation now keeps `zero` out of measured percentiles and exposes per-metric capability state
- selected P1 follow-ups shipped:
  - transient auth-probe handling from `gemini` is now mirrored in `opencode` / `pi` / `kimi` / `qwen`
  - provider prompt paths now use `resolveSessionId` as a stderr fallback instead of trusting stdout JSON only
  - non-zero exit paths no longer fall back to stdout as error text for `copilot` / `kimi` / `pi` / `qwen`

Observed provider notes:

- `claude` requires `--verbose` whenever `--output-format stream-json` is used
- `claude` can emit terminal failures via `subtype: "error"` even when `is_error` is not the only signal; keep sync and streaming error handling aligned
- `copilot` and `opencode` emit event shapes that differ from the earlier synthetic fixtures; keep tests anchored to real saved stdout when changing parsers
- `qwen` review timings are functional and now semantically tighter around `tail`
- `claude` / `copilot` / `opencode` / `pi` timing should ignore duplicate terminal summary text once a stream has already produced visible output
- `kimi` can still show high TTFT variance in foreground runs, but both foreground and background review flows completed successfully within current timeout windows
- `pi` integration is present, but upstream service reliability can still dominate live review outcomes; treat server-side failures as external unless local parsing evidence points otherwise
- `gemini` does not expose a dedicated local auth-status subcommand in the current CLI, so auth probing is necessarily inference-based; do not regress back to treating every timeout / 429 as `loggedIn=false`
- `qwen` should not call `qwen auth status` for setup probing; current hardening relies on the prompt probe only
- `pi` can still choose to invoke tools for trivial prompts in live runs; that behavior appears upstream/host-driven rather than caused by local parsing, so treat it as an environment note unless a local invocation flag is found that suppresses it cleanly

## Key Files

Read these first in the next session:

1. [README.md](/home/user/-Code-/polycli/README.md)
2. [docs/release.md](/home/user/-Code-/polycli/docs/release.md)
3. [docs/archive/session-memory-2026-04-22.md](/home/user/-Code-/polycli/docs/archive/session-memory-2026-04-22.md)
4. [packages/polycli-runtime/README.md](/home/user/-Code-/polycli/packages/polycli-runtime/README.md)

Important implementation files:

- [packages/polycli-runtime/src/registry.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/registry.js:1)
- [packages/polycli-runtime/src/timing.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/timing.js:1)
- [packages/polycli-runtime/src/claude.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/claude.js:1)
- [packages/polycli-runtime/src/copilot.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/copilot.js:1)
- [packages/polycli-runtime/src/opencode.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/opencode.js:1)
- [packages/polycli-runtime/src/pi.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/pi.js:1)
- [packages/polycli-runtime/src/qwen.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/qwen.js:1)
- [packages/polycli-runtime/src/kimi.js](/home/user/-Code-/polycli/packages/polycli-runtime/src/kimi.js:1)
- [plugins/polycli/scripts/polycli-companion.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/polycli-companion.mjs:1)
- [plugins/polycli/scripts/tests/integration.test.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/tests/integration.test.mjs:1)
- [plugins/polycli/scripts/tests/host-packaging.test.mjs](/home/user/-Code-/polycli/plugins/polycli/scripts/tests/host-packaging.test.mjs:1)

## Suggested Next Focus

The core initial goals are done. Next work should be one of:

1. Cut the next release:
   - decide the version that should carry the provider expansion beyond `v0.3.0`
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
- Do not switch adapters away from CLI-default models unless the caller explicitly passes a model override.
