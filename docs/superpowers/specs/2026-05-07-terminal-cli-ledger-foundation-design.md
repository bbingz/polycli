# Terminal CLI And Run Ledger Foundation Design

## Objective

Build the first implementable slice of the Q6 terminal CLI/TUI track: a real PATH-callable `polycli` terminal entry point plus a minimal persistent run ledger that can explain provider health, attempts, failures, skips, and adopted outputs across a multi-provider workflow.

This spec intentionally stops before the TUI. The TUI will be useful only after the headless CLI and ledger can answer why a provider was adopted, skipped, or failed.

## Problem

Polycli currently works through host plugins that dispatch to the shared companion bundle. That leaves two gaps:

1. Agents still look for a shell tool because there is no stable `polycli` binary on PATH.
2. Debug evidence is split across job state, job logs, and timing history. There is no run-level record explaining a multi-provider review.

The triggering case:

- Adopted outputs came from 7 providers: `gemini`, `copilot`, `kimi`, `qwen`, `minimax`, `claude`, and `opencode`.
- `cmd` passed health but failed two ask attempts.
- `pi` failed health and was skipped before prompt-bearing work.

Current `health`, `status`, `result`, and `timing` output cannot reconstruct that story reliably after the fact.

## First-Slice Scope

Spec 1 includes:

- A terminal-facing package with a real `bin.polycli`.
- Generated terminal companion bundle target built from the same companion entry used by host plugins.
- Command parity for the existing companion commands.
- An append-only run ledger stored under the existing workspace state directory.
- A shared run correlation mechanism: `--run-id <id>` and `POLYCLI_RUN_ID`.
- Minimal debug commands to inspect recent runs and explain a run.
- Tests and release guards for the terminal package, bundle parity, ledger writing, redaction, and debug output.

Spec 1 excludes:

- No TUI.
- No daemon, server, monitor, or long-lived process.
- No public promotion of `@bbingz/polycli-runtime`.
- No shared provider base class.
- No unified provider event schema.
- No automatic multi-provider orchestration.
- No full diagnostic engine beyond deterministic summaries from ledger events.
- No storage of full prompts or full raw stdout/stderr by default.

## Architecture

### Terminal Package

Create a terminal-facing package under `packages/` so it participates in the existing workspace layout:

- Package path: `packages/polycli-terminal`
- Package name: `@bbingz/polycli`
- Binary: `polycli`
- Entry file: `bin/polycli.mjs`
- Bundled companion target: `packages/polycli-terminal/bin/polycli-companion.bundle.mjs`

The `polycli` binary should execute the bundled companion with the original argv. It should not reimplement command semantics. The wrapper sets `POLYCLI_HOST_SURFACE=terminal` when the caller has not already provided a host-surface override.

The root package remains private. The existing public package split remains intact:

- `@bbingz/polycli-utils`: public utility contract
- `@bbingz/polycli-timing`: public timing contract
- `@bbingz/polycli-runtime`: internal bundler input
- `@bbingz/polycli`: terminal/operator surface introduced by this track

### Bundle Strategy

Extend `scripts/build-plugin-bundles.mjs` to produce a fifth byte-identical behavior target from `plugins/polycli/scripts/polycli-companion.mjs`:

- `plugins/polycli/scripts/polycli-companion.bundle.mjs`
- `plugins/polycli-codex/scripts/polycli-companion.bundle.mjs`
- `plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs`
- `plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs`
- `packages/polycli-terminal/bin/polycli-companion.bundle.mjs`

The terminal wrapper is host-specific packaging. The command behavior remains companion behavior.

### Command Parity

The terminal binary supports the existing companion vocabulary:

- `setup`
- `health`
- `ask`
- `rescue`
- `review`
- `adversarial-review`
- `status`
- `result`
- `cancel`
- `timing`

Spec 1 also adds shared companion debug commands. The terminal binary exposes them directly as `polycli debug ...`; host plugins may invoke the same companion command vocabulary. The implementation must update host-map docs and validators in the same slice so the command surface does not drift.

- `debug runs [--history <n>] [--json]`
- `debug show [run-id] [--json]`
- `debug explain [run-id] [--json]`

`--json` output must not be summarized or reshaped for existing commands.

## Run Correlation

Each prompt-bearing or health command creates or joins a run.

Run id resolution order:

1. Explicit `--run-id <id>`
2. Environment variable `POLYCLI_RUN_ID`
3. Auto-generated id for the current command

