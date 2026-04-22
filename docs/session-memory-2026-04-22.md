# Session Memory - 2026-04-22

This file is the handoff context for the next Codex session in `/home/user/-Code-/polycli`.

## Goal

Build `polycli` as an independent project under `-Code-/polycli`.

Important boundary:

- `gemini-plugin-cc`
- `qwen-plugin-cc`
- `kimi-plugin-cc`
- `minimax-plugin-cc`

are **not** migration targets. They are legacy/reference repos only. New work should land in `polycli`, not in those repos.

## Proposal

The proposal document has been moved here:

- [docs/polycli-proposal.md](/home/user/-Code-/polycli/docs/polycli-proposal.md)

That document is the primary product/context doc and should be read first in the next session.

## Current `polycli` State

Repo:

- path: `/home/user/-Code-/polycli`
- git: initialized, clean working tree at the time this file was written

Recent commits:

1. `7e8854e` `feat: bootstrap polycli utils and timing packages`
2. `7a6c997` `feat: support preserve-null process status`

Current package layout:

- `packages/polycli-utils`
- `packages/polycli-timing`

Current test command:

```bash
npm test
```

This was passing before handoff.

## What Exists In `polycli`

### `polycli-utils`

Shared utility layer currently includes:

- arg parsing
- sync process execution
- stream helpers
- atomic save / lockfile helpers
- NDJSON helpers
- session-id helpers
- stream JSON parsing

Important note:

- `runCommand(..., { preserveNullStatus: true })` exists because one legacy provider (`kimi`) depended on `spawnSync` preserving `status = null` for signaled exits. This option now lives in `polycli` itself as a compatibility affordance, but no old repo should be wired to it anymore.

### `polycli-timing`

Timing contract work already started and includes:

- timing record validation
- aggregation
- percentile calculation
- capability-aware status handling

This aligns with the proposal's Path B direction:

- utility layer shared
- timing schema independent
- capability states must distinguish:
  - unsupported / no capability
  - missing data
  - genuine zero contribution

## Critical Product Direction

The intended direction is **Path B**, not framework coupling:

- shared utilities are fine
- timing schema should stay explicit and capability-aware
- do not force provider-specific semantics into one fake-unified runtime

The extra user motive that materially affects design:

- timing data is not only for self-observability
- it is intended for **cross-AI capability comparison**

That makes capability flags and "missing vs unsupported vs zero" separation non-negotiable.

## Mistake Made In This Session

There was a wrong turn:

- old plugin repos were temporarily edited to import `polycli` source directly

That was incorrect because it created cross-repo source coupling instead of building `polycli` as a standalone project.

This has already been cleaned up.

## Legacy Repo Cleanup Status

At handoff time:

- `qwen-plugin-cc` was reset back to `origin/main`
- `kimi-plugin-cc` was reset back to `origin/main`
- `minimax-plugin-cc` was reset back to `origin/main`
- `gemini-plugin-cc` had the temporary migration reverted with commit:
  - `3e0cdb7` `Revert "refactor: connect gemini timing and utils to polycli"`

Also verified:

- no remaining source references from old plugin `plugins/` directories into `polycli`

This means the old repos should now be treated as read-only references.

## Recommended Next Start For The New Session

Open these first:

1. [docs/polycli-proposal.md](/home/user/-Code-/polycli/docs/polycli-proposal.md)
2. [docs/session-memory-2026-04-22.md](/home/user/-Code-/polycli/docs/session-memory-2026-04-22.md)

Then continue only inside `/home/user/-Code-/polycli`.

## Suggested Immediate Focus

The next implementation pass should likely answer:

1. What is `polycli` v1.0's executable/package surface?
2. How are provider adapters represented inside `polycli` without touching legacy repos?
3. How is timing data written, validated, and compared under the Path B model?
4. What fixtures/tests are needed to prove capability-state correctness for cross-provider comparison?

## Do Not Repeat

- Do not modify old plugin repos to "integrate" `polycli`
- Do not rely on sibling relative imports into legacy repos
- Do not use legacy repo cleanliness as a success metric for `polycli`

The success metric is whether `polycli` itself stands as a self-contained project with its own docs, packages, tests, and future provider model.
