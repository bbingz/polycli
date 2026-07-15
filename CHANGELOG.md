# Changelog

Flat, reverse-chronological log for cross-AI collaboration (Claude / Codex / Gemini / etc.).
Format: `## YYYY-MM-DD — author — headline` followed by bullets.
Separate from `docs/release.md` (release-focused) and `docs/archive/session-memory-*.md` (single handoff snapshot).

---

## 2026-07-15 — Codex — release: v0.6.31 candidate (review remediation)

- Closed all 14 confirmed findings from the v0.6.30 comprehensive review: truthful no-diff/background JSON v2 results, strict provider target disambiguation, accurate TUI effects, active-job visibility, ledger preview redaction, safe prompt transport, structured session identity, and canonical typed failures.
- Hardened provider process lifecycle with bounded stdout/stderr capture, process-tree termination and escalation, deadline-aware Windows/POSIX probes, and exactly-once settlement even when `close` is missing or termination fails.
- Made background cancellation and SessionEnd recoverable: cancellation intent remains active until a verified stop, start failures use a private recovery sidecar, terminal ledger/state publication is ordered, and worker/cancel races cannot publish late provider material.
- Added a source-derived, read-only generated-artifact freshness gate that runs before any in-place bundle rebuild in CI and `release:check`; rebuilt all five companion bundles from current source.
- Prepared host/OpenCode/terminal `0.6.31` and `@bbingz/polycli-utils` `1.0.5`; `@bbingz/polycli-timing` remains `1.0.2` and `@bbingz/polycli-runtime` remains private.

## 2026-07-15 — Codex — release: v0.6.30 published

- Published and registry-verified `@bbingz/polycli@0.6.30` (`latest`, registry time `2026-07-15T08:55:13.583Z`, shasum `882e134363d70545c15e060a8da6c1274a2aa1e7`), `@bbingz/polycli-utils@1.0.4` (`2026-07-15T08:51:16.560Z`, `f89c94947199f4d9d61ec6eddca889bb83a95ec4`), and `@bbingz/polycli-opencode@0.6.30` (`2026-07-15T08:55:44.359Z`, `9f71767156d2278f3f9bbe0cadc3fd1c90ae289f`). `@bbingz/polycli-timing@1.0.2` was unchanged and not republished.
- Created annotated tag `v0.6.30` at `c7e6a278542e9761f55c964ef15236417ed81a25` and published https://github.com/bbingz/polycli/releases/tag/v0.6.30 (`publishedAt` `2026-07-15T09:02:11Z`; non-draft, non-prerelease).
- Pre-publication `npm run release:check` passed (771/771 tests plus strict fixture freshness, bundle/manifest/host/Codex/review-drift/Claude-plugin checks and npm dry-runs); tag-target CI run `29402849982` passed; post-publication registry hashes matched dry-run artifacts, and clean registry installs exercised terminal `agent-context` plus the OpenCode `PolycliPlugin`. See `docs/release-notes-v0.6.30.md`.

## 2026-07-15 — Codex — release: v0.6.30 candidate (agent-native CLI control plane)

- Added one declarative command registry as the source for strict parsing, generated help, host-map validation, terminal metadata, typed errors/output schemas, and the offline `agent-context --json` discovery contract. Unknown option-looking tokens on registered commands now fail with bounded suggestions; pass `--` before prompt text that intentionally begins with an option-like token.
- Split host, provider, invocation, and attempt identities in state and ledger records; made foreground/background/health terminal pairs recoverable and attempt-correct; decoder overflow now terminates the provider process tree before settling once.
- Added opt-in `--json-v2`, explicit `--job id:...|prefix:...|latest*` selectors with typed waits, and the redacted cursor-based `debug tail` surface. Existing `--json` payloads and compatible positional job references remain unchanged.
- Prepared host/OpenCode/terminal `0.6.30` and `@bbingz/polycli-utils` `1.0.4`; publication evidence is recorded in the subsequent release closeout.

## 2026-07-15 — Codex — release: v0.6.29 published

- Published and registry-verified all four public packages as `latest`: `@bbingz/polycli@0.6.29` (registry time `2026-07-15T02:09:46.979Z`, shasum `c63a5135d77417da46e0b16ef9592d4e74ca5e5b`), `@bbingz/polycli-utils@1.0.3` (`2026-07-15T02:10:38.964Z`, `94791ca68cb00f1740f5af540da0f8e29541cb5c`), `@bbingz/polycli-timing@1.0.2` (`2026-07-15T02:10:59.440Z`, `bd305c872ecd50e0abef6b6bd4abefcc1240e15a`), and `@bbingz/polycli-opencode@0.6.29` (`2026-07-15T02:11:18.658Z`, `cdf927ecc557602800e18b5feb5f0d3d2e88c0bb`).
- Created annotated tag `v0.6.29` at `8f9603480c036b910bc9942195a897037006a6f8` and published https://github.com/bbingz/polycli/releases/tag/v0.6.29 (`publishedAt` `2026-07-15T02:12:20Z`).
- Pre-publication `npm run release:check` passed (618/618 tests, strict fixture freshness, bundle/manifest/host/Codex/review-drift/Claude-plugin checks, and all npm dry-runs); post-publication registry tarball hashes matched those dry-runs. See `docs/release-notes-v0.6.29.md`.

## 2026-07-15 — Codex — release: v0.6.29 candidate (provider and lifecycle hardening)

- Prepared the full current release batch: durable background-job terminal transactions and session-artifact handling, status-only default setup auth probes, current provider invocation/parser contracts, and review-safety drift checks. The release keeps the runtime flat and `@bbingz/polycli-runtime` private.
- Refreshed parser fixtures from authorized local CLI captures, pinned Claude at `2.1.210`, added OpenCode2 preview fixture coverage, marked the Gemini individual sign-in capture route `retired`, and marked the temporarily unavailable Copilot subscription capture route `archived` without removing its runtime provider or host plugin.
- Bumped host/OpenCode/terminal packages to `0.6.29`, `@bbingz/polycli-utils` to `1.0.3`, and `@bbingz/polycli-timing` to `1.0.2`; the release gate and registry verification are recorded in the subsequent published closeout.

## 2026-06-26 — Codex — release: v0.6.28 published (provider-state review)

- Published **v0.6.28** to npm: `@bbingz/polycli@0.6.28` (shasum `6ab1bc8e4f8f241ac529058ef325c41f80983e6f`) and `@bbingz/polycli-opencode@0.6.28` (shasum `0cb4db0ee36d9463122533bf1906ceea954222df`), both `latest`. GitHub release `v0.6.28` (`publishedAt` `2026-06-26T15:21:35Z`) + tag `v0.6.28`. Utility packages unchanged.
- Closed PR #15 after review and release-prep: main CI green on `5f2cdde8cae50bd02cc6c25eac0c77f858a93d2a`; `npm run release:check` rerun on merged `main` passed (`npm test` 559/559, bundle/fixture/manifest/host-map/Codex adapter/review-drift/Claude plugin validation, npm publish dry-runs). `@bbingz/polycli@0.6.28` was published by the maintainer during npm 2FA handoff; Codex published the missing `@bbingz/polycli-opencode@0.6.28`, created the GitHub release, and updated release docs.

## 2026-06-26 — Claude — provider-state review: live re-verify all 11 CLIs + drift fixes (PR #15, v0.6.28 release candidate)

- Ran a `provider-state-review` Workflow (11 read-only probe agents → per-provider adversarial verify → synthesis, 23 agents) to re-check every provider CLI's **live install + upstream + adapter contract** on top of `v0.6.27`. Headline: **no version gaps, no breaking CLI drift** — all 11 locals == upstream where comparable (claude 2.1.193 / gemini 0.49.0 / qwen 0.19.2 / copilot 1.0.65 / opencode 1.17.11 / pi 0.80.2 / cmd 0.40.8 / mmx 1.0.16 / kimi-code 0.19.1 / grok 0.2.64 / agy 1.0.12); every flag/auth/argv assumption verified intact against live `--help`.
- **(code) copilot resume contract** — `buildCopilotInvocation` now emits `--session-id <id>` instead of `--resume <id>` for resume-by-exact-id. copilot 1.0.65's `-r, --resume[=value]` takes an OPTIONAL `=`-attached value (or opens the session picker), so the prior space-separated form would not resume by id; `--session-id <id>` is the documented by-id flag. Reachable via `ask`/`rescue --provider copilot --resume <id>` (the companion sets `resumeSessionId`). Regression updated in `copilot.test.js`; all 5 companion bundles regenerated.
- **(code) minimax finish-reason** — `extractMiniMaxResponseFromMmxJson` now honours Anthropic-style `stop_reason` in the `finishReason` fallback (mmx speaks both the OpenAI `finish_reason` and Anthropic Messages `stop_reason` shapes, and the parser already handles Anthropic `content[]` blocks). Pure additive, zero regression; `minimax.test.js` now asserts `finishReason` from the existing `stop_reason` fixture.
- **(docs/comments) kimi version-label refresh** — `kimi-code v0.6.0` → `kimi-code 0.19.1` in `docs/provider-paths.md` + `docs/polycli-v1-public-surface.md`; dropped the re-drifting `v0.6.0` pin from behavioural code comments (`kimi.js`, `review.mjs`, `prompt-runtime.mjs`) since the behaviour is version-general. Bumped the `provider-paths.md` snapshot to 2026-06-26 and replaced the stale `v0.6.21` clause in the `roadmap.md` Current-state section with the 2026-06-26 re-verification note. (Project memory `reference_cli_provider_versions.md` rewritten to the 11-provider reality: pi `@mariozechner`→`@earendil-works`; kimi spawns kimi-code not the shadowed PyPI `kimi-cli`; minimax=`mmx-cli` not `mini-agent`; self-updating kimi/grok/agy have no read-only latest channel.)
- **Deferred / FLAGGED (not changed)** per minimum-diff + the AGENTS.md "flag pre-existing dead code, don't delete" rule: `pi.js` dead `agent_end.result.text`/`resultEvent.error` branches (live `agent_end` carries only `messages[]`/`willRetry`, verified vs pi-agent-core `.d.ts`; harmless); the `opencode.js` billed `run "ping"` auth probe could use non-billing `opencode auth list` but auth-list proves CONFIGURED-not-WORKING, so folding it in would weaken status honesty / risk the four-state; and the JSON/stream-json **event schema** for ~7 providers stays unverified (read-only/cost constraint — needs an execution-allowed run or fixture recapture; gemini/grok fixture meta versions also lag, already tracked by `check:fixture-freshness`).
- Validation: `npm test` 559/559, `npm run release:check` exit 0. Respects the Path B boundary (no shared runtime base, no parser promoted into polycli-utils, timing four-state untouched, cold/retry still unimplemented).

## 2026-06-19 — Claude — release: v0.6.27 published (review residual cleanup)

- Published **v0.6.27** to npm: `@bbingz/polycli@0.6.27` (shasum `397b2349bd3c952c2b612c7f762a9db48e09cb09`) and `@bbingz/polycli-opencode@0.6.27` (shasum `e38d544a851ad67302aa50b7f75d028b80cb6100`), both `latest`. GitHub release `v0.6.27` (`publishedAt` `2026-06-19T09:29:35Z`) + tag `v0.6.27`. Utility packages unchanged.
- Cleared the remaining v0.6.26-review residuals via PR #13 (Node 20 CI green, rebase-merged): fixed a background-job disk leak (`saveState` now reclaims the result/config/log artifacts of terminal jobs pruned past `MAX_JOBS`, wiring the previously-dead `removeJobFile` + a new `removeJobLogFile`); enforced the `docs/capture-fixtures.md` path/meta contract in `validate-fixture-metadata.mjs` (provider==dir, name==stem); added OpenCode exit-2 execution-path coverage (`runCompanion` exported with an injectable spawn); and synced the `docs/roadmap.md` Current-state section that still said the latest release was v0.6.24. A repo-wide scan confirmed no other release-state claim was stale. See `docs/release-notes-v0.6.27.md`.

## 2026-06-19 — Claude — release: v0.6.26 published (review fixes)

- Published **v0.6.26** to npm: `@bbingz/polycli@0.6.26` (shasum `b1ec2bcf366f1974e6850c42ca8c3ee81695999a`) and `@bbingz/polycli-opencode@0.6.26` (shasum `f1e86227af994c281d0fe860c59809b04c103470`), both `latest`. GitHub release `v0.6.26` (`publishedAt` `2026-06-19T09:03:11Z`) + tag `v0.6.26`. Utility packages unchanged.
- Addresses an external review of v0.6.25 via PR #12 (Node 20 CI green, rebase-merged): **(High)** fixed `extractTerminalError` missing a nested error object (`{error:{message:...}}`) so visible partial text was wrongly `ok:true` — covers `parseGrokJsonResult` + `parseGrokStreamText`, with json/streaming/empty-object regressions; **(Medium)** constrained the cc-X validator `status` to `verified`/`marketplace-unstable` and clarified roadmap Q10 that the validator guards structure + source-anchoring, not current-truth; **(Medium)** synced release-state docs (README en/zh/ja + roadmap snapshot) that still said v0.6.24; **(Low)** added a `runQwenPrompt` `--model` argv regression. See `docs/release-notes-v0.6.26.md`.
- Deferred (declared): `validate-fixture-metadata.mjs` path/meta consistency is a pre-existing Low gap, flagged for a separate change.

## 2026-06-19 — Claude — release: v0.6.25 published

