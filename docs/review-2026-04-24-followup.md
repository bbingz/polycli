# Follow-up Review — 2026-04-24 (post-Codex pass)

Second-pass Codex handoff after the `4b1aae7 Harden polycli provider health and review flows` commit. Verifies completion of `docs/review-2026-04-24.md` F1–F5 and lists the remaining items needed to ship v0.4.1.

## Status of the original spec

| ID | Status | Notes |
|----|--------|-------|
| F1 qwen subtype-error alignment | ✅ done | `packages/polycli-runtime/src/qwen.js:163` |
| F2 gemini stdin byte threshold | ✅ done | `packages/polycli-runtime/src/gemini.js:24` |
| F3 uncommitted sources committed | ✅ done | `health.md`, `prompt-runtime.mjs`, `prompt-runtime.test.mjs`, `preview.mjs` now tracked |
| F4 version bump to 0.4.1 | ⚠️ partial | Replaced with a manifest-alignment validator (`scripts/validate-release-manifests.mjs`) wired into `release:check`. Better design than the original spec, but the actual `0.4.0 → 0.4.1` numeric bump has not been applied |
| F5 `polycli-runtime` private | ✅ done (runtime) / ⚠️ ambiguous (utils, timing) | `packages/polycli-runtime/package.json` has `"private": true`. `polycli-utils` and `polycli-timing` do not. npm registry returns 404 for all three names; user decision needed |
| P1 per-host marketplace (bonus) | ✅ done | `.agents/plugins/marketplace.json` + `.github/plugin/marketplace.json` added; `pack:codex` script added |

`npm test`: **211/211 pass, 64.1s**. `npm run release:check`: not run yet pending decisions below.

## Remaining fixes for v0.4.1

### FU1 — Bump every host version `0.4.0 → 0.4.1`

Codex intentionally left the numeric bump out and added `validate-release-manifests.mjs` so that the four hosts must stay in lock-step. The validator is in place; the numbers still need a one-shot update.

**Files to edit (set `"version": "0.4.1"`):**

- `plugins/polycli/.claude-plugin/plugin.json`
- `plugins/polycli-codex/.codex-plugin/plugin.json`
- `plugins/polycli-copilot/plugin.json`
- `plugins/polycli-opencode/package.json`
- `.claude-plugin/marketplace.json` — update `metadata.version` and both `plugins[].version` entries
- `.github/plugin/marketplace.json` — update `metadata.version` and the `plugins[].version` entry

**Optional (see FU3 for reasoning):** `.agents/plugins/marketplace.json` does not currently carry a `version` field on the plugin entry. Leave as-is unless FU3 decides otherwise.

**Test plan:** `npm run release:check` must pass end-to-end, including `npm publish ./plugins/polycli-opencode --dry-run --access public`.

**Scope guard:** do not touch `packages/polycli-*/package.json` versions. They remain on the internal `1.0.0` line; the external release line is the host plugins only.

---

### FU2 — Decide and record `polycli-utils` / `polycli-timing` publication intent

Current state: `@bbingz/polycli-runtime` is marked private; `@bbingz/polycli-utils` and `@bbingz/polycli-timing` are not. All three names return 404 on the npm registry. The ambiguity is whether utils/timing are reserved for future publication or are also internal-only.

**Pick one option and apply it:**

- **Option A (internal-only, recommended given no publish has ever happened):** add `"private": true` to `packages/polycli-utils/package.json` and `packages/polycli-timing/package.json`. Match the runtime policy. Reversible — removing the flag when an intentional publish is scheduled takes one line.
- **Option B (reserve for publication):** leave both as-is. Add a short note to `docs/polycli-v1-public-surface.md` (which already lists their exports) stating "not yet published; reserved for the `v1` package release line" so the intent is explicit.

**Test plan (either option):** `npm test` remains green. For Option A, verify `npm publish ./packages/polycli-utils --dry-run` now refuses with "cannot publish private package".

**Scope guard:** do not touch exports maps, do not rename packages, do not edit the `dependencies` fields in `polycli-runtime/package.json`.

---

### FU3 — Remove the duplicate `polycli-copilot` entry from the Claude marketplace

`.claude-plugin/marketplace.json` still lists both `polycli` and `polycli-copilot`. Now that Copilot has its own `.github/plugin/marketplace.json`, listing it under the Claude marketplace is redundant and invites version-skew bugs.

**File:** `.claude-plugin/marketplace.json`

**Proposed change:** remove the `polycli-copilot` object from the `plugins` array. Keep only `polycli`.

**Follow-up to the validator:** `scripts/validate-release-manifests.mjs` currently does `assertPluginEntry(claudeMarketplace, { name: claudeManifest.name, ... })` — that single assertion remains valid. Do not add an extra assertion for `polycli-copilot` on the Claude marketplace; the Copilot entry lives on the Copilot marketplace now.

**Test plan:** `npm run validate:manifests` must still pass. `claude plugin validate .claude-plugin/marketplace.json` must still pass.

**Scope guard:** do not touch the Copilot or Codex marketplace files.

---

## Delivery order

1. FU2 — decide utils/timing policy first (single-line change per package if Option A).
2. FU3 — trim the Claude marketplace.
3. FU1 — version bump last, so `release:check` runs once over a clean manifest state.
4. `npm run release:check`. On green, commit as a single "release: v0.4.1" commit.
5. Tag and push: `git tag v0.4.1 && git push origin main v0.4.1`.
6. Publish: `npm publish ./plugins/polycli-opencode --access public`. **Note:** `@bbingz/polycli-opencode` is 404 on the npm registry today, so this will be the *first real* publish of that package, not a `0.4.0 → 0.4.1` update. Confirm expected owner / access before running.
7. `gh release create v0.4.1` with the v0.4.1 CHANGELOG block as the body.

## Out-of-scope for this follow-up

- No changes to provider runtimes. F1 and F2 are the only runtime edits needed for v0.4.1.
- No changes to the new `preview.mjs` / `prompt-runtime.mjs` libraries. They are already tested and bundled.
- No `docs/polycli-v1-public-surface.md` rewrite. That is P2 from the previous review and remains deferred unless FU2 lands on Option B (in which case a one-paragraph note is acceptable).
