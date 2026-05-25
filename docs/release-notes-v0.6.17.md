# polycli v0.6.17

Patch on top of `v0.6.16` that fixes Codex host manifest noise from the Polycli Codex adapter.

## What changed

- Reduced `plugins/polycli-codex/.codex-plugin/plugin.json` `interface.defaultPrompt` from 4 examples to Codex's supported maximum of 3 examples.
- Kept first-run guidance coverage by combining the `review` and `timing` examples into one prompt entry.
- Hardened `scripts/validate-codex-adapter.mjs` so future Codex adapter changes reject more than 3 default prompts and reject prompt entries longer than 128 characters.
- Added focused regression coverage for both Codex manifest limits.

No runtime provider behavior, timing schema, session persistence, or host command grammar changed.

## Verification

- `node --test scripts/tests/validate-codex-adapter.test.mjs`
- `node scripts/validate-codex-adapter.mjs`
- `node --test scripts/tests/*.test.mjs`
- `npm run release:check`

## Release artifacts

- GitHub release `v0.6.17`
- npm `@bbingz/polycli-opencode@0.6.17`
- npm `@bbingz/polycli@0.6.17`

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`). No schema or utility changes in this slice.
