# polycli v0.6.31

Review-remediation patch on top of `v0.6.30`. This release closes every confirmed issue from the post-release comprehensive review while preserving the Path B boundary: provider adapters remain flat and explicit, the runtime package remains private, and no provider protocol framework is introduced.

## What changed

### Truthful CLI and observation contracts

- A no-change background review now returns the real skipped result instead of a synthetic `job.started` record with no job.
- `setup` and `health` reject ambiguous positional-plus-flag provider targets before provider, auth, or state access.
- TUI agent-context effects now disclose local recovery-state writes; default status keeps all active jobs visible while bounding terminal history.
- Every persisted ledger preview is sanitized at the storage boundary.

### Bounded provider execution and safe prompt transport

- On POSIX, timeout, abort, decoder overflow, termination failure, and missing-close paths now terminate or escalate the provider process group and settle exactly once with a canonical typed error. Windows streaming paths retain a direct-child termination fallback.
- Aggregate stdout and stderr capture are independently bounded while total byte counts remain available for diagnostics.
- Claude and Gemini move oversized prompts to verified stdin transport. Argv-only providers reject unsafe command lines before spawn with typed `argument_list_too_long` guidance; review input is still unlimited unless the caller explicitly chooses `--max-diff-bytes`.
- Claude, Copilot, OpenCode, and Qwen no longer promote arbitrary UUIDs from answer prose into provider session identity.

### Recoverable background lifecycle

- Cancellation persists a non-terminal intent and publishes `cancelled` only after worker identity is verified and the worker is stopped.
- SessionEnd delegates to the authoritative cancel path under one deadline that also bounds state/ledger locks, process identity probes, and Windows `taskkill` calls.
- Config, log, open, and spawn failures use a private recovery sidecar so a transient pre-envelope failure cannot leave a permanent pidless queued job.
- Worker, cancellation, and terminal-ledger races preserve one complete terminal pair and clean owned runtime/config/recovery artifacts before terminal state becomes observable.

### Reproducible generated artifacts

- `validate:bundles` now renders expected bundles and terminal metadata from source with esbuild `write:false`, then compares every tracked artifact byte-for-byte without overwriting it.
- GitHub CI and `release:check` run that freshness gate before `npm test`, which performs the in-place build.
- A regression test changes source while all five tracked bundles remain mutually identical and proves the pre-build validator rejects them.

## Compatibility

- Existing public `--json` payloads remain compatible; JSON v2 stays opt-in.
- Default review collection remains unbounded; only explicit `--max-diff-bytes` truncates input.
- `@bbingz/polycli-runtime` remains private and provider modules remain flat.
- Host plugins, OpenCode, and terminal CLI move to `0.6.31`; `@bbingz/polycli-utils` moves to `1.0.5`; `@bbingz/polycli-timing` remains `1.0.2`.

## Verification

- Five scoped implementation groups each passed independent spec-compliance and code-quality review.
- The local full suite passed: 906 tests, 906 passed, 0 failed.
- `npm run release:check` passed source-derived bundle freshness, strict fixture freshness, manifests, host maps, Codex guidance, installed-CLI review flag drift, both Claude plugin validations, and all npm package dry-runs.
- Native Windows execution was not available. Windows argv budgeting and `taskkill`/deadline branches were covered by deterministic simulation; only POSIX process-group and live process-tree behavior received native execution coverage.
- PR CI and publication evidence are recorded before the GitHub release is created.

## Release artifacts

- GitHub release: `v0.6.31`
- npm: `@bbingz/polycli@0.6.31`
- npm: `@bbingz/polycli-opencode@0.6.31`
- npm: `@bbingz/polycli-utils@1.0.5`
- unchanged npm package: `@bbingz/polycli-timing@1.0.2`
