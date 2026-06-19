# polycli v0.6.25

Patch on top of `v0.6.24` that lands the re-verified workflow-review remediation, stabilizes the last tmux fake-bin test, and adds the cc-X domestic-model endpoint recipes as Path-B docs + reference data.

The v0.6.22 Claude behavior remains unchanged: ordinary Claude `ask` / `review` calls use headless `claude -p` with plan/no-tools/no-MCP constraints, while explicit/internal tmux TUI runtime support remains available.

## What changed

### Re-verified workflow-review remediation (fixes)

- OpenCode host adapter: companion exit code 2 (`health` with no healthy provider, `status --wait` timeout — both emit a valid JSON envelope on stdout) is now treated as a SOFT signal via `isHardCompanionFailure`, not a thrown tool error; exit 1/4/5/crash still reject.
- `cancelJob`: kills the worker BEFORE deleting its runtime paths (a review job's live cwd lives in `cleanupPaths`), and skips runtime-path cleanup entirely when the kill fails (worker may still be alive). `terminate` is now injectable for testing.
- Grok: added `maxtokens`/`max_tokens`/`length` to `SUCCESS_STOP_REASONS` so a truncated-but-visible answer stays `ok=true` (the real grok-build StopReason enum was verified against the installed binary); refusal/cancelled/tool_use/max_turn_requests stay non-success.
- Run ledger: `ensureStateDir` is now called before the ndjson append so `~/.polycli/state/<slug>` is created `0700`, not world-traversable `0755`, on the `run_started` event that fires before any other state write.

### Test stabilization

- The remaining tmux fake-bin test (`submits folded Claude paste markers`) used a hardcoded `timeout: 2_000` while the other four tmux-tui tests use the shared `TMUX_TEST_TIMEOUT_MS` (5_000). Under full-suite parallel load the node fake-bin could not flush its log within 2s, causing an intermittent `tmux.jsonl` ENOENT (~30% of runs). Aligned to the proven-stable 5s budget.
- Added RED-proven coverage: pre-existing-0755 dir hardening, state-dir-0700-after-append-only, grok stopReason-ALONE failure (json + streaming) + MaxTokens success, sync `runProviderPrompt` explicit-model fallback, and the OpenCode exit-2 contract.

### cc-X domestic-model endpoint recipes (docs)

- Added `docs/cc-x-endpoints.md` (human reference) + `docs/cc-x-recipes.json` (machine-readable source of truth, 9 entries) encoding the cc-X pattern: point the EXISTING `claude` runtime (BYOK) or `opencode` (OpenAI-compatible) at a domestic vendor's Anthropic-compatible endpoint via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_MODEL`.
- Marketplace endpoints (Baidu/Tencent) carry `status: "marketplace-unstable"` + `autoCompactWindow: null` (honest-default: no fabricated model/version pin, mirroring the gemini attempted-vs-used-model caveat). Guarded by `scripts/validate-cc-x-recipes.mjs` + its paired test (auto-joined by the npm-test glob); `npm run validate:cc-x-recipes` added.
- cc-X is NOT a polycli provider/adapter/runtime — it rides the existing runtimes via standard env vars (`claude.js` already forwards the `ANTHROPIC_*` trio). Recorded as roadmap closed Q10 + an Explicit-non-goal. Zero runtime/production-path code change.

## Verification

- Adversarial re-verification of the prior remediation (d272042 + 03ae92d) via a multi-agent workflow: 18 raw findings → 7 confirmed + 1 critic-confirmed (11 refuted). RED-proven for the grok MaxTokens and run-ledger dir-mode fixes.
- `npm test` passed 549/549.
- `npm run release:check` passed, including bundle/fixture/manifest/host-map/Codex adapter/review-drift checks, Claude plugin validation, and npm publish/pack dry-runs.
- PR #11 CI (Node 20 verification) passed; the previously-flaky tmux test passed on CI.

## Release artifacts

- GitHub release `v0.6.25`: https://github.com/bbingz/polycli/releases/tag/v0.6.25 (`publishedAt` `2026-06-19T08:09:43Z`)
- npm `@bbingz/polycli-opencode@0.6.25` (`latest`, `time.modified` `2026-06-19T08:08:10.077Z`, shasum `387fbf0347c5abc498d632c654b29783613240d5`)
- npm `@bbingz/polycli@0.6.25` (`latest`, `time.modified` `2026-06-19T08:08:04.426Z`, shasum `f243987016b6b89d536aadb83314a9416acd52e8`)

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.2`, `@bbingz/polycli-timing@1.0.1`).
