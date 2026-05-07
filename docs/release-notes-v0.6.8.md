# polycli v0.6.8

Adds background-worker run-ledger plumbing and a read-only terminal TUI inspector on top of `v0.6.7`. No provider runtime semantics or upstream CLI behavior changed.

## What changed

### Background-job ledger plumbing (Q6 Spec 2)

- The parent process persists a top-level `runContext` (runId / command / hostSurface / argv / jobId / provider / kind / model / defaultModel / logFile) into the per-job config when `--run-id` (or `POLYCLI_RUN_ID`) is in scope. After spawning the worker, the parent writes one `job_started` event.
- `_job-worker` reads `runContext` and writes `attempt_started` before `runProviderPromptStreaming`. After the job write succeeds, the worker writes `attempt_result` (status `completed` / `failed`) plus `provider_decision` (`adopted` on ok, `failed reason=<kind>_failed` on not-ok). Worker-observed cancellation produces `attempt_result status=cancelled` + `provider_decision status=cancelled reason=job_cancelled`.
- New shared writer `recordRunEventForContext(workspaceRoot, runContext, base)`; existing `recordRunEvent` delegates via `buildCurrentRunContext()`. Worker code never mutates the parent-side `RUN_CONTEXT` global.
- `createRunLedgerEvent` schema gains nullable `pid` / `durationMs` slots; foreground events round-trip with the existing fields and add `null` defaults for the new ones.
- Tests: 3 new background integration tests (success with `--run-id`, failed `cmd ask` without full-prompt leakage, explicit `POLYCLI_HOST_SURFACE=codex-skill` propagation).
- Killed-worker (`kill -9` after provider returns but before the ledger write) perfect recovery is open ledger-side hardening (reaper or scan-on-read step), not a TUI gate.

### Read-only TUI inspector (Q6 Spec 3)

- New terminal-only `polycli tui` command, routed through the existing `@bbingz/polycli` wrapper. It does not run, retry, cancel, or mutate provider jobs; it only renders persisted run-ledger / debug data.
- Pure view-model layer (`packages/polycli-terminal/lib/tui/view-model.mjs`) with `classifyProviderStates`, `formatReproductionCommand`, `truncateMiddle`, `applyKey`, `buildTuiModel`, `renderTuiFrame` — testable without a real TTY.
- Real navigation: `up`/`down`/`k`/`j` move run selection (clamped at the ends), `enter` opens the selected run's detail view, `b` returns to list, `tab` cycles the focused pane (`runs`→`providers`→`events`→`repro`), `?` toggles a Help line, `r` refreshes from the ledger, `q` / Ctrl-C quit. Footer only names keys actually wired.
- Selection change reloads the selected run's `debug show` + `debug explain` so the matrix / timeline / detail panes always reflect the active run, not the initial one. `r` refresh preserves the current selection unless the run disappears from the index.
- Raw-mode safety: `interactive()` enters raw mode under a `try / finally` guard with an idempotent `restoreRawMode` (also hooked into `SIGINT` and `exit`). Initial-load failure and refresh-load failure both restore raw mode before exiting; refresh failures show an error frame and stay in the loop until `q`.
- `--history <count>` validates a non-negative integer and slices the runs index in the TUI (companion `debug runs` contract unchanged). `--run-id <id>` selects an explicit run.
- TUI files ship in the `@bbingz/polycli` tarball: `bin/polycli-tui.mjs`, `lib/tui/view-model.mjs`. New packaging assertion in `scripts/tests/open-source-packaging.test.mjs`.
- Jobs with `started` or `attempt_started` but no terminal `attempt_result` / `provider_decision` render as `unfinished` / `unknown`. Killed-worker perfect recovery is the open ledger-side follow-up; it is not a TUI gate.
- Smoke-only `--script-keys "<k1,k2,...>"` test hook drives the runtime through key sequences (`down`, `down,enter`, etc.) so selection-change-reloads-detail and other key transitions are testable without a real TTY.

### Run-ledger debug examples docs

- `docs/polycli-v1-public-surface.md` adds a "Run ledger debug examples" section that walks through the original Q6 narrative end-to-end:
  - `cmd` health passed, but two `ask` attempts failed → not adopted.
  - `pi` health failed → skipped before any prompt-bearing work.
- Examples reference event-schema slots (`provider_decision`, `health_result`, `reason: ask_failed` / `health_failed`) and `polycli debug runs / show / explain`, not invented live provider output.

## Manual smoke (v0.6.8 prep)

Automated smoke against the real `node packages/polycli-terminal/bin/polycli.mjs tui ...` binary (via `--smoke` and `--script-keys`) on 2026-05-07:

- ✅ TUI renders a frame from a real ledger fixture (`view:list pane:runs`, run list, provider matrix, footer).
- ✅ `down` reloads run-b's detail (matrix flips from `qwen adopted` to `pi skipped health_failed`).
- ✅ `down,enter` enters detail view and surfaces run-b's explanation block (`view:detail`, `explanation`, `pi skipped (health_failed)`).
- ✅ `down,enter,b` returns to `view:list`.
- ✅ `?` toggles the `Help:` line on; the persistent footer stays.
- ✅ `tab,tab` cycles focused pane to `events`.
- ✅ `--history=1` renders only one run.
- ✅ Non-TTY interactive entry exits 1 with the `requires an interactive TTY` error and never enters raw mode.

User-side TTY verification still required before tagging / publishing v0.6.8 (these paths are interactive-only and cannot be exercised from a non-TTY harness):

- `polycli tui` opens in a real terminal and `q` quits without leaving the terminal in raw mode.
- `r` refresh in interactive mode re-reads the ledger and re-renders without crashing.
- Visible cursor / colour state restored after `q`.

## Verification targets

- `node --test scripts/tests/terminal-tui.test.mjs scripts/tests/open-source-packaging.test.mjs`
- `npm test`
- `npm run release:check`

## Publish notes

This release adds no new npm package. Same 6 release artifacts as `v0.6.7`:

- GitHub release `v0.6.8`
- npm `@bbingz/polycli-opencode@0.6.8`
- npm `@bbingz/polycli@0.6.8`
- Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`).

See `docs/release.md` for the full sequence.
