# AGENTS.md

Also read the repo root [AGENTS.md](/home/user/-Code-/polycli/AGENTS.md) for shared monorepo constraints and root verification commands.

## Package Purpose

`@bbingz/polycli-runtime` is the v2 provider runtime integration layer.

It is responsible for:

- provider registry
- availability and auth probes
- provider-specific argument builders
- foreground prompt execution
- streaming prompt execution
- stream/log parsing needed to normalize each provider's raw runtime output

It is not responsible for:

- persistent background job state
- result/status/cancel orchestration stores
- plugin command markdown or prompt templates
- forcing one fake-unified provider protocol

## Change Rules

- Keep provider-specific behavior in provider modules, not in the registry.
- Shared helpers are only for mechanics like spawning, decoding, and minimal normalization.
- Do not erase real provider differences such as session resume, approval modes, or output structure.
- When changing one provider's parser or arg builder, add or update focused tests for that provider.

## Verification

- Run: `node --test packages/polycli-runtime/test/*.test.js`
- For cross-package impact, also run: `npm test`