- Published **v0.6.25** to npm: `@bbingz/polycli@0.6.25` (shasum `f243987016b6b89d536aadb83314a9416acd52e8`) and `@bbingz/polycli-opencode@0.6.25` (shasum `387fbf0347c5abc498d632c654b29783613240d5`), both `latest`. GitHub release `v0.6.25` (`publishedAt` `2026-06-19T08:09:43Z`) + tag `v0.6.25`. Utility packages unchanged (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
- Bundles the three entries below (re-verification remediation + tmux test stabilization + cc-X endpoint recipes). Landed via PR #11 (Node 20 CI green; the previously-flaky tmux test passed on CI), merged to `main` via rebase. See `docs/release-notes-v0.6.25.md`.

## 2026-06-19 — Claude — docs: cc-X domestic-model endpoint recipes (Path-B docs + reference data)

- Added `docs/cc-x-endpoints.md` (human reference) + `docs/cc-x-recipes.json` (machine-readable source of truth) encoding the cc-X pattern: point the EXISTING `claude` runtime (BYOK) or `opencode` (OpenAI-compatible) at a domestic vendor's Anthropic-compatible endpoint via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_MODEL`. Covers 9 entries across 7 PRC core labs (MiniMax, Moonshot Kimi, Zhipu GLM, Alibaba Qwen, DeepSeek, ByteDance Doubao, StepFun, Baidu Qianfan, Tencent) with per-vendor base URL, model-id family, native-CLI grouping, context-window (`autoCompactWindow`), caching note, and a `source` URL+date per entry.
- Encoded the operational gotchas: silent prompt-cache degradation on shim endpoints (dual cache-breakpoint; DeepSeek is the auto-prefix-caching exception), pin a known-good Claude Code version + `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`, size `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to the model's context, marketplace (Baidu/Tencent) model-identity instability, and the PRC data-sovereignty/Entity-List gate as SEPARATE from harness choice.
- Honest-default: marketplace/resale endpoints carry `status: "marketplace-unstable"` and `autoCompactWindow: null` (no fabricated model/version pin), mirroring the gemini attempted-vs-used-model caveat in `docs/model-fallback-policy.md`. Enforced by `scripts/validate-cc-x-recipes.mjs` (a pure validator modeled on `validate-fixture-metadata.mjs`) + `scripts/tests/validate-cc-x-recipes.test.mjs` (auto-joined by the npm-test glob); added `npm run validate:cc-x-recipes` for standalone use.
- Documented that cc-X is NOT a polycli provider/adapter/runtime — it rides the existing runtimes via standard env vars; the `claude -p` path forwards them via full `process.env` inheritance, while the tmux allowlist (`CLAUDE_TMUX_ENV_EXACT`) forwards the `ANTHROPIC_*` trio but NOT the `CLAUDE_CODE_*` knobs (documented, not fixed). Clarified that the polycli `minimax`/`mmx-cli` provider is a stateless text/media call, not the MiniMax cc-X coding path.
- Cross-linked from `docs/provider-paths.md` (new subsection + Official-references bullet) and `docs/polycli-v1-public-surface.md` (one out-of-contract sentence). Recorded the no-adapter decision in `docs/roadmap.md` as closed Q10 + an Explicit-non-goals bullet. Zero runtime/production-path code change; `claude.js` env behavior left untouched by design. Verification: `node scripts/validate-cc-x-recipes.mjs` ok (9 entries), `node --test scripts/tests/validate-cc-x-recipes.test.mjs` 5/5, `npm test` + `npm run release:check` green. Snapshot facts are 2026-06-19; the validator guards structure + source-anchoring, not current-truth.

## 2026-06-19 — Claude — adversarial re-verification of the workflow-review remediation

- Independently re-verified the committed remediation sweep (d272042 + 03ae92d) with a Workflow fan-out (9 adversarial auditors -> double-refutation -> completeness critic). 18 raw findings -> 7 confirmed + 1 critic-confirmed; 11 refuted. Confirmed the prior fixes are sound and re-ran full validation (the prior round's open residual #1): `npm test` 544/544, `npm run release:check` exit 0.
- Closed residual #3 (state-root permissions) with real-filesystem evidence: under permissive umask 000, stateRoot/stateDir/jobsDir resolve to 0700 and state.json/job-config to 0600, enforced by explicit chmod (not umask). Characterized residual #4 (orphan `<jobId>.json` result files leak after MAX_JOBS pruning) as a PRE-EXISTING latent issue — `removeJobFile` is a dead export and the old code pruned identically — so it is out of scope for this remediation and left flagged, not fixed.
- Fixed 2 confirmed regressions introduced by the remediation: (1) the opencode host adapter threw on exit code 2, but 2 is the companion's documented soft signal (`health` with no healthy provider, `status --wait` timeout) that still emits a valid JSON envelope on stdout — extracted `isHardCompanionFailure(status)` so exit 2 returns the envelope while exit 1/4/5/crash still reject; (2) `cancelJob` ran `cleanupRuntimePaths` (which deletes a review job's live cwd via cleanupPaths) BEFORE killing the worker — reordered to kill first, then clean up, and skip the runtime-path deletion entirely when the kill fails (worker may still be alive).
- Fixed 2 confirmed incomplete fixes: (1) Grok `SUCCESS_STOP_REASONS` omitted `MaxTokens`, so a truncated-but-visible answer was wrongly marked ok=false — added maxtokens/max_tokens/length (grok-build's real StopReason enum is {EndTurn, MaxTokens, MaxTurnRequests, Refusal, ToolUse, Cancelled}, verified against the installed binary); refusal/cancelled/tool_use/max_turn_requests stay non-success; (2) the run-ledger append path created `~/.polycli/state/<slug>` world-traversable (0o755) via the mode-less ensureParentDir on the run_started event that fires before any other state write — `appendRunLedgerEvent` now calls `ensureStateDir` first to land it 0o700.
- Closed 4 confirmed test gaps (all mutation/RED-proven): pre-existing-0755 dir hardening test for `ensureStateDir` (state-1); state-dir-0700-after-append-only test for the run-ledger path (pwp-2, RED-proven); Grok non-success-stopReason-ALONE failure tests for both parseGrokJsonResult and runGrokPromptStreaming plus a MaxTokens-success test (test-1 + grok-1, RED-proven); sync `runProviderPrompt` explicit-model-before-default fallback test mirroring the streaming case (qwen-model-1); new `scripts/tests/opencode-host.test.mjs` pinning the exit-2 soft-signal contract (oc-status-1).
- All changes respect the Path B architecture boundary: no shared runtime base class, no provider parser promotion into polycli-utils, timing four-state untouched, cleanupPaths still sourced only from internal review temp dirs.
- Verification: focused RED/GREEN proofs for grok-1 and pwp-1 (reverting each fix turns its new test red); focused suite 66/66; `npm test` 544/544 (535 + 9 new tests); `npm run release:check` exit 0 (plugin bundles 5, fixture metadata 17, codex adapter 5; one tmux.jsonl ENOENT flake on the first run was the known full-suite-parallel-load flake — claude.test.js passes 28/28 in isolation, and the re-run was clean). Not published; current unreleased workspace work after v0.6.24.

## 2026-06-16 — Codex — Grok fixture residual cleanup

- Closed the remaining workflow-review residual risk by capturing a real Grok streaming fixture with `grok 0.2.51 (f4f85a6492e) [stable]`: `grok -p 'Reply with exactly HELLO_GROK_FIXTURE and nothing else.' --output-format streaming-json -m grok-build --permission-mode plan --disable-web-search --max-turns 1`.
- Added `packages/polycli-runtime/test/fixtures/grok/stream-success.*` and wired Grok into the table-driven fixture replay test, so Grok's real `thought` / `text` / `end` streaming shape is now parser-checked in CI.
- Removed the default Grok missing-success allowlist from `validate:fixtures`; the command now checks 17 fixture metadata files and prints no missing-success allowlist rows.
- Updated the hardcoded Grok fallback/default-model guidance from stale `grok-composer-2.5-fast` to current local default `grok-build`, and aligned the Grok plugin guidance skills plus fixture-capture docs.
- Verification: `node --test packages/polycli-runtime/test/grok.test.js packages/polycli-runtime/test/fixture-replay-all.test.js scripts/tests/validate-fixture-metadata.test.mjs && node scripts/validate-fixture-metadata.mjs` passed; `node --test packages/polycli-runtime/test/*.test.js scripts/tests/validate-fixture-metadata.test.mjs && node scripts/validate-fixture-metadata.mjs && node scripts/check-fixture-freshness.mjs` passed with Grok fresh and older provider fixture-staleness warnings remaining warn-only; `npm test` passed 535/535; `npm run release:check` exit 0, including `validate:fixtures` at 17 checked and no allowlist output. Not published.

## 2026-06-16 — Codex — workflow review remediation sweep

- Remediated the confirmed medium/low findings from the workflow deep review batch without changing the Path B architecture: no shared provider base class, no provider parser promotion into `polycli-utils`, and no timing-state collapse.
- Hardened local privacy defaults: terminal fallback state now uses `~/.polycli/state` instead of shared OS temp; state/workspace/job dirs are created private; state, job config/result, ledger, timing, preview, and provider model cache writes use private modes where applicable.
- Fixed background job lifecycle gaps: cancellation now records cancelled terminal ledger events, removes per-job config, cleans runtime `cleanupPaths`, and `MAX_JOBS` pruning preserves queued/running jobs. The queued-to-running parent write now uses a stale-write guard so an already-terminal worker result is not overwritten.
- Fixed host/provider semantics: OpenCode host adapter treats every non-zero companion exit as failure even with stdout; Qwen forwards explicit `--model`; registry model fallback now prefers provider output, then explicit model, then cached/default model; Grok marks terminal error metadata or non-success stop reasons as failed while preserving partial text.
- Closed observability/test/doc gaps: TUI recognizes `provider_decision:passed`, all captured runtime fixtures are replayed through provider parsers, fixture metadata requires success fixtures for parser-backed providers, sessions list/purge has companion wiring integration coverage, README/public-surface/host-map/docs drift was aligned, and CI now dry-runs the terminal package tarball.
- Stabilized the Claude tmux TUI fake-bin tests under full-suite parallel load by widening the test-only tmux timeout budget; this fixes the `tmux.jsonl` ENOENT flake seen during full-suite verification.
- Verification: focused RED/GREEN tests for permissions, cancel cleanup, active job pruning, OpenCode non-zero exits, Qwen model forwarding, Grok terminal errors, TUI passed status, fixture replay/metadata, sessions CLI wiring, and queued-to-running stale writes; `node --test packages/polycli-runtime/test/claude.test.js` passed 28/28 after test stabilization; `npm test` passed 535/535; `npm run release:check` exit 0, including bundle/fixture/manifest/host-map/Codex adapter/review-drift checks, Claude plugin validation, and npm pack dry-runs for opencode/utils/timing/terminal.
- Follow-up note: the remaining Grok real-fixture gap was closed in the later `Grok fixture residual cleanup` entry above. Not published; this is current unreleased workspace work after v0.6.24.

## 2026-06-16 — Codex — post-v0.6.24 latest-package review cleanup

- Ran `@bbingz/polycli@0.6.24` from npm against the `v0.6.23..HEAD` release diff: `health --json` found gemini, qwen, minimax, claude, copilot, opencode, pi, cmd, agy, and grok healthy; kimi remained quota-blocked with 403.
- Dispatched independent background reviews through claude, copilot, opencode, pi, cmd, gemini, qwen, minimax, and grok. All 9 completed; `agy review` correctly rejected because agy cannot enforce non-interactive read-only plan mode. Five providers reported no issues; four raised low/medium candidates.
- Adjudication: overturned package-lock drift because root workspaces are only `packages/*`, so `plugins/polycli-opencode` has no lockfile package entry; overturned stale `docs/release-notes-v0.6.23.md` `latest` wording as historical release-note state, not current release state.
- Fixed the confirmed compatibility regression where `status --all --timeout-ms abc --json` failed without `--wait`; timeout values are now parsed only for wait paths, preserving the previous no-wait status behavior.
- Hardened regression coverage: single-job `status <jobId> --wait --timeout-ms 1 --json` now asserts exit code 2 and `waitTimedOut:true`; invalid timeout coverage now checks both all-job and single-job wait paths; the fake delayed job timeout test uses a wider 3000ms delay to avoid slow-runner flakes.
- Verification: focused RED/GREEN test for status wait timeout cases; `node --test plugins/polycli/scripts/tests/integration.test.mjs` passed 60/60; `npm test` passed 516/516; `npm run release:check` exit 0, including bundle/fixture/manifest/host-map/Codex adapter/review-drift checks, Claude plugin validation, and npm pack dry-runs. Not published; this is current unreleased workspace work after v0.6.24.

## 2026-06-16 — Codex — status wait timeout hardening

- Ran a second real multi-provider review of the v0.6.23 release surface. Reviews completed through claude, copilot, opencode, pi, cmd, gemini, qwen, minimax, and grok; kimi remained quota-blocked; agy correctly rejected `/review` because it cannot enforce a read-only non-interactive plan mode.
- Fixed confirmed `status --all --wait` timeout findings: JSON mode now exits 2 on timeout, text mode prints `Timed out waiting for all jobs.`, invalid `--timeout-ms` values are rejected as positive-integer errors, and the all-job waiter no longer performs an unused initial snapshot read.
- Applied the same timeout parser and timeout exit-code handling to the existing single-job `status --wait` path.
- Hardened the explicit Claude tmux TUI worker regression assertion against missing `timing.meta`.
- Verification: focused red/green regressions; `node --test plugins/polycli/scripts/tests/integration.test.mjs` passed 60/60; `npm test` passed 516/516; `npm run release:check` exit 0, including bundle/fixture/manifest/host-map/Codex adapter/review-drift checks, Claude plugin validation, and npm pack dry-runs.
- Published GitHub release `v0.6.24`: https://github.com/bbingz/polycli/releases/tag/v0.6.24 (`publishedAt` `2026-06-16T07:26:49Z`).
- npm `latest` verified as `0.6.24` for both public host packages: `@bbingz/polycli-opencode@0.6.24` (`time.modified` `2026-06-16T07:28:01.606Z`, shasum `5da8640b1bba6b3da6309bd87692596c9cc8fb34`) and `@bbingz/polycli@0.6.24` (`time.modified` `2026-06-16T07:28:13.403Z`, shasum `8a766b320a3f5ed18b6e083ab98b87c6fc753b9e`).

## 2026-06-16 — Codex — post-release full-provider smoke fixes

- Ran a real Polycli full-provider smoke review of the v0.6.22 diff (`--base v0.6.21 --scope branch`) and adjudicated provider reports against source. The release diff itself had no confirmed correctness/security regression; the smoke exposed two Polycli control-plane bugs.
- Fixed `health --provider opencode`: health probes now hydrate provider runtime env before calling `runProviderPromptStreaming`, preserving `PATH` when prompt constraints inject `OPENCODE_CONFIG_CONTENT`. This removes the false `spawn opencode ENOENT` result while keeping the deny-all opencode config in place.
- Fixed `status --all --wait`: the command now waits for every active job and returns an all-job status snapshot instead of waiting only for the latest active job and returning a single-job envelope.
- Added companion-level coverage for the explicitly retained Claude `executionMode: "tmux-tui"` worker path, plus regressions for opencode health env hydration and `status --all --wait`.
- Verification: focused red/green regressions; live `polycli health --provider opencode --json` returned healthy; `node --test plugins/polycli/scripts/tests/integration.test.mjs` passed 58/58; `npm test` passed 514/514; `npm run release:check` exit 0, including bundle/fixture/manifest/host-map/Codex adapter/review-drift checks, Claude plugin validation, and npm pack dry-runs.
- Published GitHub release `v0.6.23`: https://github.com/bbingz/polycli/releases/tag/v0.6.23 (`publishedAt` `2026-06-16T06:44:46Z`).
- npm `latest` verified as `0.6.23` for both public host packages: `@bbingz/polycli-opencode@0.6.23` (`time.modified` `2026-06-16T06:49:58.445Z`, shasum `96a99bb18f69fd40dd8a3c78506311fc89b0d0d7`) and `@bbingz/polycli@0.6.23` (`time.modified` `2026-06-16T06:50:22.282Z`, shasum `02d016850b5998eabb2bb3faefa6c12ca7e4bfcc`).

## 2026-06-16 — Codex — v0.6.22 published (Claude print defaults)

- Anthropic paused the Agent SDK / `claude -p` dedicated-credit change, so the previous default tradeoff no longer holds for ordinary Claude `ask` / `review`.
- Restored Claude `ask` / `review` defaults to headless `claude -p` while preserving plan/no-tools/no-MCP constraints (`--permission-mode plan --tools "" --mcp-config '{"mcpServers":{}}' --strict-mcp-config`).
- Kept the detached tmux TUI runtime path intact for explicit/internal callers, especially workflow cases that need an interactive Claude Code runtime.
- Updated focused tests and current docs to separate the historical v0.6.21 tmux-default release from the current main behavior.
- Live smoke: `POLYCLI_TMUX_BIN=/tmp/polycli-no-tmux-for-print-smoke node plugins/polycli/scripts/polycli-companion.mjs ask --provider claude --json ...` returned `ok:true`, response `POLYCLI_CLAUDE_PRINT_SMOKE_20260616`, measured `ttft/gen/tail`, session `e639c2cb-320f-4226-b521-ed5b608851b9`, and Claude-reported `total_cost_usd:0.11984500000000001`.
- Published GitHub release `v0.6.22`: https://github.com/bbingz/polycli/releases/tag/v0.6.22 (`publishedAt` `2026-06-16T02:52:57Z`).
- npm `latest` verified as `0.6.22` for both public host packages: `@bbingz/polycli-opencode@0.6.22` (`time.modified` `2026-06-16T02:51:05.698Z`, shasum `09e36dbd10d2bc72257f3c27ed3b6b910809901e`) and `@bbingz/polycli@0.6.22` (`time.modified` `2026-06-16T02:51:14.262Z`, shasum `28b00344f743ec0b37342242c80b81867b293c73`).

## 2026-06-15 — Codex — Claude workflow orchestration design

- Researched the current Claude Code Dynamic Workflow surface, Codex xhigh planning options, and local Claude/Qwen/Minimax/Kimi/MiMo workflow run artifacts to choose an implementation path for multi-level subagent workflows.
- Added `docs/superpowers/specs/2026-06-15-claude-workflow-orchestration-design.md`. The design keeps Codex xhigh as a planner/compiler for workflow JS, uses Claude Code Dynamic Workflows as the actual subagent runtime, and launches Claude through the existing tmux TUI path so the default does not fall back to `claude -p` or Agent SDK credit usage.
- Scoped polycli to a thin control/observability surface (`workflow plan/start/list/status/result`) instead of a new agent framework. Workflow artifact readers must treat Claude's `workflows/wf_*.json` and `subagents/workflows/<id>/*.jsonl` format as observed local evidence, not a guaranteed public API.

## 2026-06-15 — Codex — v0.6.21 published (Claude tmux TUI + review remediation)

- Released **v0.6.21** after the third-party review remediation closeout. GitHub release/tag to be created from this release commit; npm publication is already visible on the registry.
- npm `latest` verified via `npm view`: `@bbingz/polycli@0.6.21` and `@bbingz/polycli-opencode@0.6.21`. Utility packages remain on their independent v1 line: `@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`.
- Release content: Claude `ask`/`review` default to detached tmux TUI mode instead of `claude -p`; tmux launch responses expose `tmuxSession`/`attachCommand` and startup-only timing; review gate sentinel parsing, auth probing, fixture freshness, state cleanup, tempfile cleanup, unsafe pid guards, and docs parity are hardened.
- Verification: `npm run release:check` exit 0 (`npm test` 511/511 + bundle/fixture/manifest/host-map/Codex adapter/review-drift/Claude plugin validation + npm dry-runs). `npm whoami` authenticated as `bbingz`; npm publish completed for the two v0.6.21 public host packages.

## 2026-06-15 — Codex — final multi-review cleanup before merge closeout

- Re-ran a source-grounded adjudication over the remaining non-Qwen review findings after PR #9 landed. One additional behavior bug was confirmed still-present: the stop-time review gate scanned all response lines for bare `ALLOW:` / `BLOCK:` sentinels, so a provider echo of the previous Claude response could be misread as the gate verdict.
- Fixed the stop-review gate by generating a per-run `POLYCLI_STOP_REVIEW_*` token, requiring `ALLOW <token>:` / `BLOCK <token>:` in the provider response, and ignoring stale bare sentinels when the token is active. Added parser and `runStopReview` regressions.
- Rechecked the old `isTerminalSummaryEvent` finding. It is not a live MiniMax/cmd/agy/kimi bug in the current runtime: MiniMax declares `ttft`/`tail` unsupported, cmd/agy stream only text-delta events, and Kimi's meta event carries no visible text. No code change kept for that claim.
- Remaining non-bug findings are tracked as design/maintenance items, not release blockers: Claude ask/review stays detached tmux TUI by product requirement; Claude health stays auth-only; provider env filtering and duplicated transient-pattern helpers are future hardening/refactor candidates.

## 2026-06-15 — Codex — Qwen audit checklist remediation

- Consolidated the Qwen third-party review batch into `docs/audit/third-party-review-followup-2026-06-15.md`, then verified all 11 claims with independent subagents against the current worktree before editing. All 11 were confirmed still-present before remediation.
- Fixed the three behavior/security issues with regressions: `writeFileAtomicSync` now removes its temp file on failed rename/write paths; no-diff review cleanup now runs in a `finally` so Gemini isolated tempdirs are removed; unsafe pid values (`<=1` / non-integers) are rejected before process-group termination.
- Added the missing Claude health logged-out integration coverage by making the fake Claude auth fixture emit `loggedIn:false` via env, and asserting the companion reports Claude unhealthy with a populated probe error.
- Closed the docs/parity findings: plugin README lists `debug` / `sessions` and terminal TUI ownership; root and translated READMEs describe Claude health as auth-only, add the terminal package badge, outcome diagnostics, and `minimax` (`mmx-cli`) alias; timing/runtime package READMEs document v1 `cold`/`retry` and `REVIEW_FLAG_EXPECTATIONS`.
- Verification: focused regressions pass; `npm test` exit 0 (508/508); `npm run release:check` exit 0 including bundle, fixture, manifest, host-map, Codex adapter, review-drift, Claude plugin validation, and npm pack dry-runs.

## 2026-06-15 — Codex — multi-review adjudication follow-up

- Adjudicated the Minimax/Kimi/MiMo review batch against the current source after the Claude tmux TUI remediation. Kept the user-requested Claude tmux TUI default instead of reverting `ask`/`review` to `claude -p`; treated "restore synchronous LLM answer" findings as a product-semantics conflict, not a fix to apply.
- Fixed two confirmed issues: Claude legacy `auth status` non-JSON success output is now parsed or marked inconclusive instead of treated as logout, and `session-lifecycle-hook.mjs` now removes session jobs through locked `updateState` rather than naked load/save.
- Closed release-safety/doc drift found in the review batch: fixture freshness probes now cover the 11-provider runtime surface (`cmd`, `agy`, `grok` included); README capability notes, `docs/provider-paths.md`, `docs/polycli-v1-public-surface.md`, `CLAUDE.md`, and `docs/roadmap.md` describe Claude tmux TUI startup-only timing and the `tmuxSession`/`attachCommand` response shape.
- Added draft `docs/release-notes-v0.6.21.md` for the current unreleased patch rather than rewriting the already-published v0.6.20 notes.

## 2026-06-14 — Codex — Claude tmux TUI review remediation

- Adjudicated the Claude/DeepSeek review findings against the current code and the user requirement that Claude subagent calls avoid the upcoming `claude -p` pay-as-you-go path. Confirmed the ask/review semantic drift, timing ambiguity, missing signal cleanup, tmux environment propagation gap, and auth-only health ambiguity; intentionally did **not** revert Claude ask/review defaults to `-p`.
- Hardened Claude tmux TUI mode: `tmux new-session` now receives an explicit allowlist of Claude/Anthropic/proxy/cert env vars via `-e`; SIGINT/SIGTERM during orchestration kill the created tmux session before process shutdown; missing tmux gets a direct install/config error; successful tmux launches return `detached:true`, `responseKind:"tmux_tui_session_started"`, `warnings`, and `timingMeta` that says timing covers only `tmux_startup` and `llmCompletionObserved:false`.
- Runtime timing now merges provider `timingMeta` and uses the run-level timing support for Claude tmux TUI, so `ttft/gen/tail` stay `unsupported`, `total` remains schema-valid `measured`, and the record explicitly marks `tmuxDetached:true` / startup-only timing. Claude health remains no-model-call/auth-only by design and now reports `probe.kind:"auth_status"` plus `authOnly:true` instead of looking like a sentinel LLM probe.
- Tests added/updated for tmux env propagation, detached payload semantics, startup-only timing metadata, signal cleanup, Claude health auth-only reporting, and companion ask/review integration. Bundles regenerated for all host surfaces.
- Verification: `npm test` exit 0 (500/500); `node --test packages/polycli-runtime/test/claude.test.js`; `node --test packages/polycli-runtime/test/registry.test.js`; `node --test plugins/polycli/scripts/tests/integration.test.mjs`; `npm run validate:bundles`; `npm run validate:manifests`; `npm run validate:host-map`.

## 2026-06-02 — Claude — repo cleanup: removed stale R8 worktrees + `release/v0.6.19` branch

- After the v0.6.20 release, deleted the merged `release/v0.6.19` branch and the 3 abandoned `worktree-agent-*` git worktrees + their branches (all local-only — none on origin). Verified safe first: each branch had 0 commits not in `main` (so `git branch -d` succeeded, git-confirming they were merged); the worktrees' only uncommitted content was an identical, obsolete 2026-04-24 path-rewrite (`/home/user/…`→`<local-home>/…`) on a snapshot ~41k lines behind `main`, locked by a dead pid (96484).
- The single (identical across all 3) staged diff was saved to `/tmp/r8-worktree-staged-pathrewrite.patch` as insurance, but applying it is NOT advised: active files (README/docs) no longer carry those paths, and the remaining `/home/user/` references on `main` are historical records (CHANGELOG, `docs/archive/*`, `release-notes-v0.6.1`) that should not be rewritten.
- Repo now has a single `main` branch, synced with origin, at v0.6.20.

## 2026-06-02 — Claude — docs: kimi-code v0.6.0 skill/docs refresh + README 11 providers (PR #8)

- Closed the doc-debt deferred through v0.6.20 (merged via PR #8). The kimi skill prose + reference docs still described the legacy Python kimi-cli, contradicting the kimi-code v0.6.0 adapter: rewrote `kimi-cli-runtime/SKILL.md` (`-p` one-shot, structured `session.resume_hint` id, `--session`/`-C` resume, `~/.kimi-code/`, prompt-only review); fixed `kimi-prompting/SKILL.md` rule 4 (`--max-steps-per-turn` is config-level now), and the kimi rows in `docs/provider-paths.md` + `docs/polycli-v1-public-surface.md`.
- README (GitHub-rendered) provider prose list, Hosts/providers table, and capability matrix now list all 11 providers — added the previously-missing `agy` (since v0.6.18) and `grok` (v0.6.20); `readme-header.svg` "ten"→"eleven".
- Docs-only (no code/bundle change). `npm test` 483/483; `validate:codex-adapter` / `host-map` / `manifests` green.

## 2026-06-02 — Claude — v0.6.20 published (GitHub release + npm)

- Released the merged grok / kimi-code / deep-review work as **v0.6.20**. GitHub release: https://github.com/bbingz/polycli/releases/tag/v0.6.20.
- npm `latest` (verified via `npm view`): `@bbingz/polycli@0.6.20`, `@bbingz/polycli-opencode@0.6.20`, `@bbingz/polycli-utils@1.0.2` (bumped for the atomic-save/process/stream fixes); `@bbingz/polycli-timing@1.0.1` unchanged.
- Gate: `npm run release:check` exit 0 (`npm test` 483/483 + validate:bundles/fixtures/manifests/host-map/codex-adapter + check:review-drift + `claude plugin validate` ×2 + publish dry-runs). See the gate/merge entry below for the substantive changes.

## 2026-06-02 — Codex — baseline GitHub branch protection for public non-fork repos

- Configured minimal default-branch protection for all `bbingz` public, non-fork repositories that currently have a default branch: `polycli`, `engram`, `Rules`, `kimi-plugin-cc`, `gemini-plugin-cc`, `minimax-plugin-cc`, `qwen-plugin-cc`, `tech-microgpt-cn`, `ZhaoShengList`, `feishu-chatgpt`, `bbingz.github.io`, and `gfw`.
- The protection baseline blocks force pushes and branch deletion, and applies to admins (`protected=true`, `allow_force_pushes=false`, `allow_deletions=false`, `enforce_admins=true`). It intentionally does not require status checks or PR reviews, so normal push/merge behavior is not gated by this change.
- Verification: listed public repos with `gh repo list bbingz --visibility public --limit 1000`, wrote branch protection with `gh api --method PUT repos/{repo}/branches/{default}/protection`, and read back each default branch plus protection object. `bbingz/bingz` has no default branch, so it was not applicable; public forks were not modified.

## 2026-06-02 — Claude — Codex review-gate on PRs #5/#6/#7, then merge all three to main (11th provider grok; unreleased)

Three independent PRs (deep-review hardening, kimi→kimi-code v0.6.0 migration, grok provider) went through a pre-merge Codex review gate, were fixed where findings were real, and were merged to `main` in order #5→#6→#7. NOT released — latest published release is still v0.6.19; this work accumulates for a future release.

**Gate adjudication (Codex is not ground truth — every finding was checked against the real code):**
- **PR #7 (grok)** — Codex CHANGES_REQUESTED, all 3 real: (a) auth-probe ordering bug — `/\blogged in\b/i` banner check ran before the explicit auth-error regex, so a logged-out `not logged in` (which contains the substring `logged in`) was misread as `loggedIn:true`; reordered + regression test. (b) grok was half-wired — added it everywhere `agy` is advertised (polycli-codex + polycli-copilot skill descriptions/arg-hints, polycli-codex README + plugin.json, root README, host-command-map, and `validate-codex-adapter` PROVIDERS). (c) `grok-cli-runtime` SKILL over-claimed `--effort` mapping (polycli `--effort` is gemini-only, dropped for grok).
- **PR #6 (kimi-code)** — Codex CHANGES_REQUESTED; 1 real, reframed: buildKimiInvocation emitted `-r <id>` for resume-by-id, but kimi-code v0.6.0 has no `-r` (`kimi --help`: resume-by-id is `-S, --session [id]`, continue-last `-C`); the path is reachable via `rescue --resume <id>`, so `-r` would be rejected at runtime — switched to `--session`. Also tightened the session-id parse to require `type==='session.resume_hint'`. Fixed a fragile review integration test exposed by committing the migration (`doesNotMatch(argv.join())` also matched the reviewed diff text embedded in the `-p` prompt → false positive; now checks flags as discrete argv tokens). Codex false-positives (verified, not changed): the `-p`+`--plan/--auto/--yolo` combination is latent-only (no caller injects those), and the `~/.kimi/` literal is an intentional migration-history comment.
- **PR #5 (deep-review)** — Codex review stalled (~20 min, no output) on the 1249-line diff, so the gate ran a Claude-driven 6-dimension adversarial workflow (20 reviewers): auth-probe transient cluster, atomic-save locking, signal-kill, stream limit, job-control concurrency, state dedup, companion sessionId, test adequacy. 14 raw findings → 0 survived adversarial verification (the 25 hardening fixes are correctly implemented, no regressions). Only actionable item: untracked an accidentally-committed `.codegraph/.gitignore` and added `.codegraph/` to root `.gitignore`.

**Merge mechanics:** source 3-way merges were clean (provider entries from kimi + grok both preserved; PROVIDERS includes grok). The 5 `polycli-companion.bundle.mjs` files conflicted/auto-merged textually but git's textual bundle merge did NOT match the source — regenerated all bundles via `npm run build:plugins` so they are byte-identical to the merged source.

**Verification on merged `main`:** `npm test` exit 0 (483/483, up from 453); `validate:host-map` (12 capabilities), `validate:codex-adapter` (5 files, now includes grok), `check:review-drift` (no drift) all exit 0; `PROVIDER_IDS` = 11. `docs/roadmap.md` updated to 11-providers-in-main / unreleased. NOT run: `release:check` + npm publish (no release this round).

## 2026-05-30 — Codex — review v0.6.19 upgrade docs for current-state drift

- Reviewed the v0.6.19 upgrade range (`v0.6.18..HEAD`) after Claude's maintenance/session-pollution increment. No code-level regressions were found in the new review-flag, session-artifact, bundle, or release-check paths under current verification.
- Fixed two durable documentation facts that had drifted after the release closeout: `docs/roadmap.md` now reports v0.6.19 / 10 providers as current state and lists the new fixture-freshness guardrail; `docs/archive/session-memory-2026-05-30.md` now records `84621b1` as the publish closeout commit instead of a permanently current `main HEAD`.
- Verification: `npm test` exit 0 (453/453); focused new-area tests exit 0 (69/69); `npm run validate:bundles`, `validate:fixtures`, `validate:manifests`, `validate:host-map`, and `validate:codex-adapter` exit 0; `npm run check:review-drift` exit 0 (all installed CLI flag probes ok); `npm run check:fixture-freshness` exit 0 with 16 expected STALE warnings; `claude plugin validate` passed for both Claude manifests; `git diff --check v0.6.18..HEAD` exit 0.

## 2026-05-29 — Claude — v0.6.19: Q8a/b/c maintenance hardening + Q9a/b upstream session-pollution control

Spec-driven increment (`docs/superpowers/specs/2026-05-29-maintenance-and-pollution-design.md`) from the 2026-05-29 strategy recon (memory `project_competitive_landscape_and_moat`, roadmap Q8/Q9). Two Codex review gates: spec → CHANGES_REQUESTED → rev2 (review `019e73b4`); implementation → CHANGES_REQUESTED → fixes → APPROVE (`aeec4314`). Implemented by parallel sub-agent waves, integrated + verified by Claude. Published 2026-05-29: GitHub release `v0.6.19` (https://github.com/bbingz/polycli/releases/tag/v0.6.19) + npm `@bbingz/polycli-opencode@0.6.19` and `@bbingz/polycli@0.6.19` (both `latest`, verified via `npm view`).

**Q9a/Q9b — upstream session-pollution control** (the user's #3 pain: spawned-CLI session files accumulate under `~/.claude`, `~/.gemini`, …):
- run-ledger events now carry `sessionId` (between `model` and `defaultModel`) and a verified `sessionArtifactPath` (after `sessionId`), threaded at the companion foreground + worker run sites and the job-control recovery path where result/cwd/provider are in scope; `null` (never fabricated) where not (`run-ledger.mjs`, `polycli-companion.mjs`, `job-control.mjs`).
- `plugins/polycli/scripts/lib/sessions.mjs` (NEW): `deriveSessionArtifactCandidate` (ONE exact path per provider, NO glob — claude `~/.claude/projects/<cwd '/'→'-'>/<id>.jsonl` verified against the live store; kimi `~/.kimi/sessions/<md5(cwd)>/<id>/` dir; pi/gemini/codex/minimax/cmd → null+reason), `recordArtifactPath` (records only if exists + not a symlink + realpath under the provider store root), `collectRecordedArtifacts`, `collectNonPurgeableSessions`, `planPurge` (re-validates lstat/realpath/basename), `executePurge` (dry-run default; deletes only with `--confirm`).
- new `polycli sessions [list | purge --confirm]` command + `plugins/polycli/commands/sessions.md`, registered across all host surfaces (`validate-host-command-map` + `docs/host-command-map` + Codex/Copilot skills + OpenCode index): 12 capabilities. Deletion is driven ONLY by recorded + re-validated realpaths — never path-guessing or globbing. Non-purgeable tracked sessions (gemini per-project dir, pi timestamp-prefixed filenames, ephemeral providers) are reported with a reason, never silently dropped.

**Q8a/Q8b/Q8c — provider-drift maintenance hardening** (root cause: ecosystem heterogeneity + duplication + version-pinned fixtures giving false confidence):
- **Q8a** `scripts/check-fixture-freshness.mjs` (NEW; `npm run check:fixture-freshness`): warns when a fixture's pinned CLI version ≠ the locally-installed CLI (`-v`/`-V`/`--version` per provider), skips absent CLIs, exit 0 default / `--strict` non-zero on real staleness. On this machine all 16 fixtures are STALE (real upstream drift, e.g. claude 2.1.117→2.1.156, gemini 0.38.2→0.43.0) — exactly the silent false-confidence this catches.
- **Q8b** single frozen `REVIEW_FLAG_EXPECTATIONS` map (`packages/polycli-runtime/src/review-flags.js`, NEW) is the sole declaration of each provider's drift `expectFlags`/`forbidFlags`/`probes`, read-only option key/value, and exact `extraArgTokens`. `check-review-cli-drift.mjs` derives its CHECKS from it; `review.mjs` sources read-only keys from it; a consistency test asserts `extraArgTokens` EXACTLY equals the `--`flags `REVIEW_HARD_CONSTRAINTS` emits (catches a token ADDED or REMOVED — the original subset check missed gemini/kimi entirely). Data co-location, NOT a `BaseProvider` (non-goal #1 intact).
- **Q8c** `check:review-drift` wired into `release:check` (self-skips absent CLIs; blocks a release only on genuine flag drift) + a LOCAL regex-anchor sanity check reading the `GEMINI_EXPLICIT_AUTH_ERROR_RE`/`KIMI_EXPLICIT_AUTH_ERROR_RE` source (guards a polycli-side refactor from dropping the `invalid api key` anchor; does NOT detect upstream wording — a real upstream auth-wording probe stays an open follow-up).

Verification: `npm test` 453/453 (from 399); `npm run release:check` exit 0 (5 bundles byte-identical; fixture metadata 16; host-map 12 capabilities; codex-adapter; no CLI drift; npm pack/publish dry-runs). Deferred to roadmap, NOT shipped: **Q8d** (migrate churn-heavy providers to JSON/SDK — multi-release) and **Q9c** (opt-in env session isolation — a naive HOME/XDG override breaks auth + `--resume`; needs per-provider design).

## 2026-05-27 — Claude — v0.6.18 agy provider review fixes

- Ran 5 review rounds on the agy provider (`a836fa1..HEAD`). Fixed the confirmed and clearly-actionable findings:
  - **No fabricated session id (headline):** `agy.js` no longer feeds `result.stdout` to `resolveSessionId`. agy stdout is pure assistant prose, so the UUID scan would capture any UUID in an answer (e.g. "give me a uuid") as a fake `sessionId`, violating the spec ("sessionId always null / do not fabricate") and suppressing `buildTimingMeta`'s `sessionIdMissing:true`. `sessionId` is now hard-`null` on both sync and streaming paths; dropped the unused `resolveSessionId` import.
  - **Hardened auth probe:** `buildAgyAuthStatus` now inspects combined `error`+`response` text (catches a logged-out agy that prints sign-in guidance to stdout and exits 0 → `loggedIn:false`) and treats a clean `status:0` with no auth signal as authenticated even when the probe produced no visible text (fixes the empty-output false-negative where the `hasVisibleText` gate leaked into auth classification). Transient→inconclusive-authenticated behavior preserved.
  - **Review hints corrected:** removed `agy` from the `--provider` argument-hint in `commands/review.md` and `commands/adversarial-review.md`; the runtime rejects agy review (host-command-map already marked it unsupported), so the hints no longer advertise an unsupported choice.
  - **Drift watcher actually watches:** `check-review-cli-drift.mjs` agy row had `expect:[]`, a no-op that could only detect *expected* flags disappearing — never a *new* plan flag appearing, which is the row's whole purpose. Added a `forbid` list (`--approval-mode`/`--permission-mode`/`--policy`/`--plan`/`--agent`); the checker now reports DRIFT if any appear so /review support can be re-evaluated.
  - **Tests:** added 5 agy regression cases (UUID-in-output→null sessionId; empty-output→no_visible_text; authed-empty→loggedIn; logged-out-to-stdout-exit0→loggedOut; streaming non-zero→auth failure).
- Verification: `node --test packages/polycli-runtime/test/agy.test.js` exit 0 (18/18); `npm test` exit 0 (399/399, up from 392); `npm run release:check` exit 0; `node scripts/check-review-cli-drift.mjs` runs clean (`[ ok ] agy`); all 5 companion bundles rebuilt and byte-identical (validatePluginBundles green). Published: tag `v0.6.18`, GitHub release, npm `@bbingz/polycli-opencode@0.6.18` and `@bbingz/polycli@0.6.18` (both `latest`, verified via `npm view`).
- Deferred (not fixed, with rationale): signal-kill `status:null→0` misclassification is a repo-wide `runCommand` pattern (all providers) — fix cross-cutting, not agy-only; stdout banner/notice pollution of response+ttft and the internal-`--print-timeout`-beats-outer-timeout classification both depend on agy's actual print-mode output shape, which upstream has not been verified; response-vs-events blank-line divergence only affects preview events (compacted away). The v0.6.16 release notes' `--add-dir`/`--sandbox` mention describes runtime params with no companion CLI surface (historical, left as-is). `validate-codex-adapter` prompts≤3/≤128 is an intentional Codex limit, not a bug.

---

## 2026-05-25 — Codex — v0.6.17 Codex manifest prompt-limit patch

- Fixed the Codex host manifest noise found in `codex-tui.log`: `plugins/polycli-codex/.codex-plugin/plugin.json` had 4 `interface.defaultPrompt` entries, while Codex currently supports a maximum of 3. The manifest now keeps health, ask, review, and timing coverage in 3 supported prompt entries.
- Hardened `scripts/validate-codex-adapter.mjs` so release validation rejects more than 3 Codex default prompts and rejects any default prompt entry over 128 characters. Added focused regression tests for both limits.
- Verification before release prep: `node --test scripts/tests/validate-codex-adapter.test.mjs` exit 0 (4/4); `node scripts/validate-codex-adapter.mjs` exit 0; `node --test scripts/tests/*.test.mjs` exit 0 (45/45). Release verification: `npm run release:check` exit 0 (394/394 tests; bundles 5; fixtures 16; manifests 0.6.17; host-map 11x4+terminal; codex-adapter 5; claude plugin validate ×2; npm dry-runs/pack checks passed). Post-publish: tag `v0.6.17`, GitHub release (not draft, not prerelease), and both npm packages observable at 0.6.17 (`@bbingz/polycli-opencode@0.6.17` at 2026-05-25T12:01:21Z, `@bbingz/polycli@0.6.17` at 2026-05-25T12:01:32Z).

---

## 2026-05-20 — Claude+Codex — add agy (Google Antigravity CLI 1.0.0) provider

- Added `agy` as the tenth polycli-managed provider CLI. Adapter mirrors the text-only `cmd` pattern with claude-style session flags (`--continue`/`--conversation <id>`/`--add-dir`/`--sandbox`) and YOLO via `--dangerously-skip-permissions`. agy emits plain stdout (no JSON envelope, no session id, no model field); the adapter honors the four-state timing semantics by returning `null` model and the resolver's `null` sessionId rather than fabricating values.
- TIMING_SUPPORT: `ttft/gen/tail` true (line-buffered stdout), `tool` false, `runtimePersistence: "session"`. The session id is always missing, so `buildTimingMeta` will correctly stamp `sessionIdMissing: true` on every agy run — honest, not folded into `unsupported`.
- `/review --provider agy` is rejected upfront via a new `REVIEW_UNSUPPORTED_PROVIDERS` set and `assertReviewProviderSupported` in `plugins/polycli/scripts/lib/review.mjs`. Rationale: agy has no plan-mode / approval-mode flag, so the review hard constraint cannot enforce read-only execution. Drift watcher (`scripts/check-review-cli-drift.mjs`) carries the agy row with `expect: []` so future plan-mode additions are picked up.
- ask/rescue auto-YOLO for agy (matches the `project_yolo_standard.md` rule), provider listings in companion dispatcher / Claude commands / Codex+Copilot skills / README SVG header updated from "nine providers" to "ten providers".
- Verification: `node --test packages/polycli-runtime/test/agy.test.js` exit 0 (13/13); `npm test` exit 0 (392/392, up from 374); `npm run check:provider-paths` exit 0 (8 ok + agy ok + pi skipped on local timeout); `npm run release:check` exit 0 (bundles 5; fixtures 16; manifests 0.6.16; host-map 11x4+terminal; codex-adapter 5; claude plugin validate ×2; npm pack/publish dry-runs passed). agy itself reviewed commit `a836fa1` and returned `VERDICT: PASS` against four-state-timing / YOLO / Path B / review-refusal / plain-text-stdout invariants. Post-publish: tag `v0.6.16`, GitHub release (not draft, not prerelease), and both npm packages observable at 0.6.16 (`@bbingz/polycli-opencode@0.6.16` at 2026-05-20T14:44:18Z, `@bbingz/polycli@0.6.16` at 2026-05-20T14:44:33Z).

---

## 2026-05-10 — Codex — v0.6.15 observability and provider failure classification

- Fixed the observability split found after several days of real polycli use: `POLYCLI_STATE_ROOT` now overrides `CLAUDE_PLUGIN_DATA/state`, `timing --all` / `--history all` can read full history, and `timing --json` reports store metadata (`stateRoot`, `stateRootSource`, workspace slug/root, history limit, record count).
- Extended timing records with outcome diagnostics (`outcome`, `exitCode`, `terminationReason`, `responseMatched`, `errorCode`) so aggregates no longer mix successful health/ask runs with provider failures without explanation.
- Added run-ledger failure classification and explanation output for failed attempts, including structured counts for qwen max-session-turns, timeouts, terminated/cancelled runs, missing binaries, auth failures, and no-visible-text failures.
- Hardened provider adapters around observed failure modes: qwen max-session-turns becomes `qwen_max_session_turns`, kimi resume footer exits with visible assistant text no longer fail, and qwen/kimi/opencode/cmd attach `errorCode` classifications used by timing and ledger.
- Updated README/release docs and bumped host/terminal release manifests to `0.6.15`; regenerated all five companion bundles.
- Verification: focused TDD red/green slices for timing, run-ledger, qwen/kimi/opencode/cmd, plus `npm test` exit 0 (374/374 tests) and `npm run release:check` exit 0 (full tests, bundle/fixture/manifest/host-map/Codex adapter checks, Claude plugin validation, npm dry-run/pack checks).

## 2026-05-07 — Codex — v0.6.14 post-publish host update closeout

- Confirmed npm `@bbingz/polycli-opencode@0.6.14` and `@bbingz/polycli@0.6.14` are observable on the registry, then updated the GitHub release notes and release docs from "pending npm auth" to published.
- Verified Codex marketplace refresh behavior: `codex plugin marketplace add bbingz/polycli` is idempotent and does not refresh an existing local cache; use `codex plugin marketplace upgrade polycli-hosts` to pull the latest marketplace revision. Local Codex marketplace cache now points at `6e550b3` and `polycli-codex@0.6.14`.
- Committed and pushed the post-publish docs closeout as `6e550b3 docs: mark v0.6.14 npm packages published`.

## 2026-05-07 — Codex — v0.6.14 provider path and stateless call hardening

- Recorded the current best-provider path table in `docs/provider-paths.md`, including the corrected OpenCode finding: local auth/model discovery is the source of truth, so an empty `opencode.json` provider object does not mean OpenCode has no configured providers.
- Hardened prompt/review defaults away from broad YOLO for stateless calls: qwen ask is now bounded at 20 turns with plan mode and tool exclusion instead of the failing one-turn cap; Claude uses no-tools plus empty strict MCP config; Gemini/OpenCode/Pi/Kimi/Cmd/Copilot get conservative provider-specific ask constraints.
- Kept Copilot as a fallback provider but removed allow-all tool/path/url defaults for ask/review.
- Replaced MiniMax `mini-agent` log scraping with official `mmx-cli` text-chat JSON non-interactive invocation and updated tests/docs/skills around the new path.
- Verification: `npm run check:provider-paths` exit 0 with local `mmx` 1.0.12 included in the drift probe; live `polycli ask --provider minimax` smoke returned `ok: true`; `release:check` exit 0 (367/367 tests; bundles 5; fixtures 16; manifests 0.6.14; host-map 11x4+terminal; codex-adapter 5; claude plugin validate ×2; npm dry-runs/pack checks passed). Post-publish: tag, GitHub release (not draft, not prerelease), and both npm packages observable at 0.6.14.

## 2026-05-07 — Claude — v0.6.13 released

- Published artifacts: GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.13, npm `@bbingz/polycli-opencode@0.6.13`, npm `@bbingz/polycli@0.6.13`. Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.
- Default `GEMINI_CLI_TRUST_WORKSPACE=true` for every gemini spawn. gemini-cli prompts on first run in a new workspace for trust; under polycli's non-interactive ask/rescue/review pipeline that prompt has nowhere to go and the call hangs/fails. New `buildGeminiEnv(parentEnv)` helper defaults the env var to `"true"` but preserves any caller-set value (`GEMINI_CLI_TRUST_WORKSPACE=false ./script.sh` still wins). Consistent with the v0.6.12 YOLO stance: workspace trust is one more interactive prompt that polycli auto-approves.
- Verification: `release:check` exit 0 (366/366 tests; bundles 5; fixtures 16; manifests 0.6.13; host-map 11x4+terminal; codex-adapter 5; claude plugin validate ×2; 4 npm pack/publish dry-runs). Post-publish: tag, GitHub release (not draft, not prerelease), and both npm packages observable at 0.6.13.

## 2026-05-07 — Claude — v0.6.12 released

- Published artifacts: GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.12, npm `@bbingz/polycli-opencode@0.6.12`, npm `@bbingz/polycli@0.6.12`. Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.
- Standardize `ask`/`rescue` permission default to YOLO across all 9 providers. Path B principle: surface real provider capabilities, don't fake uniformity by mixing tiers across providers. Until v0.6.11 polycli's permission stance was an asymmetric mix (copilot/opencode already YOLO; claude `acceptEdits`; qwen `auto-edit`; gemini `plan`; kimi/cmd no flag at all; pi/mini-agent no permission gate). v0.6.12 makes every provider that has a YOLO-equivalent flag pass it by default: claude `--permission-mode bypassPermissions`, gemini `--approval-mode yolo`, qwen `--approval-mode yolo` (also dropped legacy `unsafeFlag`/`background` guard), kimi `--yolo`, cmd `--yolo`. Callers can opt out via runtime parameters (`permissionMode`, `approvalMode`, `yolo`, `skipPermissions`). Documented as part of the v1 public surface.
- `review` / `adversarial-review` remain locked to conservative / read-only / plan mode regardless of the new YOLO defaults: review override now adds `permissionMode: "plan"` for claude, `approvalMode: "plan"` for qwen (matching the existing gemini override), `yolo: false` for kimi and cmd. `assertNoReviewConstraintOverride` extended to refuse downstream callers re-introducing those YOLO flags into a review invocation.
- Verification: `release:check` exit 0 (364/364 tests; bundles 5; fixtures 16; manifests 0.6.12; host-map 11x4+terminal; codex-adapter 5; claude plugin validate ×2; 4 npm pack/publish dry-runs). Post-publish: tag, GitHub release (not draft, not prerelease), and both npm packages observable at 0.6.12.

## 2026-05-07 — Claude — v0.6.11 released

- Published artifacts: GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.11, npm `@bbingz/polycli-opencode@0.6.11`, npm `@bbingz/polycli@0.6.11`. Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.
- Drop the unilateral 200 KB diff cap on `review`/`adversarial-review`: `DEFAULT_MAX_DIFF_BYTES` flipped from `200_000` to `null`. With provider context windows now routinely 1M-2M tokens, the hardcoded cap was an artificial cost ceiling that contradicted the Path B "no fake unification" stance. By default the full git diff goes to the provider; callers can still opt into truncation by passing a positive numeric `maxDiffBytes` to `collectReviewContext` or `--max-diff-bytes <n>` on the wrapper.
- Add `--max-diff-bytes <n>` CLI flag on `review` and `adversarial-review` (validated like `--history`; `invalid_max_diff_bytes` structured error code on bad input). Help text, public-surface doc, host-plugin command files (`commands/review.md`, `commands/adversarial-review.md`), and codex/copilot SKILL grammar updated to surface the flag.
- Verification: `release:check` exit 0 (362/362 tests; bundles 5; fixtures 16; manifests 0.6.11; host-map 11x4+terminal; codex-adapter 5; claude plugin validate ×2; 4 npm pack/publish dry-runs). Post-publish: tag, GitHub release (not draft, not prerelease), and both npm packages observable at 0.6.11.

## 2026-05-07 — Claude — v0.6.10 released

- Published artifacts: GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.10, npm `@bbingz/polycli-opencode@0.6.10`, npm `@bbingz/polycli@0.6.10`. Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.
- Pi probe fixes: `DEFAULT_PI_MODEL` was a hardcoded `"openai-codex/gpt-5.4"` always injected into the pi command line via `buildPiInvocation`, breaking probes for any user whose pi was authenticated against a different backend (Xiaomi etc.) — set to `null` so pi auto-routes to its configured backend. `parsePiStreamText` now extracts `event.message.errorMessage` and `event.message.stopReason==="error"` into a new `providerError` field; `runPiPrompt`/`runPiPromptStreaming` surface that as `result.error` instead of the generic `"pi produced no visible text"`. `event.message.model` added to the model extraction paths so reporting reflects the model pi actually used (e.g. `mimo-v2.5-pro`).
- Live verification before publish: `node packages/polycli-terminal/bin/polycli.mjs health --provider pi --json` against a Xiaomi-backed pi flips from `ok=false, model="openai-codex/gpt-5.4", error="pi produced no visible text"` to `ok=true, model="mimo-v2.5-pro", error=null`.
- Verification: `release:check` exit 0 (359/359 tests; bundles 5; fixtures 16; manifests 0.6.10; host-map 11x4+terminal; codex-adapter 5; claude plugin validate ×2; 4 npm pack/publish dry-runs). Post-publish: tag, GitHub release (not draft, not prerelease), and both npm packages observable at 0.6.10; `@bbingz/polycli` bin still maps `bin/polycli.mjs`.

## 2026-05-07 — Claude — v0.6.9 released

- Published artifacts: GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.9, npm `@bbingz/polycli-opencode@0.6.9`, npm `@bbingz/polycli@0.6.9`. Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.
- Patch on top of v0.6.8 closing the post-Q6 hardening: dead-worker scan-on-read terminal event recovery in `debug runs/show/explain` (idempotent `attempt_result` + `provider_decision` append; `worker_exited` classification for no-envelope deaths), TUI log file pointer rendering (read-only — never reads or prints log contents), host-map guardrail extended to Terminal CLI cells / side-by-side examples / terminal-only `polycli tui` docs, and README command-surface drift cleanup across en/zh/ja so the front matter matches the v0.6.7 + v0.6.8 surface.
- Verification: `release:check` exit 0 (354/354 tests; bundles 5; fixtures 16; manifests 0.6.9; host-map 11x4+terminal; codex-adapter 5; claude plugin validate ×2; 4 npm pack/publish dry-runs). Post-publish: tag, GitHub release (not draft, not prerelease), and both npm packages observable at 0.6.9; `@bbingz/polycli` bin still maps `bin/polycli.mjs`.

## 2026-05-07 — Codex — memory and Claude handoff closeout

- Added project memory for the Q6 terminal CLI/TUI observability track, including v0.6.7/v0.6.8 shipped surfaces, post-v0.6.8 hardening, and the next `v0.6.9` release-prep handoff.
- Added and pushed `docs/superpowers/plans/2026-05-07-claude-remaining-work-handoff.md` so Claude can fully take over remaining P0/P1/P2 work without reopening completed Q6 implementation scope.

## 2026-05-07 — Codex — Q6 phase 5-7 hardening closeout

- Added scan-on-read dead-worker recovery for background runs with residual `runContext`; `debug runs/show/explain` refresh job state before reading the ledger and append missing terminal `attempt_result` / `provider_decision` events idempotently.
- Added TUI rendering for local job `logFile` pointers without reading or printing log contents.
- Tightened host-map validation so Terminal CLI command cells, side-by-side examples, and terminal-only `polycli tui` documentation stay in sync.
- Updated README variants, roadmap, release docs, v0.6.8 notes, and Q6 task state to reflect the shipped `@bbingz/polycli` terminal package, TUI inspector, and completed post-v0.6.8 hardening.

## 2026-05-07 — Claude — v0.6.8 released

- Published artifacts: GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.8, npm `@bbingz/polycli-opencode@0.6.8`, npm `@bbingz/polycli@0.6.8`. Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`).
- Includes Q6 Spec 2 — background-job ledger plumbing (`runContext` persisted into per-job config; parent writes `job_started`; `_job-worker` writes `attempt_started` / `attempt_result` / `provider_decision` against the originating `runId`; worker-observed cancellation produces `attempt_result status=cancelled` + `provider_decision status=cancelled reason=job_cancelled`).
- Includes Q6 Spec 3 — read-only `polycli tui` inspector (terminal-only; navigation `up`/`down`/`k`/`j` + `enter`/`b` + `tab` + `?` + `r` refresh + `q` quit; renders `started` / `attempt_started` events without a terminal result as `unfinished` / `unknown`; `--history <count>` validated and applied; raw-mode try/finally with idempotent restore).
- Real-pty `q`-exit fix: explicit `process.stdin.resume()` after `setRawMode(true)` plus `process.stdin.pause()` in `restoreRawMode()`. Previously, in some real-PTY sessions the `q` keypress never reached the handler and only Ctrl-C escaped (with exit 1).
- Run-ledger debug examples doc surface (`docs/polycli-v1-public-surface.md`) walks through the original Q6 narrative (`cmd` health passed but two `ask` attempts failed → not adopted; `pi` health failed → skipped before prompt-bearing work) using `polycli debug runs / show / explain`.

## 2026-05-07 — Claude — v0.6.8 release prep (manifests + notes; not published)

- Bumped 7 release manifests from `0.6.7` to `0.6.8` (9 occurrences): `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `plugins/polycli/.claude-plugin/plugin.json`, `plugins/polycli-codex/.codex-plugin/plugin.json`, `plugins/polycli-copilot/plugin.json`, `plugins/polycli-opencode/package.json`, `packages/polycli-terminal/package.json`. Utility packages unchanged on independent v1.x cadence.
- Added `docs/release-notes-v0.6.8.md` covering Q6 Spec 2 (background-job ledger plumbing) + Q6 Spec 3 (read-only TUI inspector MVP) + run-ledger debug examples.
- Updated `docs/release.md` Current Release State to "prepared for v0.6.8" (last published release still `v0.6.7`); updated `docs/roadmap.md` snapshot + Current state to mention prepared-but-not-published status.
- Recorded automated TUI smoke results in the release notes (script-keys + non-TTY error path against the real wrapper binary). Real-TTY items (`q` quits + raw-mode restoration, interactive `r` refresh) explicitly listed as still-needed user-side smoke before tagging.
- Local `npm test` 348/348, `release:check` exit 0 (bundles 5 / fixtures 16 / manifests 0.6.8 / host-map 11×4 / codex-adapter 5 / claude plugin validate ×2 / 4 npm pack dry-runs). No tag, no GitHub release, no npm publish in this slice.

## 2026-05-07 — Claude — TUI inspector MVP

- Added terminal-only `polycli tui` as a read-only inspector over existing debug/run-ledger data.
- Renders run list, provider states, event timeline, detail/reproduction command panel, and explicit `unfinished` / `unknown` states for non-terminal background jobs.
- New view-model layer (`packages/polycli-terminal/lib/tui/view-model.mjs`): pure `classifyProviderStates` / `formatReproductionCommand` / `truncateMiddle` / `buildTuiModel` / `renderTuiFrame` so behavior is testable without a real TTY.
- New runtime (`packages/polycli-terminal/bin/polycli-tui.mjs`): interactive `q` / `r` keypress loop over `process.stdin` raw mode plus a `--smoke --fixture-dir <dir>` mode for one-frame snapshots used by tests.
- Terminal wrapper now routes `polycli tui` to the TUI runtime; all other commands still delegate to the bundled companion. `POLYCLI_HOST_SURFACE` defaults to `terminal` for both targets.
- Packaging: `packages/polycli-terminal/package.json` now ships `bin/polycli-tui.mjs` and `lib/**/*.mjs`; new packaging test asserts `bin/polycli-tui.mjs` and `lib/tui/view-model.mjs` are in the published tarball.
- Docs: terminal README adds a TUI section, host command map adds a terminal-only `polycli tui` note (no host plugin slash command), public-surface doc adds a `polycli tui` entry.
- No provider execution, retry, cancel, daemon, watch mode, full log viewer, version bump, tag, or publish in this slice.

## 2026-05-07 — Codex — TUI inspector MVP spec/plan

- Added `docs/superpowers/specs/2026-05-07-tui-inspector-mvp-design.md` for a read-only terminal TUI inspector over existing `debug runs/show/explain` and run-ledger data.
- Added `docs/superpowers/plans/2026-05-07-tui-inspector-mvp.md` with a task-by-task implementation plan covering view-model tests, terminal runtime, wrapper routing, package files, docs, and release checks.
- Updated the Q6 roadmap wording to name the read-only TUI inspector MVP as the next implementation slice; no source change, no rebuild, no version bump, no tag, no publish.

## 2026-05-07 — Claude — docs: run ledger failure examples

- Added "Run ledger debug examples" section to `docs/polycli-v1-public-surface.md`, covering the original Q6 narrative: `cmd` health passed but two `ask` attempts failed (not adopted); `pi` health failed and was skipped before any prompt-bearing work. Examples use `polycli debug runs / show / explain` and reference event-schema slots, not invented live provider output.
- Closed the "Add docs examples for the concrete failure case" item in `tasks/terminal-cli-tui-observability.md`.
- Docs-only; no source change, no rebuild, no version bump, no tag, no publish.

## 2026-05-07 — Claude — background-job ledger plumbing (Q6 Spec 2)

- Parent process now persists a top-level `runContext` (runId / command / hostSurface / argv / jobId / provider / kind / model / defaultModel / logFile) into the per-job config when `--run-id` (or `POLYCLI_RUN_ID`) is in scope.
- After spawning the worker, the parent writes a `job_started` ledger event; no `provider_decision` from the parent.
- `_job-worker` reads `runContext`, writes `attempt_started` before the streaming call, and on completion writes `attempt_result` (status `completed` / `failed`) plus `provider_decision` (`adopted` on success, `failed reason=<kind>_failed` on not-ok). Worker-observed cancellation produces `attempt_result status=cancelled` + `provider_decision status=cancelled reason=job_cancelled`.
- Added shared `recordRunEventForContext(workspaceRoot, runContext, base)` writer; existing `recordRunEvent` delegates via `buildCurrentRunContext()`. Worker code never mutates the parent-side `RUN_CONTEXT` global.
- `createRunLedgerEvent` schema gains nullable `pid` / `durationMs` slots; foreground events round-trip with the existing fields and add `null` defaults for the new ones.
- Tests: 3 new background integration tests (success with `--run-id`, failed `cmd ask` without full prompt leakage, explicit `POLYCLI_HOST_SURFACE=codex-skill` propagation). All 61 plugin-level tests pass; full `npm test` and `npm run release:check` green.
- Killed-worker (`kill -9` after provider returns but before the ledger write) perfect recovery is open ledger-side hardening (reaper or scan-on-read step), not a TUI gate; the first TUI inspector can proceed and must render any `started` / `attempt_started` event without a terminal `attempt_result` / `provider_decision` as `unfinished` / `unknown`.
- No version bump, no tag, no publish — main only. Roadmap Q6 status updated; `tasks/terminal-cli-tui-observability.md` background-worker checkbox flipped.

## 2026-05-07 — Claude — v0.6.7 released (terminal CLI + run ledger)

- Shipped standalone terminal CLI `@bbingz/polycli` (PATH-callable wrapper around the bundled companion); first-time npm publish.
- Added shared `debug` companion vocabulary (`debug runs / show <run-id> / explain <run-id>`) surfaced through Claude / Codex / Copilot / OpenCode / terminal.
- Added redacted append-only run ledger (NDJSON per workspace) with stable `runId` / `workspaceSlug` / `hostSurface`; foreground `health`, `ask`, `rescue`, `review`, `adversarial-review` write `health_result` / `attempt_started` / `attempt_result` / `provider_decision` / `run_summary` events. Background-worker ledger plumbing is the next follow-up.
- Added global `--run-id <id>` (or `POLYCLI_RUN_ID`) to join multi-command flows under one ledger run; stripped before provider/positional parsing.
- Bundle / release guards now cover a fifth byte-identical companion bundle (`packages/polycli-terminal/bin/polycli-companion.bundle.mjs`) and assert the terminal tarball ships `LICENSE`.
- Published artifacts: GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.7, npm `@bbingz/polycli-opencode@0.6.7`, npm `@bbingz/polycli@0.6.7`. Utility packages remain on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`).

