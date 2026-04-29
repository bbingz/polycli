# Session Memory — 2026-04-29

Public-safe handoff snapshot after the v0.6.2 open-source release cleanup.

## Current Public State

- GitHub repository: `https://github.com/bbingz/polycli`
- Default branch: `main`
- Current `main` HEAD after post-release maintenance: `fe4c6d6`
- Latest GitHub release: `v0.6.2`
- Published npm packages:
  - `@bbingz/polycli-opencode@0.6.2`
  - `@bbingz/polycli-utils@1.0.1`
  - `@bbingz/polycli-timing@1.0.1`
- Open pull requests after cleanup: none.

## Completed In This Session

- Finished v0.6.2 public release polish and publication.
- Published the OpenCode host package plus both public utility packages.
- Added and validated GitHub Actions CI.
- Added README header/social preview artwork assets.
- Added contributor/security/open-source hygiene documentation and checks.
- Rewrote public history to remove maintainer-local paths and private fixture metadata before public exposure.
- Merged the remaining Dependabot PRs:
  - `actions/setup-node` 4 -> 6
  - `actions/checkout` 4 -> 6
  - `zod` 4.1.8 -> 4.3.6

## Verification Snapshot

- `npm test`: 287/287 passed.
- `npm run release:check`: passed.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- GitHub Actions CI: latest post-merge `main` push runs passed.
- Worktree after verification: clean.

## Remaining Manual UI Item

GitHub social preview upload is ready but requires the GitHub repository settings UI. The asset is:

```text
docs/assets/social-preview.png
```

The current `gh repo edit` surface has no social preview image option. GitHub's documented path is repository `Settings` -> `Social preview` -> `Edit` -> `Upload an image`.
