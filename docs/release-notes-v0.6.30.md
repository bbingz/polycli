# polycli v0.6.30

Agent-native control-plane release on top of `v0.6.29`. Polycli is now self-describing, stricter at the CLI boundary, explicit about run identity and lifecycle, and incrementally observable without becoming a daemon or workflow engine.

The Path B architecture remains unchanged: provider adapters stay flat and explicit, `@bbingz/polycli-runtime` remains private, and host or external workflow systems continue to own orchestration.

## What changed

### Declarative command contract and offline discovery

- Added one declarative command registry as the source for strict parsing, generated root/nested help, typo suggestions, host-map validation, generated terminal metadata, error/output catalogs, and `agent-context`.
- Added deterministic offline `polycli agent-context --json`, exposing build and schema versions, command grammar and effects, provider capabilities, review-safety levels, JSON schemas, typed errors, and exit codes without provider/auth/state probes.
- Registered commands now reject unknown flags before provider invocation and suggest bounded command-local candidates. Tokens after `--` remain literal prompt/focus text.

### Explicit identity and lifecycle reliability

- Split `hostSessionId`, `providerSessionId`, `invocationId`, and `attemptId` across state, job envelopes, and ledger events while keeping old state and ledger records readable without migration.
- Foreground, background, setup, health, cancellation, and recovery paths now publish one attempt-keyed terminal pair; projections no longer apply an older attempt's terminal evidence to a newer attempt.
- Decoder overflow terminates the provider child/process group, escalates to `SIGKILL` when needed, and settles only once.

### Versioned automation and cursor observation

- Added opt-in `--json-v2` for every operational command with schema-validated result discriminators, typed errors, bounded suggestions/next steps, and private-path/secret redaction. Existing `--json` remains compatible and stays the host default.
- Added explicit job selectors (`id:`, `prefix:`, `latest`, `latest-active`, `latest-terminal`) and typed waits that distinguish satisfied, timed out, and terminal-mismatch outcomes.
- Added redacted `debug tail --after --limit --wait` with opaque cursor anchors, bounded pages, explicit expiration/rotation behavior, and raw logs retained as pointers only.

## Verification

- `npm run release:check` passed before publication with 771/771 tests.
- Release verification included regenerated bundle equality, fixture metadata plus strict freshness, manifest/host/Codex adapter validation, review-drift probes, Claude plugin validation, and npm publish dry-runs.
- Three independent spec/code-quality reviews returned `SPEC COMPLIANCE: PASS` and `CODE QUALITY: APPROVED` across Gates A-D.
- Public-registry installation smoke loaded terminal `agent-context` and the OpenCode `PolycliPlugin` entry successfully.

## Release artifacts

- GitHub release `v0.6.30`: https://github.com/bbingz/polycli/releases/tag/v0.6.30 (`publishedAt` `2026-07-15T09:02:11Z`; tag commit `c7e6a278542e9761f55c964ef15236417ed81a25`).
- npm `@bbingz/polycli@0.6.30` (`latest`, registry time `2026-07-15T08:55:13.583Z`, shasum `882e134363d70545c15e060a8da6c1274a2aa1e7`).
- npm `@bbingz/polycli-utils@1.0.4` (`latest`, registry time `2026-07-15T08:51:16.560Z`, shasum `f89c94947199f4d9d61ec6eddca889bb83a95ec4`).
- npm `@bbingz/polycli-opencode@0.6.30` (`latest`, registry time `2026-07-15T08:55:44.359Z`, shasum `9f71767156d2278f3f9bbe0cadc3fd1c90ae289f`).
- `@bbingz/polycli-timing@1.0.2` is unchanged and was not republished.
