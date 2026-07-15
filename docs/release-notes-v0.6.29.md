# polycli v0.6.29

Patch on top of `v0.6.28` that makes the current provider and host surface release-ready: durable background-job terminal state, current fixture lifecycle/freshness, current provider CLI contracts, and comparable timing aggregation.

The Path B architecture remains unchanged. Provider modules stay flat, `@bbingz/polycli-runtime` stays private, and the stable OpenCode runtime remains `opencode`.

## What changed

### Durable background jobs and observability

- Background jobs now make terminal result envelopes, timing records, and paired run-ledger events durable together. Cancellation keeps the job active until its worker stop and ledger transaction are verified, and recovery handles dead workers or preserved terminal intents without publishing partial terminal state.
- Session artifact handling records only verified paths and purge continues to operate only on recorded, validated artifacts.
- Default `setup` uses install plus status-only authentication probes; model-based auth probes require explicit `--probe-auth`.

### Fixture freshness and capture lifecycle

- Refreshed real parser fixtures using authorized local captures, including Claude Code `2.1.210`; fixtures remain minimally scrubbed replay inputs rather than raw account transcripts.
- The Gemini Code Assist individual Google sign-in capture route is recorded as `retired`. API Key and Vertex AI remain separate, unverified routes.
- The inactive local Copilot subscription capture route is `archived`: its parser fixtures stay replayed, but freshness probing is paused until an explicitly authorized re-capture. This does not remove the Copilot runtime provider or host plugin.
- `npm run release:check` now blocks active stale fixture versions with strict freshness while reporting valid archived and retired fixture rows separately.
- Added an OpenCode2 preview fixture compatibility channel without replacing stable `opencode` runtime behavior.

### Provider, timing, and storage contracts

- Copilot terminal events can replace an earlier session id, so exact-resume status reflects the final structured session id.
- OpenCode uses its current `--auto` execution mode and preserves structured `session.error` messages.
- Review safety drift checks cover current provider help surfaces and distinguish enforced, prompt-only, and unsupported automatic stop-review behavior.
- `@bbingz/polycli-utils@1.0.3` adds atomic NDJSON batch publication and retention grouping for logical record pairs.
- `@bbingz/polycli-timing@1.0.2` validates declared optional fields and aggregates percentiles by comparable provider/kind/scope/outcome/persistence cohorts instead of pooling incompatible records.

## Verification

- `npm run release:check` passed before publication (618/618 tests).
- Release verification includes the full test suite, regenerated bundle equality, fixture metadata plus strict freshness, manifest/host/Codex adapter validation, review-drift probes, Claude plugin validation, and npm publish dry-runs.
- Registry read-after-write confirmed every published version is the `latest` tag and its tarball shasum matches the pre-publish dry-run.

## Release artifacts

- GitHub release `v0.6.29`: https://github.com/bbingz/polycli/releases/tag/v0.6.29 (`publishedAt` `2026-07-15T02:12:20Z`; tag commit `8f9603480c036b910bc9942195a897037006a6f8`).
- npm `@bbingz/polycli@0.6.29` (`latest`, registry time `2026-07-15T02:09:46.979Z`, shasum `c63a5135d77417da46e0b16ef9592d4e74ca5e5b`).
- npm `@bbingz/polycli-utils@1.0.3` (`latest`, registry time `2026-07-15T02:10:38.964Z`, shasum `94791ca68cb00f1740f5af540da0f8e29541cb5c`).
- npm `@bbingz/polycli-timing@1.0.2` (`latest`, registry time `2026-07-15T02:10:59.440Z`, shasum `bd305c872ecd50e0abef6b6bd4abefcc1240e15a`).
- npm `@bbingz/polycli-opencode@0.6.29` (`latest`, registry time `2026-07-15T02:11:18.658Z`, shasum `cdf927ecc557602800e18b5feb5f0d3d2e88c0bb`).
