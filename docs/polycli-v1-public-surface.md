# polycli v1 Public Surface

## Status

`@bbingz/polycli-utils` and `@bbingz/polycli-timing` are the v1 public library surface, published to npm from v0.5.0 onward. `@bbingz/polycli` is the v1 public terminal/operator surface (a PATH-callable wrapper around the bundled companion). `@bbingz/polycli-runtime` and provider adapters live in this repo but remain internal (`private: true`): they are bundled into host plugins and the terminal CLI, and are not part of the v1 npm contract.

The repo now contains provider runtime code for host plugin builds, but that code is outside the v1 public package surface. The public contract is intentionally limited to utility helpers, timing semantics, and the terminal CLI's command vocabulary.

## v1 Package Surface

### `@bbingz/polycli-utils`

Stable root exports in v1:

- `parseArgs()`
- `splitRawArgumentString()`
- `runCommand()`
- `runCommandChecked()`
- `binaryAvailable()`
- `formatCommandFailure()`
- `terminateProcessTree()`
- `createLineDecoder()`
- `ensureParentDir()`
- `writeFileAtomic()`
- `writeJsonAtomic()`
- `withLockfile()`
- `LockfileTimeoutError`
- `appendNdjson()`
- `readNdjson()`
- `tailNdjson()`
- `UUID_SESSION_ID_REGEX`
- `matchSessionId()`
- `resolveSessionId()`
- `parseStreamJsonLine()`
- `parseStreamJsonText()`

Stable subpath exports in v1:

- `@bbingz/polycli-utils/args`
- `@bbingz/polycli-utils/process`
- `@bbingz/polycli-utils/stream`
- `@bbingz/polycli-utils/atomic-save`
- `@bbingz/polycli-utils/ndjson`
- `@bbingz/polycli-utils/session-id`
- `@bbingz/polycli-utils/parse-stream-json`

Non-goals for this package:

- provider-specific protocol adapters
- canonical event schemas
- retry/rate-limit/auth logic tied to one provider
- shared session inheritance or runtime orchestration

### `@bbingz/polycli-timing`

Stable root exports in v1:

- `TIMING_SCHEMA_VERSION`
- `TIMING_METRIC_NAMES`
- `TIMING_METRIC_STATUSES`
- `TIMING_RUNTIME_PERSISTENCE`
- `TIMING_MEASUREMENT_SCOPES`
- `TIMING_SCHEMA_URL`
- `readTimingSchema()`
- `validateTimingRecord()`
- `calculatePercentiles()`
- `aggregateTimingRecords()`

Stable subpath exports in v1:

- `@bbingz/polycli-timing/schema`

Stable semantics in v1:

- `unsupported`, `missing`, `zero`, and `measured` are distinct states and must not be collapsed.
- `runtimePersistence` and `measurementScope` are part of the public contract.
- Aggregation is capability-aware and must preserve state distinctions.
- Aggregation also reports per-provider `runtimePersistenceCounts` and `measurementScopeCounts` so mixed request/session/daemon or request/turn/job data is visible instead of silently blended.

### `@bbingz/polycli` (terminal CLI)

`@bbingz/polycli` is the v1 terminal/operator entry point. The stable contract is:

- A `polycli` bin that forwards `argv` to the bundled companion.
- The companion subcommand vocabulary: `setup`, `health`, `ask`, `rescue`, `review`, `adversarial-review`, `status`, `result`, `cancel`, `timing`, `debug`.
- Global `--run-id <id>` (or `POLYCLI_RUN_ID` env var) for joining a sequence of commands into one ledger run.
- `review` and `adversarial-review` accept an optional `--max-diff-bytes <n>`. **Default is no cap** — the full git diff is sent to the provider. Pass a positive integer to opt into byte-truncation when the caller knows its own context budget is tight; the prompt then includes a `Diff truncated to N bytes before sending to provider.` notice. Zero or negative values are rejected with `code: "invalid_max_diff_bytes"`.

Non-goals for this package:

- exposing provider runtime classes or registry as importable JS API
- a programmatic Node API distinct from the CLI subcommands
- guaranteeing exact text-mode output across versions (use `--json` for machine consumers)

### `polycli tui`

Read-only terminal inspector over run-ledger data. Supports `--run-id <id>` and `--history <count>`. It does not run, cancel, retry, or mutate provider jobs. When ledger events include `logFile`, the inspector renders a local path pointer only; it does not read or print log contents.

### `@bbingz/polycli-runtime`

`@bbingz/polycli-runtime` is an internal bundler input, not a public npm contract. Provider adapters may change as host plugin needs evolve; do not import them as stable API unless they are explicitly promoted in a future major-version surface document.

## Runtime And Provider Split

This keeps v1 small, testable, and publishable without pretending the provider model is a public framework.

## Provider Permission Defaults

`ask` and `rescue` default to YOLO/auto-approve for every provider that exposes a permission flag. The intent is to match common harnessed-agent practice (one-shot CLI calls in an automated wrapper, not interactive sessions where humans approve tool calls). `review` and `adversarial-review` are locked to conservative / read-only / plan mode for every provider regardless — see the override table below.

