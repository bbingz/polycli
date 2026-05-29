# Design — provider-drift maintenance hardening + upstream session-pollution control

Spec for roadmap items **Q8a/Q8b/Q8c** and **Q9a/Q9b** (2026-05-29 increment). Source: strategy recon `wmyci560m` / memory `project_competitive_landscape_and_moat`. Deferred (NOT in this increment, roadmap only): Q8d (SDK migration), Q9c (env session isolation — auth/resume risk).

## Review log
- **rev1 → rev2 (2026-05-29, after Codex review `019e73b4-fc25-7f61-9825-7c7152d16977`, verdict CHANGES_REQUESTED).** Incorporated all 4 BLOCKERs + 4 SHOULDs:
  - **B1/B2/B3 (T-PURGE):** deletion no longer derives paths from a sessionId at purge time. Q9a now records the **verified exact realpath** of the session artifact at run time (existence-checked right after the run); Q9b deletes ONLY ledger-recorded exact realpaths, re-validated (lstat reject-symlink, realpath-still-under-store-root, exact basename match). Anything whose workspace ownership cannot be verified is SKIPPED. §5 rewritten.
  - **B4 (T-VOCAB):** the shared data is split into `helpFlags` (what `--help` must show — drift), `runtimeOptionKeys`+values (option fields like `approvalMode`), and `extraArgTokens` (actual `extraArgs`). The consistency test no longer conflates drift `helpFlags` with review `extraArgs`. §4 corrected.
  - **S5:** `job-control.mjs` explicitly in T-LEDGER ownership.
  - **S6:** T-PURGE owns the host-surface validator + docs + skill command lists.
  - **S7:** the T-DRIFTGATE auth check is reframed honestly as a *local regex-anchor sanity check* (it does NOT detect upstream wording drift); a real upstream auth-wording probe stays an open Q8c-followup.
  - **S8:** T-FRESH version-token tests parameterized over all observed fixture string shapes. N9 (provider-owned vs single-module data home) accepted as single-module for this increment, noted.

## 0. Path-B invariants this spec MUST NOT violate

These are hard constraints from `docs/roadmap.md` non-goals + `AGENTS.md`. Any task that needs to cross one is wrong and must be re-scoped:

1. **No `BaseProvider` / inheritance / template-method.** The flat `RUNTIMES` dispatch table stays flat. Q8b shares *data*, never behavior.
2. **No unified event schema.** Do not normalize per-provider event semantics.
3. **No `cold`/`retry` timing; no collapsing the four timing states** (`measured`/`zero`/`missing`/`unsupported`).
4. **No daemon / long-lived process.** Q8a freshness check and Q9b purge are short-lived, on-demand, read-only-until-`--confirm`.
5. **No provider-specific parsing into `polycli-utils`.** Provider knowledge stays in `polycli-runtime` / host scripts.
6. **No fabrication.** Q9a records only the `sessionId` the adapter actually captured; null stays null.
7. **Honest defaults, opt-out not silent safety.** Q9b never auto-deletes; deletion requires explicit `--confirm`. Q8a/Q8c warn/skip, never fake a pass.

## 1. Task DAG (file ownership → parallelization)

Five tasks. Overlap points: adapters (T-VOCAB only — see note), `companion.mjs` (T-LEDGER writes events + T-PURGE adds handler), `check-review-cli-drift.mjs` (T-VOCAB consumes shared data + T-DRIFTGATE extends auth probe).