The explicit or environment run id is necessary for multi-provider workflows where a host agent issues several single-provider commands. Without it, each command remains debuggable but cannot be reliably grouped into one multi-provider story.

Valid run ids:

- ASCII letters, digits, `_`, `-`, and `.`
- 1 to 96 characters
- Invalid values fail with a structured error under `--json`

The companion should accept `--run-id` on:

- `health`
- `ask`
- `rescue`
- `review`
- `adversarial-review`

Debug commands read runs only; they do not create run ids.

`--run-id` is a global option for these commands, not a provider or prompt positional. Parsing must strip both `--run-id <id>` and `--run-id=<id>` before command-specific positional resolution, regardless of whether the option appears before or after provider, prompt, or review flags.

## Ledger Storage

Add ledger helpers under `plugins/polycli/scripts/lib/run-ledger.mjs`.

Store events in:

```text
<resolveStateDir(workspaceRoot)>/run-ledger.ndjson
```

Use the same state root policy as existing state:

- `CLAUDE_PLUGIN_DATA/state/<workspace-slug>/...` when `CLAUDE_PLUGIN_DATA` is set
- OS temp fallback when it is not set

The ledger is independent from:

- `state.json`
- `jobs/<jobId>.json`
- `jobs/<jobId>.log`
- `timings.ndjson`

It should use append-only NDJSON with rotation. The first slice can use the same practical ceiling as timing history unless implementation evidence shows a better limit:

- max bytes: `2_000_000`
- keep ratio after rotation: `0.5`

Corrupt individual ledger lines are ignored by readers. The entire ledger file should not be renamed just because one line is invalid.

## Ledger Event Schema

All events use this base shape:

```json
{
  "version": 1,
  "eventId": "evt_abc123",
  "runId": "run_abc123",
  "at": "2026-05-07T12:00:00.000Z",
  "workspaceRoot": "/abs/path",
  "workspaceSlug": "polycli-abc123",
  "command": "health",
  "commands": ["health"],
  "kind": "health",
  "provider": "qwen",
  "phase": "health_result",
  "status": "passed",
  "reason": null,
  "attempt": null,
  "jobId": null,
  "model": "qwen-model",
  "defaultModel": null,
  "timingRef": {
    "provider": "qwen",
    "kind": "health",
    "completedAt": "2026-05-07T12:00:01.000Z"
  },
  "error": null,
  "preview": "POLYCLI_HEALTH_OK",
  "stdoutBytes": null,
  "stderrBytes": null,
  "logFile": null,
  "argv": ["health", "--provider", "qwen", "--json"],
  "hostSurface": "terminal"
}
```

Required fields:

- `version`
- `eventId`
- `runId`
- `at`
- `workspaceRoot`
- `workspaceSlug`
- `command`
- `commands`
- `phase`
- `status`
- `hostSurface`

Provider may be `null` for run-level summary events.

`command` is the command for the individual event. `commands` is the sorted unique command set currently observed for the run when writing run-level summary events and when returning `debug runs`.

Allowed phases:

- `run_started`
- `health_result`
- `provider_decision`
- `attempt_started`
- `attempt_result`
- `job_started`
- `job_result`
- `run_summary`

Allowed statuses:

- `started`
- `passed`
- `failed`
- `adopted`
- `skipped`
- `completed`
- `cancelled`

Allowed reasons include:

- `health_passed`
- `health_failed`
- `unavailable`
- `response_mismatch`
- `selected_after_health`
- `ask_failed`
- `provider_error`
- `no_changes`
- `job_started`
- `job_completed`
- `job_failed`
- `job_cancelled`
- `manual`

The schema is intentionally extensible. Readers must preserve unknown fields and ignore unknown phases with a visible `unknown` fallback in debug summaries.

## Adopted And Skipped Semantics

`adopted` means a provider produced an `ok: true` result for an attempt in this run and that result is usable by the caller. It does not mean the provider merely passed health.

`skipped` means a provider was considered in this run but prompt-bearing work was not attempted. In Spec 1, the main skipped reason is failed health.

For all-provider `health`, the companion records:

- `health_result` for every provider probed
- `provider_decision` with `passed` for healthy providers
- `provider_decision` with `skipped` for failed providers

For prompt-bearing commands, the companion records:

- `attempt_started`
- `attempt_result`
- `provider_decision` with `adopted` when result `ok === true`
- `provider_decision` with `failed` reason when result `ok !== true`

For background prompt-bearing commands, the foreground launcher records `job_started`. The worker records `job_result` and a matching `provider_decision` when it observes completion, failure, or late cancellation. If a background process is killed before cleanup, Spec 1 may show the job as started without a final provider decision until existing job refresh marks it stale.

