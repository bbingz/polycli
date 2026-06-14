# polycli v0.6.20

Patch on top of `v0.6.19` that ships **grok as the 11th provider**, migrates the kimi adapter/guidance to **kimi-code v0.6.0**, and closes the deep-review hardening slice. The Path B stance remains intact: provider modules stay flat and provider-specific parsing stays in runtime.

## What changed

### grok provider

- Added `grok` for the xAI Grok Build CLI across runtime, registry, host adapter guidance, bundled plugins, release validation, and docs.
- The adapter reads structured text/session metadata from Grok output without scanning answer prose for fabricated session IDs.

### kimi-code v0.6.0 migration

- Updated kimi resume semantics from the legacy `-r` path to kimi-code's `--session` / `-C` contract.
- Tightened kimi session parsing around the documented `session.resume_hint` event.
- Refreshed provider guidance and provider-path docs so host agents do not use stale kimi-cli flags.

### Deep-review hardening and release hygiene

- Integrated the deep-review hardening set and regenerated companion bundles from source after merge.
- Kept release gates aligned with the 11-provider runtime surface, including host-map, Codex adapter, bundle, manifest, and review-drift checks.

## Verification

- `npm test` (483/483)
- `npm run validate:host-map`
- `npm run validate:codex-adapter`
- `npm run check:review-drift`
- `npm run release:check`

## Release artifacts

- GitHub release `v0.6.20`
- npm `@bbingz/polycli-opencode@0.6.20`
- npm `@bbingz/polycli@0.6.20`

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
