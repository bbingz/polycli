# Release Notes - v0.5.1

Release date: 2026-04-24.

Scope: roadmap closure and release guardrails after v0.5.0. No provider runtime behavior change, no timing schema change, and no new public utils/timing package version.

## Highlights

- Q2 is closed with a documented model fallback policy and a host integration guardrail.
- Q3 is closed by accepting host-surface asymmetry as intentional, while adding a validation script that prevents the command map from drifting.
- `release:check` now includes host command-map validation.

## Changes Since v0.5.0

- Added `docs/model-fallback-policy.md`.
- Added an integration test proving that `ask --json` can use the cached setup model as the final `defaultModel` fallback when a provider stream omits model metadata.
- Added `scripts/validate-host-command-map.mjs` and wired it as `npm run validate:host-map`.
- Updated `docs/host-command-map.md` to reference the new validation guardrail.
- Updated `plugins/polycli-opencode/index.mjs` so the OpenCode tool description includes `adversarial-review`, matching the full companion surface.
- Refreshed `docs/roadmap.md`: R1-R7 and Q1-Q3 are closed; no active roadmap item remains scheduled.

## Publish Notes

- Publish `@bbingz/polycli-opencode@0.5.1`.
- Do not publish `@bbingz/polycli-utils` or `@bbingz/polycli-timing`; they remain at `1.0.0`.
- `@bbingz/polycli-runtime` remains private.

## Verification

- `npm test`: 257/257 pass.
- `npm run validate:host-map`: passes.
- `npm run release:check`: passes.