For `review` and `adversarial-review` with no diff, the companion still records the run invocation. It writes `run_started`, `run_summary`, and a run-level `provider_decision` with `provider: null`, `status: "skipped"`, and `reason: "no_changes"`. This does not count as `adopted`.

`run_started` and `run_summary` are per command invocation events. Readers group by `runId`, use the earliest `run_started` as the run start, use the latest event timestamp as the run update time, and tolerate duplicate `run_started` events for joined runs. `debug runs` displays the run's command set, not just the first command.

The target failure can be explained only if the caller reuses the same run id:

```bash
RUN_ID="review-20260507-codex"
POLYCLI_RUN_ID="$RUN_ID" polycli health --json
POLYCLI_RUN_ID="$RUN_ID" polycli ask --provider cmd --json "..."
POLYCLI_RUN_ID="$RUN_ID" polycli ask --provider cmd --json "..."
POLYCLI_RUN_ID="$RUN_ID" polycli debug explain "$RUN_ID"
```

## Redaction

Ledger events must not persist full prompt text by default.

Persist:

- command argv with prompt-like trailing positionals replaced by `"<prompt:redacted>"`
- response preview, capped at 180 characters
- error preview, capped at 300 characters
- stdout/stderr byte counts when available
- log file path when available

Do not persist by default:

- full prompt
- full stdout
- full stderr
- environment variables
- API keys or token-looking argv values

Redaction must catch common secret-shaped arguments:

