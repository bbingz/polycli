# polycli v0.6.2

Open-source hygiene and packaging patch on top of `v0.6.1`.

## What changed

- Fixed the public `@bbingz/polycli-timing/schema` subpath by including `timing.schema.json` in the npm tarball.
- Included MIT `LICENSE` text in the public npm packages: `@bbingz/polycli-utils`, `@bbingz/polycli-timing`, and `@bbingz/polycli-opencode`.
- Removed the OpenCode adapter dependency on `@opencode-ai/plugin`, replacing it with a tiny local `tool()` wrapper plus `zod`; this clears the transitive `effect -> uuid` audit finding.
- Scrubbed public fixtures and package-level AGENTS files of maintainer-local paths, host auth metadata, local memory metadata, and provider reasoning signatures.
- Tightened README privacy wording: polycli reuses local provider auth/config and does not collect, upload, or host API keys.
- Added open-source packaging and hygiene tests so future releases verify tarball export targets, license inclusion, and fixture sanitization.
- Hardened the multi-provider health concurrency test to assert overlapping fake-provider probe events instead of relying on wall-clock thresholds.

## Verified

- `npm run release:check`
- `npm audit --audit-level=moderate`

## Publishing

This patch updates host manifests to `0.6.2`, `@bbingz/polycli-opencode` to `0.6.2`, and the public utility packages to `1.0.1`.