```
Wave 1 (parallel, disjoint files):
  T-LEDGER   (Q9a)  run-ledger.mjs, companion.mjs event-write sites, tests
  T-FRESH    (Q8a)  scripts/check-fixture-freshness.mjs (NEW), package.json, scripts/tests
  T-VOCAB    (Q8b)  packages/polycli-runtime/src/review-flags.js (NEW),
                    check-review-cli-drift.mjs (consume shared data),
                    plugins/polycli/scripts/lib/review.mjs + prompt-runtime.mjs (re-export only),
                    consistency test (NEW)
Wave 2 (parallel, disjoint; both depend on Wave 1):
  T-PURGE    (Q9a-path+Q9b)
                    plugins/polycli/scripts/lib/sessions.mjs (NEW: derive+record+plan+execute),
                    run-ledger.mjs (add sessionArtifactPath field),
                    companion.mjs (record artifact path at run site + new `sessions` subcommand),
                    plugins/polycli/commands/sessions.md (NEW),
                    scripts/validate-host-command-map.mjs + docs/host-command-map.md + Codex/Copilot skill cmd lists + OpenCode surface index (register `sessions`), tests
                    [depends on T-LEDGER: needs the sessionId field + the same companion run-site / run-ledger.mjs it extends → MUST run after Wave 1]
  T-DRIFTGATE(Q8c)  scripts/check-release.mjs (wire check:review-drift),
                    scripts/check-review-cli-drift.mjs (auth-wording probe)
                    [depends on T-VOCAB: shares the drift-script edit region]
```

**Conflict-avoidance rule for implementers:** a task edits ONLY its listed files. Do NOT run `npm test`, `npm run build:plugins`, or anything that regenerates `polycli-companion.bundle.mjs` — run only your task's focused `node --test`. The integrator (Claude) runs `build:plugins` + full `npm test` + `release:check` after all tasks land.

> Bundle note: `polycli-companion.bundle.mjs` is GENERATED from `polycli-companion.mjs` + `lib/*.mjs`. Never hand-edit the bundle. The integration build regenerates it.

---

## 2. T-LEDGER (Q9a) — record upstream sessionId in the run ledger

**Goal:** persist the upstream `sessionId` on run-ledger events so a run is auditable/purgeable. Zero runtime-behavior change.

**Current facts:** `createRunLedgerEvent` (`run-ledger.mjs:154-191`) has fields for provider/model/jobId but **no `sessionId`**. `result.sessionId` is available at `companion.mjs:1338`; events are written at the `attempt_result` (1356, 1386, 1449, 1473) and `provider_decision` (1366, 1414, 1459, 1485) sites, and in `lib/job-control.mjs:97,120`.

