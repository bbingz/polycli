# Maintenance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce post-v0.6.0 maintenance drift by adding release-time validators and aligning docs with the current product surface.

**Architecture:** Keep validation as small Node ESM scripts under `scripts/`, following the existing release validator pattern. Add focused `node --test` coverage for script behavior before implementation, then wire successful validators into `release:check`.

**Tech Stack:** Node.js `>=20`, ESM JavaScript, `node:test`, existing npm scripts.

---

### Task 1: Bundle Drift Validator

**Files:**
- Create: `scripts/validate-plugin-bundles.mjs`
- Create: `scripts/tests/validate-plugin-bundles.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Add tests that create temporary bundle files and call the validator with explicit paths. Cover matching bundles and a mismatched bundle.

- [ ] **Step 2: Run focused test to verify it fails**

Run: `rtk node --test scripts/tests/validate-plugin-bundles.test.mjs`
Expected: fail because `scripts/validate-plugin-bundles.mjs` does not exist.

- [ ] **Step 3: Implement minimal validator**

Export `validatePluginBundles({ root, targets })`, compare file bytes for all targets, and make the CLI check the four real bundle paths.

- [ ] **Step 4: Run focused test to verify it passes**

Run: `rtk node --test scripts/tests/validate-plugin-bundles.test.mjs`
Expected: pass.

- [ ] **Step 5: Wire npm scripts**

Add `validate:bundles` and include it in `release:check` after `build:plugins`.

### Task 2: Fixture Metadata Validator

**Files:**
- Create: `scripts/validate-fixture-metadata.mjs`
- Create: `scripts/tests/validate-fixture-metadata.test.mjs`
- Modify: `package.json`
- Modify: `docs/capture-fixtures.md`

- [ ] **Step 1: Write failing tests**

Add tests that validate required fixture metadata fields and reject missing provider/prompt/expectedText/sessionId shape.

- [ ] **Step 2: Run focused test to verify it fails**

Run: `rtk node --test scripts/tests/validate-fixture-metadata.test.mjs`
Expected: fail because `scripts/validate-fixture-metadata.mjs` does not exist.

- [ ] **Step 3: Implement minimal validator**

Export `validateFixtureMetadata({ root, fixtureRoot })`, discover `*.meta.json`, require `provider`, `prompt`, and `expectedText`, and require `sessionId` to be either absent or a string.

- [ ] **Step 4: Run focused test to verify it passes**

Run: `rtk node --test scripts/tests/validate-fixture-metadata.test.mjs`
Expected: pass.

- [ ] **Step 5: Wire npm scripts and docs**

Add `validate:fixtures` to `package.json` and `release:check`; update `docs/capture-fixtures.md` with the metadata contract.

### Task 3: Documentation State Convergence

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/release.md`

- [ ] **Step 1: Update project overview**

Reflect that runtime and four host adapters are now current scope, while preserving the no shared provider framework constraint.

- [ ] **Step 2: Update roadmap**

Close R8a-R8f as shipped in v0.6.0, leave only post-release cleanup for legacy repo archival and constraint relaxation.

- [ ] **Step 3: Update release checklist**

Add `validate:bundles` and `validate:fixtures` to the release expectations, and add the legacy cleanup note after v0.6.0.

### Task 4: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused script tests**

Run: `rtk node --test scripts/tests/*.test.mjs`
Expected: all script tests pass.

- [ ] **Step 2: Run full project verification**

Run: `rtk npm test`
Expected: all tests pass.

- [ ] **Step 3: Run release validators**

Run: `rtk npm run release:check`
Expected: release check passes or reports only external CLI/tool availability blockers with details.