## 2026-05-06 — Codex — prepare v0.6.4 Codex install-surface correction

- Corrected the Codex adapter docs and manifest after real Codex TUI verification showed `/polycli-codex:polycli ...` is not a registered slash command.
- Documented the actual Codex flow: `codex plugin marketplace add bbingz/polycli`, then install `Polycli` from TUI `/plugins`, then start a new thread so the `polycli` skill appears.
- Reworked the Codex skill invocation guidance to resolve the plugin root from the installed `SKILL.md` path instead of requiring a manually exported `PLUGIN_ROOT`.
- Tightened `npm run validate:codex-adapter` and `npm run validate:host-map` so future releases reject fake Codex slash-command examples and require Codex skill examples for `health`, `ask`, `review`, and `timing`.
- Prepared release notes and host package metadata for `v0.6.4`; OpenCode package moves to `@bbingz/polycli-opencode@0.6.4`, while utils/timing stay on `1.0.1`.

## 2026-05-06 — Codex — prepare v0.6.3 Codex adapter operability patch

- Strengthened the `polycli-codex` manifest and skill so Codex is explicitly told to prefer `/polycli-codex:polycli ...` over direct official CLI shell calls for `claude`, `copilot`, `opencode`, `pi`, `gemini`, `kimi`, `qwen`, and `minimax`; raw shell is now documented as an explicit-user-intent or unavailable-plugin fallback only.
- Updated the root README, Codex plugin README, and host command map with Codex slash examples for `health`, `ask`, `review`, `status`, `result`, and `timing`, so daily examples no longer look like a generic shell command.
- Added `docs/codex-adapter-operability.md` as the routing, fallback, first-run, and observability contract for Codex sessions.
- Added `scripts/validate-codex-adapter.mjs`, `npm run validate:codex-adapter`, unit coverage, CI wiring, and `release:check` wiring so Codex provider triggers, fallback language, and health/status/result/timing guidance cannot drift silently.
- Prepared release notes and host package metadata for `v0.6.3`; OpenCode package moves to `@bbingz/polycli-opencode@0.6.3`, while utils/timing stay on `1.0.1`.

