# AGENTS.md

## Project Overview

`polycli` is a small Node.js monorepo for Path B only:

- shared low-semantic-risk utilities
- an independent timing contract for cross-provider comparison

It is not a shared runtime, inheritance framework, or provider unification layer.

## Setup And Verification

- Use Node.js `>=20`.
- Install deps from the repo root: `npm install`
- Run the full test suite from the repo root: `npm test`
- When touching one package, prefer the focused test command first:
  - `node --test packages/polycli-utils/test/*.test.js`
  - `node --test packages/polycli-timing/test/*.test.js`

## Repository Map

- `packages/polycli-utils`
  - Cross-provider helpers only: args, process, stream, NDJSON, atomic save, session-id, stream JSON parsing.
  - Do not move provider-specific protocol parsing or canonical event mapping here.

- `packages/polycli-timing`
  - Timing schema, validation, percentiles, and aggregation.
  - Keep capability-awareness explicit: `measured`, `zero`, `missing`, and `unsupported` are semantically different.

- `docs/`
  - `docs/polycli-proposal.md` is the main architecture/product context if present.
  - `docs/session-memory-2026-04-22.md` is handoff context from the earlier Codex session if present.

## Editing Rules

- Stay inside this repository. Legacy sibling repos are reference material only, not migration targets.
- Follow the existing plain ESM JavaScript style unless the repo is explicitly migrated.
- Keep modules small and specific. Shared code should remove duplication without hiding provider differences behind fake-unified abstractions.
- Do not introduce a shared session/runtime base class or provider framework into this repo unless the user explicitly asks for that direction.
- When changing exports, update both the package `package.json` exports map and the related export tests.
- When changing timing behavior, keep schema, runtime validation, aggregation behavior, and tests aligned in the same change.

## Delivery Expectations

- Prefer reversible, local changes over speculative abstractions.
- Add or update tests for any behavior change.
- Before finishing, run the most relevant verification commands and report the exact result.