**Design:**
- Add `sessionId: event.sessionId ?? null` to the object returned by `createRunLedgerEvent` (between `model` and `defaultModel`, keep field order stable for readers).
- At each `attempt_result`/`provider_decision` write site that has the run `result`/`job` in scope, pass `sessionId: result.sessionId ?? null` (companion) / `sessionId: job.sessionId ?? null` (job-control). Only add where a sessionId is actually in scope — do NOT invent one (invariant #6).
- No redaction needed: a sessionId is a non-secret upstream identifier (same class as the existing `job.sessionId` already surfaced at `companion.mjs:551,588,623`).

**TDD (write first, must fail before impl):**
- `run-ledger.test`: `createRunLedgerEvent({sessionId:'abc'})` → `.sessionId === 'abc'`; default → `null`.
- `run-ledger.test`: `appendRunLedgerEvent` round-trips `sessionId` through NDJSON read-back.
- companion integration test (extend existing `integration.test.mjs` style): an attempt that returns `result.sessionId` writes a ledger event carrying it; an attempt with null sessionId writes `sessionId:null` (no fabrication).

**Acceptance:** new field present + round-trips; existing ledger tests still green; no behavior change to provider runs.

---

## 3. T-FRESH (Q8a) — fixture-staleness warning

**Goal:** opt-in check that flags when a captured fixture's pinned CLI `version` no longer matches the locally-installed CLI. WARN-only; skip when CLI absent. No daemon.

**Current facts:** fixtures live at `packages/polycli-runtime/test/fixtures/<provider>/<name>.meta.json` with a `version` field (e.g. gemini `0.38.2`); `validate-fixture-metadata.mjs` only checks well-formedness, never compares to a live CLI. The drift script (`check-review-cli-drift.mjs`) already has a provider→bin map + a `spawnSync(bin, ['--help'], {timeout})` + ENOENT-skip pattern to mirror.

**Design (new `scripts/check-fixture-freshness.mjs`):**
- Walk meta files (reuse the `walkMetaFiles` traversal pattern).
- provider→bin + version-args map (mirror drift script's bin resolution incl. `MMX_CLI_BIN`/`AGY_CLI_BIN` env overrides). Version command per provider: prefer `<bin> --version`; the implementer must confirm each CLI's version flag against memory `reference_cli_provider_versions` and the installed CLI, and record any deviation in the script.
- `spawnSync` with a 10s timeout; on ENOENT/error → `skip` (warning, not failure), exactly like the drift script.
- Parse a semver-ish token from stdout/stderr (`/\d+\.\d+\.\d+/`); compare to `meta.version` (also reduced to its semver token). Mismatch → `STALE` row: `gemini/stream-success pinned 0.38.2, installed 0.43.1 — re-capture`.
- Exit code: **0 always** by default (this is a WARN tool; staleness is expected during normal drift and must not block local work). Add `--strict` that exits non-zero on any STALE row, for opt-in release use. Skips never fail.
- `package.json`: add `"check:fixture-freshness": "node scripts/check-fixture-freshness.mjs"`. Do NOT wire into `release:check` in this task (that is a separate decision; default behavior is a manual/periodic check like `check:provider-paths`).

**TDD (rev2 — parameterize the version parse per Codex S8):** unit-test the pure pieces by exporting them.
- `extractVersionToken` must be a parameterized table covering ALL observed CLI `--version` output shapes (read the actual fixture `meta.json` `version` strings + known CLI output forms before finalizing): bare `0.17.0`; suffix `2.1.147 (Claude Code)`; prefix `gemini version 0.43.1`; trailing period/newline; multi-line stderr; and a NO-token case (returns null → caller treats as skip/warn, not a false match).
- `compareFixtureVersion({pinned, installed})` → `{status:'stale'|'ok'}` (both reduced to their semver token first).
- meta-walk over a temp fixture tree classifies stale vs matching vs absent(skip) using an injected fake `spawnSync`. (Follow `scripts/tests/*.test.mjs` patterns; inject the spawn so tests don't depend on installed CLIs.)

**Acceptance:** `node scripts/check-fixture-freshness.mjs` runs clean on this machine (skips uninstalled CLIs, reports any stale); `--strict` exits non-zero only on a real mismatch; new unit tests green.

---

## 4. T-VOCAB (Q8b) — single source for review/ask flag expectations + consistency test

**Goal:** collapse the duplicated, unsynchronized flag knowledge to ONE data declaration, and add a test that fails when the duplicates desync. This is **data co-location, not `BaseProvider`** (invariant #1).

**Current facts (the duplication):**
- `check-review-cli-drift.mjs` `CHECKS[].expect` hard-codes the review flags per provider (claude `--tools/--mcp-config/--strict-mcp-config`, gemini `--approval-mode/--policy`, qwen `--approval-mode/--exclude-tools/--max-session-turns`, copilot 5 flags, pi 5 flags, cmd `--permission-mode`, agy `forbid` list, minimax probes).
- `lib/review.mjs` `REVIEW_HARD_CONSTRAINTS` returns the actual `extraArgs` flag tokens; `assertNoReviewConstraintOverride` hard-codes the read-only option-key per provider (gemini `approvalMode`, opencode `skipPermissions`, qwen `approvalMode`, claude `permissionMode`, copilot `allowAll*`, kimi/cmd `yolo`).
- Nothing asserts these agree.

**Design — SCOPED to avoid a risky rewrite (rev2: data model split per Codex B4):**
- New `packages/polycli-runtime/src/review-flags.js` exporting a frozen data map `REVIEW_FLAG_EXPECTATIONS` keyed by provider. **Three DISTINCT field groups — do not conflate them** (this is the B4 fix: drift `--help` flags are NOT the same tokens as review `extraArgs`):
  ```js
  {
    claude: {
      helpFlags: ['--tools','--mcp-config','--strict-mcp-config'], // what `--help` must show → drift CHECKS[].expect
      readOnly: { optionKey: 'permissionMode', value: 'plan' },     // option field that encodes read-only → assertNoReviewConstraintOverride
      extraArgTokens: ['--tools','--mcp-config','--strict-mcp-config'], // actual tokens review.mjs puts in extraArgs (may differ from helpFlags!)
    },
    gemini: {
      helpFlags: ['--approval-mode','--policy'],                    // drift expects these in --help
      readOnly: { optionKey: 'approvalMode', value: 'plan' },
      extraArgTokens: ['--extensions','--allowed-mcp-server-names'], // review.mjs's actual extraArgs — INTENTIONALLY different from helpFlags
    },
    // qwen, copilot, pi, cmd, kimi similarly; agy: { forbidFlags:[...], reviewUnsupported:true }; minimax: { probes:[...] }
  }
  ```
  Copy the EXACT tokens already present in `check-review-cli-drift.mjs` (`CHECKS[].expect`→`helpFlags`, `forbid`→`forbidFlags`, `probes`→`probes`) and in `review.mjs` (`REVIEW_HARD_CONSTRAINTS[p]().extraArgs`→`extraArgTokens`; the read-only option key/value→`readOnly`). Do not invent or merge tokens.
- Export from `packages/polycli-runtime/src/index.js`. If `scripts/check-review-cli-drift.mjs` cannot cleanly import the workspace package, pick a shared-data home BOTH the drift script and `review.mjs` can import and record it in `deviationsFromSpec` (requirement is ONE declaration, not a specific file).
- `check-review-cli-drift.mjs`: derive `CHECKS[].expect`/`forbid`/`probes` from `helpFlags`/`forbidFlags`/`probes`. Output byte-identical on a machine with CLIs.
- `lib/review.mjs`: in `assertNoReviewConstraintOverride`, source the per-provider read-only key/value from `REVIEW_FLAG_EXPECTATIONS[p].readOnly` instead of re-hard-coding. Do NOT rewrite the dynamic constraint functions (gemini temp dir etc.). Leave `prompt-runtime.mjs` unless a pure-data duplication can be sourced; note if left.

**TDD (rev2 — assert against the RIGHT field, not extraArgs⊇helpFlags):**
- Consistency test (`packages/polycli-runtime/test/review-flags.test.js` + host-side `plugins/polycli/scripts/tests/review-flags-consistency.test.mjs`): for each provider assert (a) the tokens in `extraArgTokens` exactly equal the tokens `REVIEW_HARD_CONSTRAINTS[p]()` actually emits in `extraArgs` (so the map mirrors review.mjs), and (b) `assertNoReviewConstraintOverride` rejects a value != `readOnly.value` on `readOnly.optionKey`. Do NOT assert `extraArgs ⊇ helpFlags` (false for gemini/others). Prove the test goes RED on an injected `extraArgTokens` desync, then restore.
- Drift-script test: feed fake help-text; assert derived `expect`/`forbid`/`probes` equal the prior inline literals (snapshot equality) → refactor provably behavior-preserving.

**Acceptance:** drift output unchanged on this machine; consistency test green + demonstrably red on a desync; `REVIEW_FLAG_EXPECTATIONS` is the sole declaration of these tokens. (N9: single-module home accepted for this increment; provider-owned-const form noted as a future refinement.)

---

## 5. T-PURGE (Q9a-path + Q9b) — record exact artifact path, then `polycli sessions` list/purge  ⚠ HIGHEST RISK (deletes files)

**rev2 (per Codex B1/B2/B3): deletion is driven ONLY by an exact realpath that was recorded-and-verified at run time. The purge step NEVER derives a path from a sessionId. No path-guessing, no globbing, at purge time.**

### 5a. Record the verified artifact realpath at run time (extends Q9a)

Builds on T-LEDGER's `sessionId` field. Add a `sessionArtifactPath` field to the ledger event and populate it ONLY with a path we verified exists immediately after the run (when cwd+provider+sessionId are all known and the file was just created — so the realpath is trustworthy, not a later guess).

- New `plugins/polycli/scripts/lib/sessions.mjs`:
  - `deriveSessionArtifactCandidate({provider, sessionId, workspaceRoot, homedir})` → at most ONE candidate absolute path (or `null` + `reason`). Per-provider table — the implementer MUST verify each against the live store; if unverifiable, return `null` + reason:
    - claude → `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` (encoding appears to be cwd with `/`→`-`; VERIFY against `~/.claude/projects`, do not assume — if the live encoding differs or the file is absent, return null).
    - pi → resolve the project dir from cwd, then the exact `<sessionId>.jsonl`/`<sessionId>/` under `~/.pi/sessions/` (NO `**` glob — compute the project segment, do not wildcard-scan).
    - kimi → reuse the EXACT derivation in `kimi.js:81-107` (`~/.kimi/sessions/<md5(cwd)>/<sessionId>/`) so we don't reinvent it; it is a per-session DIR.
    - gemini → `null` + reason "per-project dir, no per-session artifact" (never purgeable).
    - codex → `null` + reason "separate polycli-codex plugin".
    - minimax/cmd → `null` (ephemeral, no store).
  - `recordArtifactPath(candidate, {homedir, lstatFn, realpathFn})` → returns the verified realpath ONLY if: the candidate EXISTS, `lstat` shows it is NOT a symlink, and `realpath(candidate)` is still under that provider's store root. Otherwise `null`. (Existence at record time = the run just created it, so a hit is trustworthy.)
- `companion.mjs`: after a successful provider run (where `result.sessionId` + `execution.cwd` + provider are in scope, near line 1338), compute `deriveSessionArtifactCandidate` → `recordArtifactPath` and pass `sessionArtifactPath` (realpath or null) onto the `attempt_result`/`provider_decision` ledger event. NEVER record an unverified path (invariant #6). No change to run behavior.
- `run-ledger.mjs`: add `sessionArtifactPath: event.sessionArtifactPath ?? null` to `createRunLedgerEvent` (after `sessionId`).

### 5b. `polycli sessions` list/purge — consumes ONLY recorded realpaths

**Safety rails (NON-NEGOTIABLE):**
1. **Dry-run by default.** `purge` prints what WOULD be deleted and deletes nothing; deletion requires `--confirm`.
2. **Only recorded realpaths are candidates.** The join key is the ledger's `sessionArtifactPath` (already verified at record time) — NOT a sessionId, NOT a derived path. Events with `sessionArtifactPath:null` are never deletable (gemini, ephemeral, unverified-at-record all fall here and are reported as skipped-with-reason).
3. **Re-validate every candidate at purge time before deleting:** (a) `lstat` → reject symlinks, (b) `realpath` → still under that provider's store root (recompute the store root from `os.homedir()`; reject if the realpath escaped it), (c) still exists, (d) for file-type artifacts the basename still exactly matches the recorded sessionId; for the kimi dir-type the dir basename exactly equals the sessionId. Any failure → SKIP + print reason.
4. **Per-workspace scope.** The ledger is per-workspace; only the current workspace's recorded paths are considered.
5. **No globbing, ever.**

- `plugins/polycli/scripts/lib/sessions.mjs` (same module):
  - `collectRecordedArtifacts(events)` → distinct `{provider, sessionId, sessionArtifactPath, workspaceRoot}` where `sessionArtifactPath != null`.
  - `planPurge({recorded, homedir, lstatFn, realpathFn, existsFn})` → `{deletable:[{provider,sessionId,path,bytes}], skipped:[{path|provider,reason}]}`, PURE, applying rail 3. Injectable fs for tests.
  - `executePurge(plan, {confirm, rmFn})` → deletes `plan.deletable` only if `confirm`; else returns the dry-run summary. Returns counts.
- `companion.mjs`: register a `sessions` subcommand → `list` (default; prints recorded artifacts + exists/size) and `purge [--confirm]` (prints plan; deletes only with confirm). Mirror the `debug runs`/`timing` command-dispatch + output style.
- `plugins/polycli/commands/sessions.md` (NEW): Claude Code command doc — dry-run default, `--confirm` semantics, "removes only polycli-recorded upstream sessions in this workspace".

**Ownership additions (Codex S6) — the new command touches the host surface:**
- `scripts/validate-host-command-map.mjs` + `docs/host-command-map.md` (register `sessions`; the validator WILL fail until all surfaces list it).
- the Codex skill + Copilot skill command lists and the OpenCode surface command index that the host-map validator cross-checks (implementer enumerates them from `validate-host-command-map.mjs` EXPECTED_COMMANDS and updates each).

**TDD (purity → safe to test without touching real files):**
- `deriveSessionArtifactCandidate` returns the expected single candidate for claude/pi/kimi given fixed homedir+cwd+id; returns `null`+reason for gemini/codex/minimax (NO glob in output).
- `recordArtifactPath`: returns realpath for a real file under the store root; returns `null` for a symlink (lstat), for a realpath escaping the store root, and for a missing file.
- `planPurge` with injected fs: includes only recorded paths passing all of rail 3; EXCLUDES a symlinked path, a path whose realpath escaped the store root, a basename that no longer matches the sessionId, and any event with `sessionArtifactPath:null`.
- `executePurge`: `confirm:false` → `rmFn` never called; `confirm:true` → `rmFn` called exactly for the deletable set.
- companion integration: `sessions list` prints a recorded artifact; `sessions purge` without `--confirm` deletes nothing.

**Acceptance:** deletion only via recorded+re-validated realpaths; dry-run default + symlink/escape/null-path exclusions proven by test; gemini/ephemeral reported skipped-with-reason; `release:check` + `validate:host-map` green after registration.

---

## 6. T-DRIFTGATE (Q8c) — drift into release gate + auth-wording probe

**Goal:** make provider-flag drift block a release (when CLIs are present) and make auth-error-wording drift visible.

**Current facts:** `check-release.mjs` is a flat sequence of `run(cmd,args)` that `process.exit`s on non-zero. `check-review-cli-drift.mjs` exits `2` on drift, `0` on ok/skip-only. Auth classification depends on text regexes `GEMINI_EXPLICIT_AUTH_ERROR_RE` (`gemini.js:12`) / `KIMI_EXPLICIT_AUTH_ERROR_RE` (`kimi.js:16`) — pure string matches against upstream wording, with NO drift detection today.

**Design:**
- `check-release.mjs`: add `run("npm", ["run", "check:review-drift"])` near the other `validate:*`/check steps. Because the drift script already self-skips absent CLIs (exit 0) and only exit-2s on real drift, this blocks a release only when an installed CLI actually drifted. Place it AFTER the deterministic validators so a contributor without CLIs still gets a clean run.
- **Local regex-anchor sanity check** in `check-review-cli-drift.mjs` (rev2, honest framing per Codex S7 — this is NOT an upstream-drift detector; coordinate with T-VOCAB which also edits this file; T-DRIFTGATE runs AFTER T-VOCAB):
  - Add an `AUTH_ANCHORS` map listing, per provider with an auth regex, the exact anchor substring its regex relies on (gemini `gemini.js:12`, kimi `kimi.js:16`). The check confirms the regex SOURCE still contains that anchor — i.e. it guards against a polycli-side refactor silently dropping the phrase the auth classifier depends on. **It does NOT and cannot detect that the upstream CLI changed its wording** — print the row block as `[ regex-anchor ]` and label it plainly as a local sanity check. Advisory (no exit-code change) unless `--strict`.
  - A real upstream auth-wording probe (forcing/observing an unauthenticated CLI response) remains an **open Q8c follow-up**, not solved here — there is no safe way to force an unauth state in this check. Note this explicitly in the output and in the roadmap Q8c item.

**TDD:** drift-script test asserts that removing an anchor phrase from a (test-injected) regex source produces a `regex-anchor` finding; `check-release` step list includes `check:review-drift` (assert via the exported step list or a smoke test).

**Acceptance:** `release:check` invokes the drift check and stays green on this machine; the regex-anchor sanity check reports ok for current regexes and red when an anchor is removed; output does not overclaim upstream-drift detection.

---

## 7. Integration & verification (Claude, after all tasks)

1. `npm run build:plugins` (regenerate the 5 companion bundles).
2. `node --test` per touched package, then full `npm test` (must stay green; currently 399/399 — expect higher with new tests).
3. `npm run release:check` (now includes the drift gate).
4. `node scripts/check-fixture-freshness.mjs` and `node scripts/check-review-cli-drift.mjs` run clean.
5. `validate:bundles` byte-identical across all 5 bundles.
6. CHANGELOG.md entry + memory update.

## 8. Out of scope (roadmap only)
- **Q8d** SDK migration (multi-release).
- **Q9c** env session isolation (auth/resume risk; needs per-provider design).
- Do NOT touch the separate `polycli-codex` plugin (codex `--ephemeral` belongs there).
