# AGENTS.md

Also read the repo root [AGENTS.md](/home/user/-Code-/polycli/AGENTS.md) for shared monorepo constraints and root verification commands.

## Package Purpose

`@bbingz/polycli-utils` only holds low-semantic-risk helpers that remain reusable across providers.

Good fits:

- argument parsing
- process execution and process-tree termination
- UTF-8-safe line decoding
- atomic writes and lock files
- NDJSON append/read/tail helpers
- session id extraction from outputs
- noisy JSON line parsing

Bad fits:

- provider-specific canonical event schemas
- shared agent/session runtimes
- retry policies tied to one provider
- abstractions that require knowing model/provider semantics

## Change Rules

- Keep functions small, sync where already sync, and side effects explicit.
- Preserve current export surface unless the change intentionally updates the package contract.
- If you add or remove a module, update:
  - `package.json`
  - `src/index.js`
  - relevant tests

## Verification

- Run: `node --test packages/polycli-utils/test/*.test.js`
- If export surface changed, ensure `packages/polycli-utils/test/exports.test.js` still covers it.