## 2026-05-02 — Claude — opencode added to timeout multiplier + multiway benchmark doc

Triggered by a second 5-round multiway run using **real HuggingFace dataset rows** (offsets 5/1000/130/400/0 from MMLU college_math / GSM8K / HumanEval/130 / TruthfulQA / BBH), as opposed to the first run which used benchmark-flavored re-creations.

**Multiplier extended to opencode:**

- `plugins/polycli/scripts/polycli-companion.mjs`: `PROVIDER_TIMEOUT_MULTIPLIERS.opencode = { "kimi-for-coding/k2p6": 2 }`. Same pattern as gemini — model-scoped, only the reasoning variant gets ×2; other opencode models stay at base.
- Trigger: HumanEval/130 (Tribonacci with awkward forward-reference recurrence) made opencode hit `timedOut: true, signal: "SIGTERM"` at exactly 120021 ms — the 120s `ask` ceiling. Verified post-fix that opencode background job timeout is 240000ms (gemini still 240000ms, qwen unchanged at 120000ms).
- `gemini-cli-runtime/SKILL.md` Latency expectations section updated to show the multiplier is a registry, not gemini-only — the same pattern can be extended as new reasoning model ids appear.

**Benchmark doc persisted:**

- `docs/benchmarks/multiway-validation-2026-05-02.md` captures: exact dataset offsets and prompt verbatim text, full result matrix for both rounds (40/40 easy + 37/40 hard), per-provider behavior notes (kimi misreads complex prompts, minimax reasons shallowly on puzzle-class, opencode is a code-reasoning model), and **3 grader bugs** that bit me during the run (`.strip()` ate Python indent, prefix-only negation regex missed kimi's "not because" answer, single-language regex misclassified claude's Chinese reply). The grader-lessons section is the durable artifact — future benchmark scripts should not repeat these.