| Provider | Default flag in `ask` / `rescue` | Effective stance |
|---|---|---|
| `claude` | `--permission-mode bypassPermissions` | YOLO |
| `gemini` | `--approval-mode yolo` | YOLO |
| `qwen` | `--approval-mode yolo` | YOLO |
| `kimi` | `--yolo` | YOLO |
| `cmd` | `--yolo` (alias for `--dangerously-skip-permissions`) | YOLO |
| `copilot` | `--allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user` | YOLO |
| `opencode` | `--dangerously-skip-permissions` | YOLO |
| `pi` | (no permission flag; tools are default-enabled upstream) | YOLO-equivalent |
| `mini-agent` (MiniMax) | (config-driven via `~/.mini-agent/config/config.yaml`) | user-controlled |

Callers that need a non-YOLO stance pass it explicitly through the runtime — for example `permissionMode: "plan"` for claude, `approvalMode: "plan"` for gemini/qwen, `yolo: false` for kimi/cmd, or `skipPermissions: false` for opencode.

`review` / `adversarial-review` ignore the YOLO defaults above and instead force a conservative stance per provider (`--max-turns 1 --tools ""` for claude, `approvalMode: "plan"` for gemini and qwen, `--no-tools` for pi, `--permission-mode plan` for cmd, `--agent plan` + deny-permission config for opencode, `--excluded-tools <list>` for copilot, tools-disabled config for minimax). `assertNoReviewConstraintOverride` rejects any caller attempt to thread YOLO flags back into review.

## Run Ledger Debug Examples

The redacted, append-only run ledger lets `polycli debug` answer "what happened in this run, and why was that provider not adopted?" without re-running the provider. The two narratives below come from the original Codex multi-provider failure case (Q6 source) and are reproducible from the persisted ledger alone.

### Pin a multi-provider run to one `runId`

Use `--run-id` (or `POLYCLI_RUN_ID`) so a sequence of `health` / `ask` / `review` calls share one ledger run:

```bash
polycli health --provider cmd --json --run-id run-demo
polycli ask --provider cmd --run-id run-demo "..."
polycli ask --provider cmd --run-id run-demo "..."
polycli health --provider pi --json --run-id run-demo
```

`debug runs` lists ledger runs with their adopted/skipped/failed counts; `debug show` returns the raw events for one run; `debug explain` summarizes provider decisions:

```bash
polycli debug runs
polycli debug show run-demo --json
polycli debug explain run-demo
```

### Case 1 — `cmd` health passed, but two `ask` attempts failed

Narrative shape of `debug show run-demo --json` for the `cmd` portion of the run (event values redacted to schema slots, not real provider output):

```json
{
  "phase": "health_result",
  "provider": "cmd",
  "status": "passed",
  "reason": "health_passed"
}
{
  "phase": "provider_decision",
  "provider": "cmd",
  "status": "passed",
  "reason": "health_passed"
}
{
  "phase": "attempt_started",
  "provider": "cmd",
  "kind": "ask",
  "attempt": { "ordinal": 1 }
}
{
  "phase": "attempt_result",
  "provider": "cmd",
  "kind": "ask",
  "status": "failed",
  "stdoutBytes": 0,
  "stderrBytes": 0,
  "preview": null,
  "error": { "message": "<short error preview>" }
}
{
  "phase": "provider_decision",
  "provider": "cmd",
  "status": "failed",
  "reason": "ask_failed"
}
```

A second `ask` attempt produces another `attempt_started` / `attempt_result status=failed` / `provider_decision status=failed reason=ask_failed` triple. Two failed `provider_decision` events for `cmd` mean it was not adopted, even though `health` passed first.

`debug explain run-demo` collapses the decisions into one line per `(provider, status, reason)`:

```text
cmd passed (health_passed)
cmd failed (ask_failed)
cmd failed (ask_failed)
```

### Case 2 — `pi` health failed, so it was skipped before any prompt-bearing work

For the `pi` portion of the same run:

```json
{
  "phase": "health_result",
  "provider": "pi",
  "status": "failed",
  "reason": "health_failed",
  "error": { "message": "<short error preview>" }
}
{
  "phase": "provider_decision",
  "provider": "pi",
  "status": "skipped",
  "reason": "health_failed"
}
```

There are no `attempt_started` / `attempt_result` events for `pi` because `health` failed before any `ask` / `review` / `rescue` was issued. `debug explain` will only show:

```text
pi skipped (health_failed)
```

### Field-shape reminders

The ledger is intentionally narrow:

- `argv` is redacted: prompt and focus positionals collapse to `<prompt:redacted>`, secret-bearing options collapse to `<secret:redacted>`. `provider`, `model`, `json`, `background`, and `run-id` stay visible.
- Full prompt text, full stdout/stderr, and environment variables are never persisted. Failure reasoning uses `preview`, `stdoutBytes`, `stderrBytes`, and a truncated `error.message`.
- Background-job runs add `job_started` (parent) and worker-side `attempt_started` / `attempt_result` / `provider_decision` events under the same `runId` and `jobId`.
- Worker-observed cancellation produces `attempt_result status=cancelled` plus `provider_decision status=cancelled reason=job_cancelled`.
