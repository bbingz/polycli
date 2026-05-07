# Background Job Run Ledger Plumbing Design

## Objective

Close the v0.6.7 run-ledger gap for background jobs.

Foreground `health`, `ask`, `rescue`, `review`, and `adversarial-review` commands already write redacted run-ledger events. Background prompt-bearing commands still launch `_job-worker` through a job config file, and the worker writes job state, logs, and timing without appending provider attempt or decision events to the originating run.

This slice wires the existing background worker into the same ledger story. After a background job completes or fails, `polycli debug show <runId>` and `polycli debug explain <runId>` should explain what the worker attempted and why the provider was adopted, failed, or not finalized.

## Problem

The background path loses run context at the process boundary:

- `main()` strips `--run-id` and stores `runId`, `hostSurface`, and raw argv in the parent process `RUN_CONTEXT`.
- `startBackgroundExecution()` writes `{ workspaceRoot, execution, jobId }` to `jobs/<jobId>.config.json`.
- `_job-worker` reads that config and runs `runProviderPromptStreaming()`, but `_job-worker` is an internal command and does not initialize `RUN_CONTEXT`.
- The worker updates `jobs/<jobId>.json`, appends timing, and writes previews to `jobs/<jobId>.log`, but does not write `attempt_started`, `attempt_result`, or `provider_decision`.

The visible result is misleading observability: the foreground run can show that a background job was launched, but the durable run ledger cannot explain the actual provider result.

## Scope

Include:

- Persist a sanitized background run context in the job config.
- Preserve the parent command, `runId`, `hostSurface`, redacted argv, `jobId`, provider, kind, model/default model, cwd, and log path across the worker boundary.
- Record a run event when the foreground process successfully starts the background job.
- Record worker `attempt_started` before the provider call.
- Record worker `attempt_result` after success, provider-level failure, thrown error, or worker-observed cancellation.
- Record worker `provider_decision` for adopted, failed, and worker-observed cancelled outcomes.
- Keep `debug runs/show/explain` based on the existing ledger reader and summarizer.
- Keep existing `status`, `result`, `cancel`, and timing JSON contracts stable.
- Add deterministic tests for successful and failed background worker ledger events.

Exclude:

- No TUI, log viewer, keyboard interaction, watch mode, or terminal layout work.
- No daemon, monitor, server, or stale-process supervisor.
- No provider runtime architecture changes.
- No public promotion of `@bbingz/polycli-runtime`.
- No full prompt, full stdout, full stderr, env dump, or secret persistence.
- No attempt to make killed processes perfectly finalizable when the worker never runs cleanup.
- No release version bump in this implementation slice.

## Event Semantics

### Parent Process

When `startBackgroundExecution()` successfully creates and starts a job, append:

```json
{
  "phase": "job_started",
  "status": "started",
  "command": "review",
  "kind": "review",
  "provider": "qwen",
  "jobId": "job_abc",
  "logFile": "/abs/path/jobs/job_abc.log",
  "hostSurface": "terminal"
}
```

`job_started` is only a scheduling/launch fact. It must not count as `adopted` or `failed`.

### Worker Process

Before calling `runProviderPromptStreaming()`, append:

```json
{
  "phase": "attempt_started",
  "status": "started",
  "command": "review",
  "kind": "review",
  "provider": "qwen",
  "attempt": 1,
  "jobId": "job_abc",
  "logFile": "/abs/path/jobs/job_abc.log"
}
```

After the provider returns, append `attempt_result`:

- `status: "completed"` when `result.ok === true`
- `status: "failed"` when `result.ok !== true`
- `status: "cancelled"` only when the worker observes that the latest job was already cancelled and therefore does not write its result

Then append `provider_decision`:

- `status: "adopted"` for successful worker results
- `status: "failed"` with `reason: "<kind>_failed"` for provider-level failures or thrown errors
- `status: "cancelled"` with `reason: "job_cancelled"` for worker-observed cancellation

If the process is killed before the worker can append final events, the ledger may contain only `job_started` and possibly `attempt_started`. Existing job refresh behavior can mark stale jobs in job state; this slice does not invent a new recovery daemon.

## Run Context Contract

Add a top-level job config field such as:

```json
{
  "runContext": {
    "version": 1,
    "runId": "run-bg",
    "command": "review",
    "commands": ["review"],
    "hostSurface": "terminal",
    "argv": ["review", "qwen", "<prompt:redacted>", "--background", "--json"],
    "jobId": "job_abc"
  }
}
```

Keep it separate from `execution.meta` so provider adapters do not receive ledger-only data. `execution.meta.background` and `execution.meta.jobId` can stay as provider/job metadata because they already exist.

The worker must use this persisted context when writing ledger events. It should not infer the run from `_job-worker` argv, and `_job-worker` should not be added to `RUN_TRACKED_COMMANDS`.

## Redaction

Background ledger events must use the same `redactArgv()` behavior as foreground events:

- Prompt positionals for `ask`, `rescue`, `review`, and `adversarial-review` are redacted.
- Provider/model/run-id/json/background flags remain useful for reproduction.
- Secret-looking adjacent values and inline env-style values remain redacted.
- Ledger events may store previews and byte counts, not full stdout/stderr.

## Debug Behavior

The existing debug commands remain the public inspection surface:

- `debug runs`
- `debug show <runId>`
- `debug explain <runId>`

No new user-facing debug command is required for this slice. `debug explain` should not call `job_started` a final decision. The grouped run story should make it clear when a background job has started but no worker final event exists yet.

## Acceptance Criteria

- `polycli review --background --run-id run-bg ...` persists a job config containing `runContext` with `runId`, `hostSurface`, redacted argv, and `jobId`.
- After a successful background job finishes, `debug show run-bg --json` includes `job_started`, `attempt_started`, `attempt_result`, and `provider_decision` for the same `jobId`.
- Successful worker results produce `provider_decision status=adopted`.
- Provider-level failures or thrown worker errors produce `attempt_result status=failed` and `provider_decision status=failed reason=<kind>_failed`.
- Worker-observed cancellation is not reported as adopted.
- Existing `status`, `result`, `cancel`, and `timing` output shapes remain compatible with current tests.
- Existing foreground ledger tests continue to pass.
- New integration tests cover at least successful and failed background worker ledger paths.

## Implementation Notes

- Prefer a small helper near the existing `recordRunEvent()` path, for example `recordRunEventForContext(workspaceRoot, runContext, base)`, so the foreground and worker paths share event defaults without making `_job-worker` a tracked command.
- Keep config payload changes backward-tolerant. A missing `runContext` should not crash old queued jobs; it should simply skip worker ledger writes.
- Use existing `compactProviderResult(result)` and timing references as sources for error/preview/byte/timing metadata.
- Avoid changes in `state.mjs` and `job-control.mjs` unless tests prove the contract needs them.
- Rebuild generated bundles only after source and tests are green.

## Deferred

- TUI inspector.
- `debug logs` or full log viewer.
- A background supervisor for killed worker recovery.
- Multi-run comparison.
- Release notes and version bump.