**What we did NOT do:**

- Did not write a reusable benchmark grader utility module (`tasks/benchmark-grader.mjs` style). polycli is not a benchmark suite; persisting the lessons in a doc is sufficient.
- Did not extend the multiplier to other providers preemptively — opencode addition was driven by a real timeout observation, not speculation.

## 2026-05-02 — Claude — kimi/minimax model id fix + gemini multiplier stress test

Followups discovered during a 5-round 9-way validation (8 polycli providers + codex via subagent, prompts from MMLU / GSM8K / HumanEval / TruthfulQA / open-ended).

**Fix: kimi & minimax `model` field was null in ask result**

- `packages/polycli-runtime/src/kimi.js:347` and `:404` — fall back to `readKimiDefaultModel()` (already existed but was unused) when `parsed.model ?? model ?? defaultModel` is all null. Reads `~/.kimi/config.toml` `default_model` scalar.
- `packages/polycli-runtime/src/minimax.js:238` — fall back to `readMiniMaxConfig().model` (reads `~/.mini-agent/config/config.yaml`) under the same condition.
- Root cause: `cacheProviderModel` only writes when `result.model` is non-empty. kimi stream-json and mini-agent log don't carry a model id, so cache stayed empty, so subsequent runs got null `defaultModel`, so model stayed null. Chicken-and-egg. Direct config read breaks the loop.
- Verified post-fix: `kimi` returns `kimi-code/kimi-for-coding`, `minimax` returns `MiniMax-M2.7-highspeed`. Resolves the "null for kimi/mini-agent" caveat in `reference_default_model_extraction_caveats.md`.