- `--api-key <value>`
- `--api-key=<value>`
- `--token <value>`
- `--token=<value>`
- `--secret <value>`
- `--secret=<value>`
- `--password <value>`
- `--password=<value>`
- any case-insensitive long option whose name contains `token`, `secret`, `password`, `api-key`, `apikey`, `access-key`, or `credential`
- `KEY=value` where key case-insensitively contains `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `APIKEY`, `ACCESS_KEY`, or `CREDENTIAL`

Prompt-bearing commands must redact prompt and focus positionals before persisting `argv`, including review focus arguments and inline prompt values. The first implementation should not add an opt-in full prompt persistence flag.

Debug commands should expose file paths to existing job logs, not inline full log contents in Spec 1.

## Debug Commands

### `debug runs`

Lists recent runs built from ledger events.

Text output:

```text
| runId | commands | started | providers | adopted | skipped | failed |
|---|---|---|---:|---:|---:|---:|
| run_abc | health,ask | 2026-05-07T12:00:00.000Z | 9 | 7 | 1 | 1 |
```

JSON output:

```json
{
  "runs": [
    {
      "runId": "run_abc",
      "commands": ["ask", "health"],
      "startedAt": "2026-05-07T12:00:00.000Z",
      "updatedAt": "2026-05-07T12:00:10.000Z",
      "providerCount": 9,
      "adoptedCount": 7,
      "skippedCount": 1,
      "failedCount": 1
    }
  ]
}
```

### `debug show`

Shows raw ledger events for one run. If no run id is provided, uses the most recent run.

JSON output:

```json
{
  "runId": "run_abc",
  "events": []
}
```

Text output may be a chronological event list.

### `debug explain`

Builds a deterministic summary from ledger events.

The target case should render:

```text
Run run_abc
Providers observed: 9
Adopted: gemini, copilot, kimi, qwen, minimax, claude, opencode
Failed: cmd (health passed; ask failed 2 times)
Skipped: pi (health failed before prompt-bearing work)
```

JSON output:

```json
{
  "runId": "run_abc",
  "providerCount": 9,
  "adoptedProviders": ["gemini"],
  "failedProviders": [
    {
      "provider": "cmd",
      "summary": "health passed; ask failed 2 times"
    }
  ],
  "skippedProviders": [
    {
      "provider": "pi",
      "summary": "health failed before prompt-bearing work"
    }
  ]
}
```

## Integration Points

### `runHealth`

For each provider report:

- Write `health_result`.
- If `report.ok`, record `provider_decision` with `status: "passed"` and `reason: "health_passed"`.
- If not ok, record `provider_decision` with `status: "skipped"` and a reason derived from availability, response mismatch, or probe error.

### Foreground execution

In `runForegroundExecution`:

- Write `attempt_started` before provider invocation.
- Write `attempt_result` after provider invocation or caught error.
- Write `provider_decision` with `adopted` when `result.ok`.
- Write `provider_decision` with `failed` when `!result.ok`.
- Include `timingRef` when timing is appended.

Foreground failures must be written even when text-mode output throws.

### Background execution

In `startBackgroundExecution`:

- Write `job_started` with `jobId` and `logFile`.

In `_job-worker`:

- Write `job_result` for completed, failed, and cancelled-late cases where the worker observes them.
- Write a matching `provider_decision` for observed completed, failed, and cancelled-late cases.
- Include `timingRef` when timing is appended.

Spec 1 does not need perfect recovery for killed processes that never run cleanup. It should record the job start and rely on existing job refresh behavior to mark stale jobs failed.

### Terminal host surface

Set `hostSurface` to:

- `POLYCLI_HOST_SURFACE` when the env value is one of the recognized values below
- `terminal` for the new `polycli` binary
- `claude-plugin` when `CLAUDE_PLUGIN_ROOT` is present
- `codex-skill` when the companion path is under `polycli-codex`
- `copilot-skill` when the companion path is under `polycli-copilot`
- `opencode-plugin` when the companion path is under `polycli-opencode`
- `unknown` otherwise

This detection is best-effort and must not change command success/failure behavior.

Before implementing ledger writers, capture fixture samples for the known failure shape:

- one real `cmd` health-passed / ask-failed result
- one real `pi` health-failed result

These fixtures should inform error, preview, byte-count, and provider-decision fields. The schema above is the starting contract, but the slice should not release until the tests cover those actual shapes.

## Tests

Add focused tests before implementation.

State and ledger tests:

- `plugins/polycli/scripts/tests/run-ledger.test.mjs`
- validates append/read behavior
- validates invalid JSON line skipping
- validates rotation
- validates run grouping and latest-run lookup
- validates redaction of prompt text and secret-like args

Integration tests:

- `health --json --run-id run-test`, `health --json --run-id=run-test`, and `ask --provider qwen --json "prompt" --run-id run-test` all resolve the same run id without treating `--run-id` as a provider or prompt.
- `health --json --run-id run-test` writes health events for successful and failed providers.
- `ask --provider qwen --json --run-id run-test` writes adopted attempt events on success.
- `ask --provider cmd --json --run-id run-test` with empty successful output writes failed attempt events.
- Two failed `cmd` ask calls with the same run id produce two attempt failures.
- `health --json --run-id run-test` with failed `pi` probe yields skipped provider decision.
- `review --json --run-id run-test` with no diff writes `no_changes` skipped state, not adopted state.
- `debug runs --json` lists the run.
- `debug show run-test --json` returns raw events.
- `debug explain run-test --json` summarizes adopted, failed, and skipped providers.

Terminal package tests:

- Package has `bin.polycli`.
- `polycli --help` exits successfully and includes existing commands.
- Terminal bundle target exists after `npm run build:plugins`.
- Terminal wrapper preserves `--json` stdout from companion.

Release guard tests:

- Extend bundle validation to include terminal companion target.
- Extend host map validation and docs for the shared `debug` command vocabulary plus the terminal column.
- Add package hygiene coverage for `packages/polycli-terminal`.

## Documentation Updates

Spec 1 should update:

- `tasks/terminal-cli-tui-observability.md` when the slice lands.
- `docs/roadmap.md` Q6 status when the slice lands.
- README "Outside a supported host" only after `polycli` is usable.
- `docs/host-command-map.md` after terminal parity exists.
- `docs/polycli-v1-public-surface.md` to describe terminal package scope.

## Acceptance Criteria

The slice is complete when:

- `npm run build:plugins` creates the terminal companion bundle.
- `packages/polycli-terminal/package.json` exposes a working `polycli` bin.
- `polycli health --json --run-id run-smoke` works through the same companion behavior as host adapters.
- Ledger events are written to `run-ledger.ndjson` under the workspace state dir.
- `polycli debug runs --json`, `polycli debug show <runId> --json`, and `polycli debug explain <runId> --json` work.
- A same-run sequence can explain the target shape: 7 adopted providers, `cmd` health passed but two ask attempts failed, and `pi` health failed then skipped.
- Focused ledger, integration, terminal package, and release guard tests pass.
- Full `npm test` and `npm run release:check` pass or fail only for documented external provider availability blockers.

## Deferred To Later Specs

- TUI screens and keyboard interactions.
- Rich log viewer.
- `logs <runId>` command.
- Full `explain` classifier with remediation hints.
- Automatic multi-provider orchestration.
- Cross-workspace global history.
- Configurable retention policy beyond the initial byte cap.
