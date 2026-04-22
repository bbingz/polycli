# AGENTS.md

Also read the repo root [AGENTS.md](/home/user/-Code-/polycli/AGENTS.md) for shared monorepo constraints and root verification commands.

## Package Purpose

`@bbingz/polycli-timing` defines a timing contract for cross-provider comparison without pretending every provider exposes the same capabilities.

## Invariants

- Do not collapse `unsupported`, `missing`, `zero`, and `measured` into one state.
- Keep `runtimePersistence` and `measurementScope` explicit; they are part of the product semantics, not metadata noise.
- Aggregation must stay capability-aware so cross-provider summaries do not mislead.
- Schema, validator behavior, and aggregation output must agree.

## Change Rules

- Treat the JSON schema and runtime validation as one contract.
- When adjusting metric semantics, update tests that prove the distinction between unsupported, missing, and zero.
- Avoid provider-specific assumptions about TTFT, token accounting, or tool timing unless they are modeled as optional capability-aware data.

## Verification

- Run: `node --test packages/polycli-timing/test/*.test.js`
- For contract changes, also run the full repo suite: `npm test`