**Stress test: gemini timeout multiplier**

Goal: prove the `gemini-3.1-pro-preview` ×2 multiplier was actually necessary, not just defensive.

| prompt class | gemini wall | gemini ttft | observation |
|---|---|---|---|
| Standard 5-round (MMLU / GSM8K / HumanEval / TruthfulQA / open-ended) | 7-22s | (mostly < total) | far below 120s base — multiplier irrelevant |
| GPQA-style physics reasoning + algebra (453 byte prompt, ask) | 55s | 44s | half the base 120s — comfortable headroom but base would have worked |
| Heavy structured output: 800-byte rate-limit design prompt (rescue) | 55s | 37s + 18s gen | far below 600s rescue base |

Result: under prompts I could construct, `gemini-3.1-pro-preview` peaks around 55s — never approaches even the 120s `ask` base, much less the 240s multiplier ceiling. The multiplier is defensive headroom for the original observation (user reported gemini "self-admitted long thinking time" on review of large diffs), not a tight fit. Documented this honestly: the multiplier provides safety margin for the worst case rather than reacting to a routine ceiling breach. No timeout tuning change.

**Side observations from the 5-round validation (no fixes needed, recorded for posterity):**

- All 9 entities (8 polycli + codex) returned correct answers on R1/R2/R4. Code-completion (R3) instruction-following varied: 7/8 polycli wrapped the function in markdown despite "no extra commentary" — only `minimax` and `codex` gave a true one-liner. This is upstream LLM behavior, not polycli routing.
- `claude` provider answered the English R4 prompt in Chinese because the user's global `CLAUDE.md` says "Always respond in Chinese". CLAUDE.md inheritance only reaches the `claude` provider; other providers respect prompt language. Documented in memory as expected behavior.
- 5 rounds × 8 providers wall time: 113s (parallel start per round, sequential rounds). Codex reference run (subagent `a48de540074220012`): all 5 prompts correct, 7-9s latency each.

## 2026-05-02 — Claude — multi-way self-review: 4 doc fixes + 1 verified bug + multiplier scope tightening

Ran a 4-way self-review where each provider audited polycli's claims about itself (`gemini` / `qwen` / `kimi` / `minimax` each reading their own `*-cli-runtime/SKILL.md`). Triaged findings into red (true defects, fix), yellow (LLM claims to verify against real CLIs), and green (engineering choices).

**Red — 4 doc defects fixed:**

- `minimax-cli-runtime/SKILL.md` P0.5: removed self-contradiction. Section claimed Layer 1/3 sentinels were "跨 locale 稳定" while the same paragraph noted OSError messages may be i18n'd by glibc. Reworded as "纯 ASCII 字面量, 未观察到 i18n" and clarified the i18n caveat is OS-layer (outside Mini-Agent's control).
- `minimax-cli-runtime/SKILL.md` P0.9: scoped the "0 次 `os.environ`" claim to first-party Mini-Agent code (excludes transitive deps like httpx / pydantic) and clarified the implication is auth-purpose only.
- `qwen-cli-runtime/SKILL.md`: documented `--unsafe` vs `--approval-mode` precedence with source-verified semantics. Initial draft said "--unsafe wins", but reading `buildQwenInvocation` in `packages/polycli-runtime/src/qwen.js:73-76` showed the opposite: an explicit `--approval-mode` wins; `--unsafe` is only a shortcut to `yolo` when `--approval-mode` is omitted. Background-mode `yolo` still requires `--unsafe` as an independent safety guard.
- `kimi-cli-runtime/SKILL.md`: "Auth ping" was misleading — `--max-steps-per-turn 1 + 30s` is a liveness probe (verifies binary launches and reaches the model) but does not validate token freshness. Renamed to "Liveness probe" and pointed to `setup --json` `authenticated` field for true auth state.

**Yellow — 6 claims verified against real CLIs (gemini 0.40.1, kimi 1.40.0, qwen 0.15.6):**

