# Background Job Run Ledger Plumbing Implementation Plan

> **For worker:** execute this plan one task at a time. After each task, run the listed verification, commit only when the task is complete, and report changed files plus command results. Do not implement TUI, log viewer, daemon, or release-version changes in this slice.

## Goal

Wire background `_job-worker` executions into the existing redacted run ledger so a run with `--background --run-id <id>` can later explain worker attempts and provider decisions through `debug runs/show/explain`.

## Constraints

- Stay inside `/Users/bing/-Code-/polycli`.
- Keep provider adapters flat and explicit; do not add a provider framework.
- Do not add a long-lived process.
- Do not store full prompts, full stdout/stderr, env, or secrets in the ledger.
- Do not add `_job-worker` to `RUN_TRACKED_COMMANDS`.
- Keep `status`, `result`, `cancel`, and `timing` JSON shapes stable.
- Generated companion bundles are build outputs. Update them only after source/tests are green.

## Task 1 - Add Failing Background Ledger Coverage

Files:

- `plugins/polycli/scripts/tests/integration.test.mjs`
- `plugins/polycli/scripts/tests/run-ledger.test.mjs` only if a new ledger helper needs isolated coverage

Add tests first:

1. Successful background command with explicit `--run-id`.
   - Use an existing deterministic provider fixture pattern from the current integration tests.
   - Start a background `rescue`, `review`, or `ask` command with `--json --background --run-id run-bg-success`.
   - Poll existing `status`/`result` helpers until the job is completed.
   - Read ledger through `debug show run-bg-success --json` or direct ledger helper used elsewhere in the test suite.
   - Assert one `job_started`, one `attempt_started`, one `attempt_result`, and one `provider_decision status=adopted`.
   - Assert all worker events include the same `jobId` and preserve `hostSurface`.

2. Failed background provider path.
   - Use an existing deterministic failing provider fixture or command wrapper already used by foreground ledger tests.
   - Start the background command with `--run-id run-bg-failed`.
   - Wait until job failure is visible through existing job/result surfaces.
   - Assert `attempt_result status=failed`.
   - Assert `provider_decision status=failed reason=<kind>_failed`.
   - Assert the event stores preview/error/byte-count style fields, not full prompt text.

3. Host surface propagation.
   - Set `POLYCLI_HOST_SURFACE=codex-skill` for one background test.
   - Assert worker events keep `hostSurface: "codex-skill"`.

Run:

```bash
node --test plugins/polycli/scripts/tests/integration.test.mjs
```

Expected result before implementation: new tests fail because worker ledger events are absent.

## Task 2 - Persist Run Context In Job Config

Files:

- `plugins/polycli/scripts/polycli-companion.mjs`

Implement a small helper near `recordRunEvent()`:

```js
function buildCurrentRunContext(overrides = {}) {
  if (!RUN_CONTEXT.runId) return null;
  const command = overrides.command || RUN_CONTEXT.command;
  return {
    version: 1,
    runId: RUN_CONTEXT.runId,
    command,
    commands: [command].filter(Boolean),
    hostSurface: RUN_CONTEXT.hostSurface,
    argv: redactArgv(RUN_CONTEXT.rawArgs, { command: RUN_CONTEXT.command }),
    ...overrides,
  };
}
```

Keep the final code aligned with existing style; the snippet is a shape, not a required exact implementation.

In `startBackgroundExecution()`:

- Build `runContext` before writing the config file.
- Add `jobId`, `provider`, `kind`, `model`, `defaultModel`, and `logFile` to the context.
- Write it as top-level `runContext` in the job config.
- Do not put ledger-only context into `execution.meta`.
- Missing `RUN_CONTEXT.runId` should still allow jobs to start; it only means no background ledger events are written.

Run:

```bash
node --test plugins/polycli/scripts/tests/integration.test.mjs
```

Expected result: tests may still fail until worker writers are added, but existing background job behavior must not regress.

## Task 3 - Add Shared Ledger Writer For Explicit Context

Files:

- `plugins/polycli/scripts/polycli-companion.mjs`

Add a helper such as:

```js
async function recordRunEventForContext(workspaceRoot, runContext, base = {}) {
  if (!runContext?.runId) return null;
  const command = base.command || runContext.command;
  return appendRunLedgerEvent(workspaceRoot, {
    runId: runContext.runId,
    hostSurface: runContext.hostSurface,
    argv: runContext.argv || [],
    command,
    commands: Array.from(new Set([...(runContext.commands || []), command].filter(Boolean))).sort(),
    ...base,
  });
}
```

Then make existing `recordRunEvent()` delegate to this helper by passing `buildCurrentRunContext()`.

Acceptance for this task:

