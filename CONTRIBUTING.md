# Contributing

Thanks for improving `polycli`. This repository is intentionally small and conservative: provider adapters stay flat, provider differences stay visible, and shared utilities only cover low-semantic-risk behavior.

## Before Opening A PR

Run the relevant focused check first, then the full release check before a release-facing change:

```bash
npm install
npm test
npm run release:check
```

For narrower changes, use the focused commands from `AGENTS.md`, for example:

```bash
node --test packages/polycli-runtime/test/*.test.js
node --test plugins/polycli/scripts/tests/*.test.mjs
node --test scripts/tests/*.test.mjs
```

## Architectural Rules

- Keep provider-specific protocol parsing in `packages/polycli-runtime`.
- Do not move provider semantics into `packages/polycli-utils`.
- Do not introduce a shared provider base class, inheritance tree, or fake unified event schema.
- Preserve timing semantics: `measured`, `zero`, `missing`, and `unsupported` mean different things.
- Update tests whenever behavior, exports, package metadata, release manifests, or public fixtures change.

## Public Hygiene

Before release work, confirm:

- `npm run release:check` passes.
- `npm audit --audit-level=moderate` reports no vulnerabilities.
- Public package tarballs contain only the intended files.
- Fixtures and docs do not contain maintainer-local paths, auth metadata, reasoning signatures, or encrypted provider payloads.

## Release Changes

Release-facing changes should update the relevant files together:

- package/plugin versions
- `CHANGELOG.md`
- `docs/release.md`
- `docs/release-notes-v*.md`
- package `exports` and export tests when public entry points change

