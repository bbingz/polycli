# Claude Handoff: Remaining Work After Q6 Phase 5-7

Date: 2026-05-07
Owner handoff from: Codex
Repo: `/Users/bing/-Code-/polycli`
Current `main`: `25872cc632cc20d133af89d1c81c8c9f3d7d376e`
Latest public release: `v0.6.8`

## Current State

Q6 terminal observability is implemented and synchronized to `origin/main`.

Already landed after `v0.6.8`:

- `e9ab6fc` `fix: recover ledger terminal events for dead workers`
  - `debug runs/show/explain` refresh job state before reading the run ledger.
  - Dead background jobs with residual `runContext` get missing terminal `attempt_result` / `provider_decision` events appended idempotently.
  - No-envelope worker exits are classified as `worker_exited`.
- `c608dcd` `feat: show log file pointers in tui`
  - `polycli tui` shows deduplicated `logFile` pointers.
  - It does not read or print log contents.
- `25872cc` `docs: close q6 terminal observability hardening`
  - README variants, roadmap, release docs, Q6 task state, host command map, and CHANGELOG reflect the post-v0.6.8 hardening.
  - `validate:host-map` now checks Terminal CLI command cells, side-by-side examples, and terminal-only `polycli tui` documentation.

Last verified before this handoff:

- Focused tests: `102/102`
- `npm test`: `354/354`
- `npm run release:check`: exit 0
- `git push origin main`: done; `HEAD == origin/main == 25872cc632cc20d133af89d1c81c8c9f3d7d376e`

## Remaining Work

### P0 - Patch obvious README front-matter drift

The root README opening line still lists the old short command vocabulary:

```text
health, ask, review, rescue, timing
```

Update it to include the current surface without making the intro too noisy. Minimum acceptable wording:

```text
health, ask, review, rescue, timing, debug, background-job controls, and terminal inspection
```

Also check `README.zh-CN.md` and `README.ja.md` for the same front-matter drift. Keep this docs-only.

Validation:

```bash
rg -n "health`, `ask`, `review`, `rescue`, `timing`|health / ask / review / rescue / timing" README.md README.zh-CN.md README.ja.md
git diff --check
npm run validate:host-map
```

Stop if this reveals broader README rewrites; keep the slice to stale wording only.

### P1 - Prepare a small patch release for post-v0.6.8 hardening

The hardening commits are on `main` but not in a public release. Prepare `v0.6.9` unless the user explicitly chooses a different version.

Expected version bumps:

- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`
- `plugins/polycli/.claude-plugin/plugin.json`
- `plugins/polycli-codex/.codex-plugin/plugin.json`
- `plugins/polycli-copilot/plugin.json`
- `plugins/polycli-opencode/package.json`
- `packages/polycli-terminal/package.json`

Do not bump:

- `packages/polycli-utils` unless source changes land there.
- `packages/polycli-timing` unless source changes land there.
- `packages/polycli-runtime` public version, because it remains internal/private.

Release notes should cover:

- dead-worker scan-on-read terminal event recovery
- TUI log file pointers
- host-map guardrail for Terminal CLI docs
- README command-surface drift cleanup if P0 lands

Recommended new file:

```text
docs/release-notes-v0.6.9.md
```

Validation before asking for publish authorization:

```bash
npm run build:plugins
npm run validate:manifests
npm run validate:host-map
npm run validate:bundles
npm run release:check
git diff --check
git status --short --branch
```

Stop after release prep commit. Do not tag, push tag, publish npm packages, or create a GitHub release without explicit user authorization.

### P2 - Publish `v0.6.9` after user approval

Only after the user approves the prepared release:

```bash
git push origin main
git tag v0.6.9
git push origin v0.6.9
gh release create v0.6.9 --title "v0.6.9" --notes-file docs/release-notes-v0.6.9.md
npm publish ./plugins/polycli-opencode --access public
npm publish ./packages/polycli-terminal --access public
```

Post-publish verification:

```bash
git ls-remote --tags origin v0.6.9
gh release view v0.6.9 --json isDraft,isPrerelease,publishedAt,url
npm view @bbingz/polycli-opencode@0.6.9 version
npm view @bbingz/polycli@0.6.9 version
npm view @bbingz/polycli@0.6.9 bin
git status --short --branch
```

Then add a docs closeout commit on `main`:

- `docs/release.md`: latest public release becomes `v0.6.9`.
- `docs/roadmap.md`: snapshot/current state mention `v0.6.9`.
- `CHANGELOG.md`: short top entry for `v0.6.9 released`.

Push the docs closeout after validation. Do not move the `v0.6.9` tag after publish.

### P3 - Optional later product work, not a release blocker

These are not needed for `v0.6.9`:

- Full log viewer (`debug logs` or a TUI log pane that opens/streams log contents). This needs a separate redaction and retention spec.
- Live `pi` health repro automation. Current fixture/docs coverage is sufficient; live provider availability is environment-gated.
- Centralized telemetry, daemon, monitor, or server mode. These remain explicit non-goals unless the user reverses the product direction.

## Claude Working Rules For This Handoff

- Keep slices small and commit separately:
  1. P0 README drift cleanup
  2. P1 release prep
  3. P2 publish only after user authorization
  4. post-release docs closeout
- Use tests first where behavior changes. For P0/P1 docs and manifests, focused validators are enough.
- Do not edit provider runtime architecture. Preserve Path B: flat provider adapters, no shared base provider class, runtime remains internal.
- Do not introduce daemon/server behavior.
- Do not publish or tag without explicit user authorization.
- If `release:check` fails, stop and report the first failing gate before pushing or publishing.