- Foreground ledger events remain unchanged except for harmless command ordering consistency.
- Worker code can write events without mutating global `RUN_CONTEXT`.

Run:

```bash
node --test plugins/polycli/scripts/tests/run-ledger.test.mjs plugins/polycli/scripts/tests/integration.test.mjs
```

## Task 4 - Record `job_started` From Parent Process

Files:

- `plugins/polycli/scripts/polycli-companion.mjs`

In `startBackgroundExecution()` after the child process is spawned and the running job is persisted, append a `job_started` event when `runContext` exists:

- `phase: "job_started"`
- `status: "started"`
- `provider`
- `kind`
- `jobId`
- `model`
- `defaultModel`
- `logFile`
- `pid`

Do not write a `provider_decision` from the parent process.

Run:

```bash
node --test plugins/polycli/scripts/tests/integration.test.mjs
```

## Task 5 - Record Worker Attempt Start And Final Success/Failure

Files:

- `plugins/polycli/scripts/polycli-companion.mjs`

In `runJobWorker(rawArgs)`:

1. Read `runContext` from the config payload.
2. Before `runProviderPromptStreaming()`, append `attempt_started` when `runContext` exists:
   - `phase: "attempt_started"`
   - `status: "started"`
   - `attempt: 1`
   - `provider`
   - `kind`
   - `jobId`
   - `model`
   - `defaultModel`
   - `logFile`

3. After the provider returns and the job write succeeds:
   - Append timing first if the existing code needs the timing record persisted before the ledger reference is meaningful.
   - Append `attempt_result`.
   - Append `provider_decision`.

Suggested mapping:

```text
result.ok === true
  attempt_result.status = completed
  provider_decision.status = adopted

result.ok !== true
  attempt_result.status = failed
  provider_decision.status = failed
  provider_decision.reason = <kind>_failed
```

Include available fields already used by foreground events where possible:

- `timingRef`
- `error`
- `preview`
- `stdoutBytes`
- `stderrBytes`
- `durationMs`
- `model`
- `defaultModel`
- `jobId`
- `logFile`

Do not inline full job logs.

Run:

```bash
node --test plugins/polycli/scripts/tests/integration.test.mjs
```

## Task 6 - Record Thrown Errors And Worker-Observed Cancellation

Files:

- `plugins/polycli/scripts/polycli-companion.mjs`

In the `catch` path:

- Preserve existing job failure behavior.
- If the job write succeeds, append:
  - `attempt_result status=failed`
  - `provider_decision status=failed reason=<kind>_failed`
  - `error` from the thrown error message, redacted/truncated consistently with existing preview rules

In `!write.written` paths:

- If the latest job is available and has `status: "cancelled"`, append:
  - `attempt_result status=cancelled`
  - `provider_decision status=cancelled reason=job_cancelled`
- If there is no latest job, skip final ledger writes rather than inventing a result.

Do not make cancellation tests flaky. If a deterministic worker-observed cancellation test is hard with the existing harness, cover the helper/branch with a focused fixture or leave cancellation as a documented residual after success/failure paths are covered.

Run:

```bash
node --test plugins/polycli/scripts/tests/integration.test.mjs
```

## Task 7 - Update Docs And Task State

Files:

- `tasks/terminal-cli-tui-observability.md`
- `docs/roadmap.md`
- `docs/release-notes-v0.6.7.md` only if wording needs to distinguish released foreground behavior from this newly implemented follow-up

When implementation is complete:

- Mark the background worker ledger task done.
- Keep TUI inspector open.
- State that this slice adds background worker ledger events, not a new UI.
- Do not bump release metadata unless the user explicitly starts release prep.

Run:

```bash
git diff --check
```

## Task 8 - Build Bundles And Run Verification

Files:

- Generated companion bundles after `npm run build:plugins`

Run in order:

```bash
node --test plugins/polycli/scripts/tests/run-ledger.test.mjs plugins/polycli/scripts/tests/integration.test.mjs
npm run build:plugins
node --test plugins/polycli/scripts/tests/run-ledger.test.mjs plugins/polycli/scripts/tests/integration.test.mjs plugins/polycli/scripts/tests/host-packaging.test.mjs scripts/tests/validate-plugin-bundles.test.mjs
npm test
npm run release:check
```

Expected final state:

- Focused tests pass.
- Full test suite passes.
- Release check passes.
- Bundles are regenerated and byte-identical validation passes.
- No version/tag/publish changes are made.

## Reporting Contract

Report back with:

1. Changed files.
2. Test-first evidence: which test failed before implementation.
3. Final verification command outputs and pass counts.
4. Any deviation from this plan.
5. Remaining open work, especially TUI inspector and killed-worker perfect recovery.
