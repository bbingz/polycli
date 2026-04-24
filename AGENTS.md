# AGENTS.md

## Project Overview

`polycli` is a Node.js monorepo for Path B only:

- shared low-semantic-risk utilities
- an independent timing contract for cross-provider comparison
- flat provider runtime adapters for the unified plugin surface
- host plugins for Claude Code, Codex, GitHub Copilot CLI, and OpenCode

It is not a shared runtime base class, inheritance framework, or provider protocol unification layer. The runtime package exists to bundle provider-specific adapters; provider modules stay flat and explicit.

## Setup And Verification

- Use Node.js `>=20`.
- Install deps from the repo root: `npm install`
- Run the full test suite from the repo root: `npm test`
- When touching one package, prefer the focused test command first:
  - `node --test packages/polycli-utils/test/*.test.js`
  - `node --test packages/polycli-timing/test/*.test.js`
  - `node --test packages/polycli-runtime/test/*.test.js`
  - `node --test plugins/polycli/scripts/tests/*.test.mjs`
  - `node --test scripts/tests/*.test.mjs`

## Repository Map

- `packages/polycli-utils`
  - Cross-provider helpers only: args, process, stream, NDJSON, atomic save, session-id, stream JSON parsing.
  - Do not move provider-specific protocol parsing or canonical event mapping here.

- `packages/polycli-timing`
  - Timing schema, validation, percentiles, and aggregation.
  - Keep capability-awareness explicit: `measured`, `zero`, `missing`, and `unsupported` are semantically different.

- `packages/polycli-runtime`
  - Flat provider adapters, registry, availability/auth probes, invocation builders, stream/log parsing, and timing attachment.
  - Keep provider-specific protocol parsing here; do not promote it into `polycli-utils`.
  - Runtime remains a bundled internal package, not a public framework.

- `plugins/polycli`
  - Claude Code host plugin, commands, hooks, provider guidance skills, bundled companion, and host-side job/review orchestration.

- `plugins/polycli-codex`, `plugins/polycli-copilot`, `plugins/polycli-opencode`
  - Host-specific distribution wrappers around the same bundled companion surface.

- `scripts/`
  - Release/build validation. Keep release drift checks small, deterministic, and runnable from `npm run release:check`.

- `docs/`
  - `docs/polycli-proposal.md` is the main architecture/product context if present.
  - `docs/roadmap.md` is the live open-work list.
  - `docs/release.md` is the release procedure.
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