| # | Claim | Verdict |
|---|---|---|
| 5 | gemini `--write` → `--approval-mode auto_edit` | ✅ help confirms `auto_edit` is a valid enum |
| 6 | kimi `-V` and `-v` flags | ⚠️ partially wrong — `-V` and `--version` both work, but `-v` returns a click usage error in 1.40.0+, not verbose. Doc updated. |
| 7 | kimi stream-json `role` set | ✅ live probe shows only `assistant` (kimi's self-claim of "user/system" was a hallucination) |
| 8 | kimi `--approval-mode` acceptance | ✅ kimi 1.40 has no `--approval-mode` (only `--yolo`/`--plan`/`--afk`/`--print`); doc was correct |
| 9 | `--print` ≈ `--yolo` | ✅ `kimi --help` 1.40 says "Print mode auto-dismisses AskUserQuestion and auto-approves tool calls"; doc was correct |
| 10 | kimi auth paths | ✅ subcommand list is `login/logout/term/acp/info/export/mcp/plugin/vis/web` — no API-key/SSO subcommands; doc was correct |

Net: kimi's self-review hallucinated 5 of 6 — LLMs are unreliable narrators about their own CLI surfaces. Real probes are necessary. Only Q6 produced a doc edit (`-v` wording in `kimi-cli-runtime/SKILL.md` lines 36 and 97).

**Green — multiplier tightened to model scope:**

- Refactored `PROVIDER_TIMEOUT_MULTIPLIERS = { gemini: 2 }` → `{ gemini: { "gemini-3.1-pro-preview": 2 } }`. Refactored `resolveTimeoutMs` signature to `(provider, kind, { model, defaultModel })`. Resolution: explicit `--model` wins; falls back to cached upstream-default model only if caller did not pass one. So `--model gemini-flash-2.5` stays at base 120s/600s/300s even though the cached default is a reasoning model — addresses gemini self-review's complaint that the multiplier was over-broad.
- `gemini-cli-runtime/SKILL.md`: Latency expectations rewritten with explicit resolution rules and a note that adding new reasoning model ids (when upstream releases them) is the maintenance path — do not blanket-multiply the whole provider.
- `qwen-cli-runtime/SKILL.md`: Safety rule "If Bash call fails, return nothing" gets a Rationale clarifying this is a forwarder contract — the companion already encodes failure in `error`/exit code, the subagent re-emitting prose would only duplicate or paraphrase. (Addresses qwen self-review #2.)

**Side check — mini-agent upstream:** verified via GitHub API (`/repos/MiniMax-AI/Mini-Agent`): no releases, no tags, latest commit `d76a4f63` 2026-02-14 (cosmetic fix). Still 0.1.0; minimax self-review's hint about "possibly newer version" was unsupported. Memory entry stays accurate.

## 2026-05-02 — Claude — README clarifies polycli is an in-host plugin, not a shell binary

- Triggered by a real Codex session that grepped the user's `PATH` directories for a `polycli` binary, found nothing, concluded "polycli has no callable entry point", and fell back to invoking `qwen` directly — defeating the routing purpose of polycli. Codex-rescue review (agent `afee5f7a594387551`) confirmed the misleading signals: hero SVG showed `$ polycli health --json` (shell prompt), and README L25/L36/L108 used cross-host vocabulary phrasing that read as if `polycli` were a portable shell command.
- `docs/assets/readme-header.svg:54`: `$ polycli health --json` → `/polycli:health --json`. Removes the shell-prompt visual cue from the first thing every reader sees.
- `README.md` "What is polycli?" gets a callout: polycli is an in-host plugin, no `polycli` binary on `PATH`, each host adapter exposes the same vocabulary in its own invocation style. Quick-start Copilot row annotated as "skill word — NOT a PATH binary; only inside the copilot prompt" so that line cannot be screenshot-grepped out of context.
- `README.md` adds **`## Outside a supported host`** section listing three honest options for non-Claude-Code/Codex/Copilot/OpenCode agents: (1) install the host adapter for the environment, (2) call the underlying provider CLI directly with explicit trade-offs, (3) escape hatch — `PLUGIN_ROOT=... node scripts/polycli-companion.bundle.mjs ...` marked unstable and internal. Verified against `plugins/polycli-codex/skills/polycli/SKILL.md:11` (uses `${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}`).
- `README.zh-CN.md` and `README.ja.md` get the in-host callout + Quick-start row clarification, but link back to the English `Outside a supported host` section instead of duplicating the full block (translation drift > terse cross-link).
- Docs only — no code, no test changes.

## 2026-05-02 — Claude — gemini timeout multiplier + latency documentation

- `plugins/polycli/scripts/polycli-companion.mjs` introduces `PROVIDER_TIMEOUT_MULTIPLIERS = { gemini: 2 }` and a `resolveTimeoutMs(provider, kind)` helper. Applied to the two prompt-execution code paths (`parsePromptExecution` for ask/rescue, `runReview` for review/adversarial-review). `health` retains the universal 60s budget — gemini's health probe is sentinel-only and does not exercise reasoning.
- Effective ceilings for gemini: `ask` 240s (was 120s), `rescue` 1200s (was 600s), `review` / `adversarial-review` 600s (was 300s). All other providers unchanged.
- Motivation: gemini is a deep-reasoning model that routinely spends 30s–several minutes thinking before emitting visible text (live observation across 2026-04-29 bench + this session: rescue PONG took 44.7s vs qwen 2.9s on identical prompt). Hard-coded 300s `review` ceiling was the closest one to silently masquerade as "polycli broken".
- `plugins/polycli/skills/gemini-cli-runtime/SKILL.md` adds a `## Latency expectations` section explaining the multiplier, listing the new vs old ceilings per kind, and recommending `--background` + `/polycli:status` polling for prompts of unknown duration. Subcommand table updated to reflect the gemini-specific timeouts.
- Background worker (`runJobWorker`) reuses `execution.timeout`, so the multiplier propagates to background jobs as well — no separate code path needed.

## 2026-05-02 — Claude — fix stale `task` subcommand references in 4 cli-runtime SKILLs

- `plugins/polycli/skills/{qwen,gemini,kimi,minimax}-cli-runtime/SKILL.md` referenced a `task` companion subcommand that does not exist on the unified surface (companion exposes `setup`, `health`, `ask`, `rescue`, `review`, `adversarial-review`, `status`, `result`, `cancel`, `timing`). The references were inherited verbatim from the legacy `*-plugin-cc` repos in R8c (commit 193078f) where each plugin had its own companion with a `task` command; on the unified surface that role split into `ask` (120s, one-shot) and `rescue` (600s, multi-step). A `polycli:polycli-provider-agent` subagent that read the SKILL literally would have invoked `task` and crashed with `Unknown subcommand 'task'.`
- Same edit also dropped non-existent `task-resume-candidate` (resumable state lives behind `--resume-last`) and the legacy `write-key` helper from minimax (no longer on the unified surface).
- End-to-end smoke: `polycli-companion.bundle.mjs rescue --provider qwen` returns `ok=true`, `kind=rescue`, response present (real qwen-cli 0.15.6, qwen3.6-plus). `ask --provider qwen` already worked.
- Docs only — no companion / runtime / bundle changes.

## 2026-04-30 — Claude — landscape check + daily watcher for official LLM-provider plugins

- Verified `openai/codex-plugin-cc` (the only LLM-provider-official Claude Code plugin) is at v1.0.4 / `807e03a` and matches the locally installed marketplace clone — no upstream updates since 2026-04-18.
- Surveyed 25+ AI-provider GitHub orgs, the `*-plugin-cc` naming convention, and Anthropic's `claude-plugins-official` (171) + `claude-plugins-community` (1921) marketplaces. Result: as of 2026-04-30, OpenAI is still the **only** LLM provider with an official Claude Code plugin. Google / xAI / Mistral / DeepSeek / Qwen / Kimi / MiniMax / Cohere / Meta / Groq / Zhipu / 01-ai / Perplexity / OpenRouter — all absent. Microsoft has platform skills (`skills-for-fabric`, `power-platform-skills`, `skills-for-copilot-studio`) but no LLM-provider bridge.
- Created daily-running remote routine `trig_01RLU5aqzYkuPFA8LMQKcnzo` (https://claude.ai/code/routines/trig_01RLU5aqzYkuPFA8LMQKcnzo) to watch this signal: 02:00 UTC every day, sonnet-4-6, scans the same orgs/marketplaces and is loud only when a new official provider plugin appears.
- No code changes in polycli itself.

## 2026-04-29 — Claude — capability matrix for workflows with no bare-shell equivalent

- Added `docs/benchmarks/capability-matrix.md` listing workflows where bare-shell has no meaningful equivalent: adversarial-review, background job control, session resume, stop-review-gate hook, 4-state timing, multi-host consistency (Claude Code / Codex / Copilot / OpenCode), provider `health` probe, probing-cost amortization. Companion to `bench-vs-bare-cli-spec.md`. These are presence/absence claims, not byte ratios — forcing them into a token comparison would be dishonest because there's nothing to compare against.
- README "Cost vs raw shell calls" section gets a one-line pointer to the capability matrix.
- Spec followup #3 (Path b disciplined-bare-shell) closed as **permanent deferral**: the (a) vs (c) data already gives a clear directional answer (69–98% reduction across cells, advantage from probing-cost amortization). Cost-benefit (Anthropic SDK dep + ~18 paid API calls per re-run) does not justify the refinement.

## 2026-04-29 — Claude — close CLAUDE.md inheritance investigation + small bench doc fixes

- Investigated the CLAUDE.md inheritance question raised in pilot (parent answered in Chinese, polycli claude in English on the same review task). **Not a bug.** CLAUDE.md inheritance works at the CLI layer (`claude -p`) and the polycli `ask` command — both respect the user's language preference. The English output observed in pilot came from `buildReviewPrompt` (`plugins/polycli/scripts/lib/review.mjs`), whose template is hardcoded English ("You are acting as <provider> inside polycli.", etc.); combined with the English diff payload, models default to English for `review`/`rescue`/`adversarial-review`. Treated as feature, not bug — multi-provider review benefits from a consistent prompt baseline. Spec followup updated.
- README: clarified "Bare-shell + probing" column meaning with a footnote pointing to `probing-cost.json`. The previous header could read as raw response bytes; clarification follows Codex review feedback.
- `docs/benchmarks/results-2026-04-29.md`: added a caveat noting that `qwen` `review` run #2 returned 1 byte at `exitCode: 0` (treated as success because exit code, not body, gates the bench's failure count). Median is unaffected; flagged for transparency.

## 2026-04-29 — Claude — add claude-prompting skill + bench path sanitization

- Added `plugins/polycli/skills/claude-prompting/SKILL.md`. Polycli previously had `gemini-prompting` / `kimi-prompting` / `qwen-prompting` / `minimax-prompting` but no per-provider prompt scaffolding for the `claude` provider. The new skill encodes claude-specific prompting guidance (CLAUDE.md does not propagate, same model family, stateless by default, error-surface notes).
- Hardened `scripts/bench-vs-bare-cli.mjs` with path sanitization: replaces `$HOME` with `~` in all stored stdout/stderr/parsedJson before writing results JSON. Earlier run leaked maintainer-local paths into `results-2026-04-29.json` because qwen rescue output hallucinated absolute paths under the bench cwd; `scripts/tests/open-source-hygiene.test.mjs` caught it.
- Re-sanitized the published `docs/benchmarks/results-2026-04-29.json` retroactively. `npm test` now passes 287/287.

## 2026-04-29 — Claude — first benchmark of polycli vs bare-shell CLI invocation

- Added `scripts/bench-vs-bare-cli.mjs`: N=3 live bench comparing path (a) `Bash(<provider> -p)` and path (c) `polycli-companion` for `gemini`/`qwen` × `ask`/`review`/`rescue`. Outputs `docs/benchmarks/results-<date>.{json,md}`.
- Collected `docs/benchmarks/probing-cost.json` (lower bound: `which` + `--help` only): gemini 3843 B, qwen 8077 B.
- Headline: with probing cost amortized, polycli reduces parent-context bytes by 69-98% across all six scenario × provider cells. Without probing cost, boundary bytes vary by cell with no consistent direction. polycli's token advantage comes from invocation-knowledge encapsulation, not output compression.
- Added README "Cost vs raw shell calls" section pointing at the results.
- Spec lifecycle (`tasks/bench-vs-bare-cli-spec.md`): two rounds of Codex sign-off, post-pilot amendment switching from fixture replay to live CLI calls (fixture replay was erasing probing cost), and a final Codex round-3 review that surfaced three blocks (missing `rescue` scenario, raw stdout not preserved for diagnosis, ±15% noise claim incorrect) — all fixed before publish.
- Path (b) disciplined-bare-shell deferred — needs Anthropic SDK to drive Claude programmatically; pilot data suggests (b) and (c) are close on boundary bytes.
- Followups noted in spec: add `claude-prompting` skill (no per-provider scaffolding for the `claude` provider in polycli today); investigate global CLAUDE.md inheritance into polycli subagent.

## 2026-04-29 — Codex — close post-release maintenance

- Merged all open Dependabot PRs after the v0.6.2 publication: `actions/setup-node` 4 -> 6, `actions/checkout` 4 -> 6, and `zod` 4.1.8 -> 4.3.6.
- Confirmed the public repo has no open PRs, `main` is clean at `fe4c6d6`, the latest release remains `v0.6.2`, and the published npm packages remain aligned with the release notes.
- Re-ran `npm test`, `npm run release:check`, and `npm audit --audit-level=moderate`; all passed, with 287/287 tests and 0 vulnerabilities.
- Confirmed GitHub Actions CI succeeded on the three post-release `main` push runs. GitHub social preview remains a repository settings UI upload using `docs/assets/social-preview.png`; GitHub CLI exposes no social preview image option.

## 2026-04-29 — Codex — finish v0.6.2 public release polish

- Added GitHub Actions CI, README release/OpenCode badges, and a social preview PNG derived from the README header SVG.
- Tightened public package metadata for `@bbingz/polycli-opencode`, `@bbingz/polycli-utils`, and `@bbingz/polycli-timing`.
- Replaced the long `release:check` shell command with `scripts/check-release.mjs`.
- Expanded open-source hygiene scanning to all tracked files and archived historical review/session docs under `docs/archive/`.

## 2026-04-29 — Codex — prepare v0.6.2 open-source hygiene patch

- Prepared host plugin manifests and OpenCode package for `0.6.2`; prepared `@bbingz/polycli-utils` and `@bbingz/polycli-timing` for `1.0.1`.
- Fixed the timing package tarball so `@bbingz/polycli-timing/schema` resolves to a packed `timing.schema.json`.
- Added package-local MIT `LICENSE` files for all public npm packages and open-source packaging tests that verify export targets and license inclusion from real `npm pack --dry-run --json` output.
- Removed the OpenCode adapter dependency on `@opencode-ai/plugin`, replacing it with a tiny local wrapper plus `zod`; `npm audit --audit-level=moderate` now reports 0 vulnerabilities.
- Scrubbed public fixtures and package AGENTS files of maintainer-local paths, host auth metadata, local memory metadata, and provider reasoning signatures; added a hygiene regression test for those patterns.
- Replaced the flaky wall-clock concurrency assertion in the health integration test with fake-provider start/end event overlap verification.
- `npm run release:check` passes end-to-end with 286/286 tests and publish dry-runs for `@bbingz/polycli-opencode@0.6.2`, `@bbingz/polycli-utils@1.0.1`, and `@bbingz/polycli-timing@1.0.1`.

## 2026-04-29 — Claude — v0.6.1 docs/legal patch shipped

- Bumped 6 manifest/package versions from `0.6.0` to `0.6.1`: `plugins/polycli-opencode/package.json`, `.claude-plugin/marketplace.json` (× 2 entries), `.github/plugin/marketplace.json` (× 2 entries), `plugins/polycli-codex/.codex-plugin/plugin.json`, `plugins/polycli/.claude-plugin/plugin.json`, `plugins/polycli-copilot/plugin.json`. `@bbingz/polycli-utils` and `@bbingz/polycli-timing` stay at `1.0.0` (no source changes).
- Drafted [`docs/release-notes-v0.6.1.md`](./docs/release-notes-v0.6.1.md) — docs/legal patch only: README rewrite + i18n (en/zh-CN/ja), root `LICENSE`, dead-absolute-path fix, latent fix specs filed in `tasks/`.
- Updated [`docs/release.md`](./docs/release.md) "Current Release State" to v0.6.1.

---

## 2026-04-29 — Claude — README rewrite + i18n + LICENSE

- Rewrote `README.md` from scratch as international-standard, English-default. Added clear hero pitch, "Why polycli" differentiation (4-state timing honesty, no fake unification, direct CLI passthrough), badges (npm version × 2, MIT license, Node ≥20), and a language switcher.
- Added translations: `README.zh-CN.md` (Simplified Chinese) and `README.ja.md` (Japanese). All three are full peers — not abbreviated versions. Technical terms (`runtime`, `streaming`, `session resume`, `Path B`, `monorepo`) kept in English by convention; Japanese version uses です・ます style.
- Added root `LICENSE` file (MIT, `Copyright (c) 2025 bbingz`) — the sub-packages already declared MIT, the root file was missing. GitHub `licenseInfo` was previously `null`; this fixes the License badge target and makes the project legally complete by community standards.
- Fixed dead links: previous README contained absolute paths like `/home/user/-Code-/polycli/...` that did not work on GitHub. All internal links are now repo-relative. Verified every referenced path exists.
- Restructured: hero → why → hosts/providers → install → quick start → core commands → capability matrix → timing semantics → packages → development → release → contributing → license. Old structure (Who This Is For, Background Jobs, Current Scope) removed or merged.

---

## 2026-04-29 — Claude — provider CLI upgrades + default-model audit

- Upgraded local provider CLIs to upstream latest: `copilot` 1.0.35 → 1.0.39, `kimi-cli` 1.37.0 → 1.40.0, `mini-agent` (git+main) refreshed to 2026-02-14 commit (deps: pydantic 2.13.2 → 2.13.3, uvicorn 0.44 → 0.46, sse-starlette 3.3 → 3.4). Five other CLIs (claude, gemini, qwen, opencode, pi) already at upstream latest.
- Verified kimi 1.40 and refreshed mini-agent stream-json compatibility via live probes. `kimi.test.js` 13/13 still pass; live `runKimiPromptStreaming` extracts response and sessionId correctly. mini-agent live probe parses 48 progress events, strips ANSI, extracts response.
- Ran 8-CLI default-model audit by spawning each provider with a "what model are you" prompt and reading polycli's `result.model`. Surfaced two latent bugs:
  - **`gemini.js:135`** takes `Object.keys(parsed.stats?.models ?? {})[0]` — first *attempted* model, not actually-used. Misleads when gemini-cli auto-falls-back from a 429-throttled preview (e.g. `gemini-3.1-pro-preview` → `gemini-2.5-pro` due to Google server-side preview capacity).
  - **`kimi.js:174`/`:264`** has `readKimiDefaultModel()` reading `~/.kimi/config.toml`, but it's only consumed by `getKimiAuthStatus`, never threaded into `runKimiPromptStreaming` / `runKimiPrompt` results — so `result.model` is null even when config has a default.
- Both fixes drafted as specs in `tasks/model-extraction-fixes.md` for Codex implementation. Non-breaking; target v0.6.x patch or v0.7.
- Memory: added `reference_cli_provider_versions.md` (per-CLI version-check + upgrade commands + gotchas), `reference_default_model_extraction_caveats.md` (which providers' `result.model` is unreliable and why), and `feedback_no_ask_for_nondestructive.md` (skip confirmation gates for sandboxed/read-only ops).

---

## 2026-04-24 — Claude — close R8 bookkeeping post-ship

- Relaxed the CLAUDE.md legacy-repo constraint to a permanent "allow grep, no edits" form (dropped the "R8 期间" conditional now that R8 is complete and R8g was cancelled).
- Updated `project_legacy_repos_reference.md` memory from "R8 convergence targets" to "permanent references; v0.6.0 absorbed their functionality".
- Added two new feedback memory entries: codex-rescue operational quirks (fire-and-forget wrapper, sandbox git-commit block, branch-name misreport) and release-ops gotchas (claude plugin validate Node 25 crash, npm 2FA TTY requirement).

---

## 2026-04-24 — Claude — v0.6.0 shipped

- Pushed `main` and tag `v0.6.0` (tag at `a95e3d8`).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.6.0 with notes from `docs/release-notes-v0.6.0.md`; no tarball asset attached (OpenCode users install from npm).
- Published `@bbingz/polycli-opencode@0.6.0` to npm; confirmed via `npm view @bbingz/polycli-opencode versions`.
- Closes roadmap R8a-R8f. R8g (legacy repo archival) deliberately skipped per user direction ("不用 archive"); four legacy plugin repos remain as read-only references on GitHub without archival status. `@bbingz/polycli-utils@1.0.0` and `@bbingz/polycli-timing@1.0.0` unchanged from v0.5.0; runtime stays private.

---

## 2026-04-24 — Claude — draft v0.6.0 release notes for R8 convergence

- Added `docs/release-notes-v0.6.0.md` covering R8a-R8e deliverables with a full legacy → polycli migration table (slash commands, kimi session flags, gemini approval/effort flags, subagent types, guidance skills, hooks).
- Flagged R8f as done; R8g (legacy repo archival + CLAUDE.md relaxation) still pending.
- Status: draft. Release date and version-bump execution held until user kicks off release prep.

---

## 2026-04-24 — Codex — port stop-time review gate hooks

- Added Claude Code SessionStart / SessionEnd / Stop hook registration for the polycli host plugin, with lifecycle state cleanup and the optional stop-review gate.
- Recorded the last-used ask/rescue provider in workspace state so the gate honors the user's current provider selection, with health-probe fallback when no provider is recorded.
- Added hook tests for lifecycle cleanup, multi-line ALLOW/BLOCK sentinel parsing, timeout skip behavior, and unresolvable-provider skip behavior.

---

## 2026-04-24 — Codex — add R8a/R8d unified flags

- Added Kimi-only `--resume-last` / `--resume <uuid>` / `--fresh` handling on `/polycli:ask` and `/polycli:rescue`, including wrapper-side session validation and resume-mismatch warnings.
- Added Gemini-only `--write` and `--effort low|medium|high` handling on the unified ask/rescue surface.
- Documented and tested unsupported-provider silent-drop notes for the new provider-specific flags.

---

## 2026-04-24 — Claude — open R8 legacy plugin convergence

- Reversed the prior non-goal "No migration of legacy sibling repos into this monorepo" after a capability gap audit against `gemini-plugin-cc` / `kimi-plugin-cc` / `qwen-plugin-cc` / `minimax-plugin-cc`.
- Added R8 to `docs/roadmap.md` with sub-items R8a–R8g: kimi session continuation; session-lifecycle + stop-time review gate hooks; per-provider guidance skills; rescue flag semantics; per-provider subagent types; namespace UX; legacy repo retirement.
- Updated `project_legacy_repos_reference.md` memory to flip the stance from "reference-only, never migrate" to "convergence targets under R8; grep-for-port OK, no edits."
- Narrowed the CLAUDE.md architecture-boundary constraint on legacy repos from "不要 grep、不要编辑" to "不要编辑; R8 期间允许 grep-for-port" (user-confirmed in same session).

---

## 2026-04-24 — Codex — v0.5.1 shipped

- Pushed `main` and tag `v0.5.1` (tag at `0b79c86`).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.5.1 with notes from `docs/release-notes-v0.5.1.md`; no tarball asset attached because OpenCode users install from npm.
- Published `@bbingz/polycli-opencode@0.5.1` to npm and confirmed it appears in `npm view @bbingz/polycli-opencode versions`.

---

## 2026-04-24 — Codex — prepare v0.5.1 release

- Bumped the four host plugin manifests and Claude/Copilot marketplace metadata from `0.5.0` to `0.5.1`.
- Drafted `docs/release-notes-v0.5.1.md` for the Q2/Q3 guardrail patch release.
- Release scope is host/plugin line only: publish `@bbingz/polycli-opencode@0.5.1`; keep utils/timing at `1.0.0` and runtime private.

---

## 2026-04-24 — Codex — close Q2 and Q3 with guardrails

- Closed Q2 by documenting the model fallback policy and adding a host integration test that proves cached setup model metadata is used only as the final `defaultModel` fallback when a provider stream omits model fields.
- Closed Q3 by accepting host-surface asymmetry as the durable design and adding `npm run validate:host-map` to keep `docs/host-command-map.md`, Claude commands, Codex/Copilot skills, OpenCode tools, and the companion dispatcher aligned.
- Refreshed `docs/roadmap.md` to mark R1-R7 and Q1-Q3 closed after v0.5.0.

---

## 2026-04-24 — Claude — v0.5.0 shipped

- Pushed `main` + tag `v0.5.0` (tag at 306c703 — R5 fixture replay pilot commit).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.5.0 (notes from `docs/release-notes-v0.5.0.md`).
- npm: **first public publishes** of `@bbingz/polycli-utils@1.0.0` and `@bbingz/polycli-timing@1.0.0`; `@bbingz/polycli-opencode@0.5.0` also published. All three confirmed via `npm search '@bbingz/'`.
- Closes roadmap R5 (Claude host fixture pilot), R6 (auth-probe transient-error regex named contracts), and Q1 (utils + timing published). Q2 and Q3 remain in "observing" state. Runtime stays private. 256/256 tests pass at release tag.

---

## 2026-04-24 — Claude — prepare v0.5.0 release

- Bumped the four host plugin release manifests and both host marketplace metadata entries from `0.4.2` to `0.5.0`.
- Drafted `docs/release-notes-v0.5.0.md` covering R6 (auth-probe regex contracts), P1/Q1 (utils + timing first public npm publish), and R5 (Claude fixture replay pilot).
- `release:check` passes end-to-end: 256/256 tests, manifest validation, plugin validation, `@bbingz/polycli-opencode@0.5.0` / `@bbingz/polycli-utils@1.0.0` / `@bbingz/polycli-timing@1.0.0` dry-run publishes all succeed.

---

## 2026-04-24 — Codex — pilot claude host integration fixture replay

- Added captured real Claude CLI stream fixtures for host-level `/ask` and `/health` success coverage.
- Added a host integration replay helper that surfaces missing fixture files explicitly and replays captured stream output through the bundled companion without changing other provider tests.
- Converted the Claude `/ask` success path to fixture replay and added a Claude `/health` success integration test that records timing from the replayed stream.

---

## 2026-04-24 — Codex — prepare utils and timing for first npm publish

- Made `@bbingz/polycli-utils` and `@bbingz/polycli-timing` publishable by removing `private: true` and adding npm metadata, package file lists, and public publish config while leaving `@bbingz/polycli-runtime` private.
- Refreshed both package READMEs and rewrote `docs/polycli-v1-public-surface.md` as the live v1 contract for utils + timing only.
- Added `pack:utils` / `pack:timing` scripts, updated manifest validation to require only runtime to stay private, and made `release:check` validate publishable packages repeatably: unpublished versions use `npm publish --dry-run`, already-published versions fall back to `npm pack --dry-run`.

---

## 2026-04-24 — Codex — name auth-probe transient-error regex contracts

- Extracted the transient auth-probe regexes in gemini / qwen / kimi / opencode / pi into provider-local `TRANSIENT_PROBE_ERROR_PATTERNS` exports without changing the existing match behavior.
- Added provider tests that assert the named patterns keep timeout-like probe failures in the `loggedIn=true` / inconclusive path while still treating explicit `401 Unauthorized` errors as genuine auth failures.

---

## 2026-04-24 — Claude — decide Q1 (publish utils/timing); annotate Q2/Q3 as observing

- User directive on 2026-04-24: publish `@bbingz/polycli-utils` and `@bbingz/polycli-timing` to npm ("能用就应该发"). Extended `docs/archive/review-2026-04-24-v0.5.0-spec.md` with a P1 (Q1) section covering manifest fields, README refresh, v1-public-surface rewrite, `pack:utils` / `pack:timing` scripts, and `release:check` extension with dry-run publishes.
- Q2 (model fallback sustainability) and Q3 (four-host surface convergence) marked "observing" in `docs/roadmap.md` per user direction: record the concern, do not act until a signal accumulates.
- Runtime (`@bbingz/polycli-runtime`) stays `"private": true`; this decision applies only to utils + timing.

---

## 2026-04-24 — Claude — close roadmap R4 + R7; refresh roadmap for v0.5.0

- Added `docs/host-command-map.md` — capability × host mapping for all 10 polycli commands across Claude Code / Codex / Copilot / OpenCode plus side-by-side invocation examples. Closes roadmap R4.
- Added `scripts/check-review-cli-drift.mjs` that probes installed provider CLIs and asserts the flags `/review` hard constraints depend on (`--tools` / `--approval-mode` / `--policy` / `--excluded-tools` / `--agent` / `--no-tools`) still exist. Env-var based constraints (MiniMax `MINI_AGENT_CONFIG_PATH`, OpenCode `OPENCODE_CONFIG_CONTENT`) are listed as manual-watch reminders. Wired as `npm run check:review-drift`. Closes roadmap R7.
- Refreshed `docs/roadmap.md`: removed the completed R1 / R2 / R3 / R4 / R7 entries, updated Current state to v0.4.2 / 250 tests, narrowed v0.5.0 scope to R5 + R6 + optional Q1/Q2/Q3 decisions.

---

## 2026-04-24 — Claude — v0.4.2 shipped

- Pushed `main` + tag `v0.4.2` (tag at 5c7f709 — R2 runtime fix commit).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.4.2 (notes from `docs/release-notes-v0.4.2.md`).
- npm: `@bbingz/polycli-opencode@0.4.2` published.
- Closes roadmap R1 (p2-p3-backlog merged; 511fceb dropped as superseded by 12d9ca9), R2 (minimax capability matrix + review.mjs YAML hardening + tmp cleanup), and R3 (v1 surface doc superseded). 250/250 tests pass at release tag.

---

## 2026-04-24 — Claude — prepare v0.4.2 release

- Bumped the four host plugin release manifests and both host marketplace metadata entries from `0.4.1` to `0.4.2`.
- Drafted `docs/release-notes-v0.4.2.md` covering the R1 (spawn cancellation / arg parsing / stream JSON scalars / performance.now timing) and R2 (review.mjs YAML scalar + tmp cleanup) roadmap closures.
- `release:check` passes end-to-end: 250/250 tests, manifest validation, plugin validation, `@bbingz/polycli-opencode@0.4.2` dry-run publish.

---

## 2026-04-24 — Codex — harden review config parsing and temp cleanup

- Replaced MiniMax review config scalar extraction with a small private parser that supports plain, single-quoted, and double-quoted scalars while rejecting unsupported block/folded and malformed YAML forms.
- Registered review temp files for best-effort cleanup on process exit so generated per-review config directories do not accumulate across long-running hosts.
- Added regression coverage for supported scalar forms, unsupported block scalars, malformed config lines, comment handling, and child-process exit cleanup.

## 2026-04-24 — Codex — land P2/P3 runtime backlog hardening

- Landed the surviving `p2-p3-backlog` runtime commits as one squash: `spawnStreamingCommand` now supports AbortSignal cancellation, stdout decoder overflow protection, stdin drain handling, and post-settle output suppression.
- Hardened runtime reliability around MiniMax log-read failures, provider exit error formatting, and registry timing by switching prompt duration measurement to monotonic `performance.now()`.
- Tightened shared utility and timing edge cases: argument parsing rejects malformed empty booleans / unterminated quotes, stream JSON parsing recognizes arrays and bare scalar values, and timing validation rejects invalid numeric bounds.

## 2026-04-24 — Claude — add provider capability matrix and supersede v1 surface doc

- Added a provider capability matrix to root `README.md` (streaming / sessionResume / structuredOutput / ttft / gen / tail / tool) sourced from `packages/polycli-runtime/src/registry.js`. Surfaces `minimax`'s session-resume / structured-output / streaming-timing limits in the root doc instead of only in `plugins/polycli-opencode/README.md`, and explains why `qwen`'s `tool: "missing"` is semantically distinct from the other seven providers' `tool: "unsupported"`.
- Prepended a Superseded banner to `docs/polycli-v1-public-surface.md` (v0.3 snapshot) pointing to the live surface sources (`README.md`, `registry.js`, `timing.js`, `CHANGELOG.md`, `docs/roadmap.md`). Content below the banner is preserved as historical reference.
- Updated `CLAUDE.md` Must-read list: added `docs/roadmap.md`, relabeled the v1 surface doc as a v0.3 snapshot / not a live constraint. Closes roadmap R3 (Path B) and R2 (minimax matrix).

---

## 2026-04-24 — Claude — v0.4.1 shipped

- Pushed `main` + tag `v0.4.1` (HEAD at eaddbbd).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.4.1 (notes from `docs/release-notes-v0.4.1.md`).
- npm: `@bbingz/polycli-opencode@0.4.1` published. Earlier suspicion that v0.4.0 had never reached npm was a token-expired false positive; `npm view` confirms 0.3.0 / 0.4.0 / 0.4.1 all present.
- Closes the review loop that began with `docs/archive/review-2026-04-24.md`. All 8 bugs from `docs/archive/review-2026-04-24-bugs.md` (B1–B8) plus FU1–FU3 release-prep follow-ups landed. 221/221 tests pass at release tag.

---

## 2026-04-24 — Codex — lift ask response model to top level for all providers

- Six provider runtimes (claude / gemini / kimi / minimax / opencode / pi) now populate the top-level `model` field on ask results, matching qwen and copilot.
- Added a `defaultModel` pass-through in the registry so the host companion can supply a cached `getAuthStatus` value as a final fallback when the provider's own events do not carry a model.
- Per-provider fixture and fallback assertions lock the new contract; integration smoke tests assert non-null `model` for all 8 providers.

---

## 2026-04-24 — Codex — fix observed host-companion bugs

- Normalized provider CLI availability details to the first non-empty line so multi-line version banners no longer break `setup` text rendering.
- Made `--json` errors structured for argument and lookup failures, added subcommand `--help` short-circuiting, and validated `timing --provider` / `--history` inputs.
- Aligned `cancel` no-op exit behavior and flattened `result --json` so completed job payloads expose `response`, `ok`, `sessionId`, and `timing` at the top level while retaining `job` metadata.

---

## 2026-04-24 — Codex — prepare v0.4.1 release

- Bumped the four host plugin release manifests and host marketplace metadata from `0.4.0` to `0.4.1`, while keeping internal workspace packages on the `1.0.0` line.
- Marked `@bbingz/polycli-utils` and `@bbingz/polycli-timing` as private internal bundler inputs, matching `@bbingz/polycli-runtime`.
- Removed the Copilot adapter from the Claude marketplace now that Copilot has its own marketplace, and kept release manifest validation wired into `release:check`.

## 2026-04-24 — Codex — fix pi duplicate terminal text and pin default model

- Fixed the pi JSON stream parser so visible assistant text is sourced from `text_delta` when present, with terminal `message_end` / `turn_end` / `agent_end` text only used as a fallback; this removes the repeated final-answer concatenation seen in live pi runs and saved fixtures.
- Pinned the default pi model to `openai-codex/gpt-5.4` so host-driven `ask` calls no longer depend on whatever ambient pi config happens to select.
- Updated pi fixture expectations and added focused regression coverage for both the duplicate-terminal-summary case and the default-model invocation contract.

## 2026-04-24 — Codex — harden ask-path visibility for qwen and kimi

- Added prompt-runtime constraints for prompt-bearing commands so `ask` now applies the missing host-level visibility guards: `kimi` gets `--no-thinking --max-steps-per-turn 1`; `qwen` gets `--max-session-turns 1` plus a forced visible-final-answer system prompt.
- Added focused regression coverage for those ask-path constraints and the shared helper that computes them, closing the gap where `/review` was hardened but `/ask` was still unconstrained.
- Extended fake provider integration fixtures so qwen/kimi can simulate thought-only output when constraints are absent; this makes the failure mode observable in CI instead of only via live session history.
- Verification on `main`: `npm test` passed `191/191`; live non-Claude smoke (`gemini`, `kimi`, `qwen`, `minimax`, `copilot`, `opencode`, `pi`) all returned successful `setup` + `ask`, with `qwen`/`kimi` now producing visible final `OK` through `polycli`.

## 2026-04-22 — Claude — v0.4.0 shipped

- Pushed `main` + tag `v0.4.0` (HEAD at 08f84c3).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.4.0 (notes from `docs/release-notes-v0.4.0.md`).
- npm: `@bbingz/polycli-opencode@0.4.0` published; `npm view` confirms no propagation lag.
- Closes the review loop that began with `docs/archive/review-2026-04-22.md`. All P0/P1 from that review plus P3 fixture migration landed. 185/185 tests pass at release tag.

## 2026-04-22 — Claude — Group 4 / 5 / release specs for Codex

- Appended three spec sections to [docs/archive/review-fb64b1e.md](docs/archive/review-fb64b1e.md):
  - Group 4: P2 host-plugin hygiene (appendPreview O(n²), previewText emoji, auto-scope shallow-clone diagnostics) — one-commit batch.
  - Group 5: real-CLI saved-stdout fixture migration (per-provider capture list, replay helper design, scope guards against running capture in CI).
  - Release checklist: v0.4.0 step-by-step with explicit Codex / user / Claude role split for each step.
- Created [tasks/lessons.md](tasks/lessons.md) with the "stay in reviewer role" correction — do not slip into implementation mode when the division of labor is Claude-reviews-Codex-implements.

## 2026-04-22 — Claude — Verdict on commit 95b003c (Group 2 + 3 complete)

- Appended verdict A to [docs/archive/review-fb64b1e.md](docs/archive/review-fb64b1e.md): atomic-save durability + `/review` CLI hard constraints both landed; `npm test` 171/171.
- Codex's Phase 1 research ([docs/archive/review-cli-flags.md](docs/archive/review-cli-flags.md)) corrected 4 of 6 CLI-flag hypotheses from the original review against locally installed CLIs + primary sources.
- Non-overridable review constraint decision documented and enforced via `assertNoReviewConstraintOverride`.
- Original review P0/P1 scope now 100% closed. P2/P3 move to release backlog.

## 2026-04-22 — Claude — Verdict on commit 6636b7a + Group 2/3 instructions

- Appended verdict to [docs/archive/review-fb64b1e.md](docs/archive/review-fb64b1e.md): Group 1 landed cleanly (P1-C / P1-D / P1-E / registry gemini branch), 152/152 tests passing.
- Group 2 (atomic-save durability) and Group 3 (/review CLI hard constraints) now have concrete per-file fix specs appended to the same doc, including test plans and scope guards.
- Group 3 requires a Phase 1 research pass (per-provider CLI flag verification) before Phase 2 code changes; suggested output is a short memo at `docs/archive/review-cli-flags.md`.

## 2026-04-22 — Claude — Follow-up review of commit fb64b1e

- Authored [docs/archive/review-fb64b1e.md](docs/archive/review-fb64b1e.md): verdict A- on Codex's fix batch.
- All 6 P0 items fixed with correct semantics + 23 new regression tests (npm test: 146/146).
- P1 fixed: A (transient probe), B (session-id fall-through), G (jobs/<id>.json locking), H (stdout-as-error paths).
- P1 deferred for next batch: C (generic event.text fallback), D (copilot/opencode type:"error" capture), E (gemini hasVisibleText), F (atomic-save fsync), I (/review CLI hard constraints), plus registry `isTerminalSummaryEvent` gemini branch.
- Recommended next-commit grouping: Group 1 (streaming parser consistency = C+D+E+registry); Group 2 (atomic-save durability = F); Group 3 (/review constraints = I).

## 2026-04-22 — Claude — Full implementation review (for Codex handoff)

- Authored [docs/archive/review-2026-04-22.md](docs/archive/review-2026-04-22.md): 4-agent parallel review across utils+timing, runtime core, 8 provider adapters, and host plugin (~5,200 LoC source, ~117 raw findings).
- Report is structured as P0 (6 ship blockers) → P1 (9 high-risk themes) → P2 (parser / timing / process / host grouped) → P3 (gaps and nits).
- Flagged one runtime-core agent recommendation to REJECT: `timing.js:66, 73` hardcoding `cold` / `retry` as `unsupported` is correct per the documented project decision; do not change to `missing`.
- No source code touched; review doc only.

## 2026-04-22 — Claude — Repo onboarding scaffolding

- Added `CLAUDE.md` at repo root: thin Claude-Code-specific patches layered on top of `AGENTS.md` (architecture boundary, test command priority, provider gotchas).
- Added this `CHANGELOG.md` to satisfy cross-AI collaboration convention from the user's global rules.
- Seeded project memory under `~/.claude/projects/-Users-bing--Code--polycli/memory/` with `MEMORY.md` index and layered entries (user / project / feedback / reference).
- No source code touched; no tests run (docs/infra only).
