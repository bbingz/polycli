# Agent-Native CLI Control Plane Design

Status: proposed

Date: 2026-07-15

## Objective

Make Polycli a self-describing, deterministic, agent-safe control plane without turning it into a daemon, workspace manager, remote runtime, or general workflow engine.

The design adopts the strongest CLI-contract ideas observed in the locally installed Orca CLI on 2026-07-15:

- one declarative command catalog;
- offline machine-readable command discovery;
- strict argument handling with actionable suggestions;
- typed selectors and waits;
- cursor-based bounded observation;
- a versioned operational JSON envelope;
- durable identity separation between the caller, invocation, job, attempt, worker, and upstream provider session.

The result must preserve Polycli's Path B architecture: provider adapters stay flat and explicit, the runtime remains an internal bundle input, and hosts or external workflow systems continue to own orchestration.

## Decision Summary

Implement the design in four ordered delivery gates:

| Gate | Priority | Outcome |
|---|---:|---|
| A | P0 | Canonical command registry, strict command parsing, generated help, generated host validation, and offline `agent-context` |
| B | P0 | Invocation/attempt/session identity split, attempt-correct projections, and terminalization of all failure paths |
| C | P1 | Opt-in JSON v2 envelope, typed errors, explicit job selectors, and typed job waits |
| D | P1 | Redacted ledger cursor API through `debug tail` |

Two ideas remain conditional and are not part of Gates A-D:

- P2 `skills list/get` requires evidence that agents need version-matched guidance outside the shipped host skills.
- P2 lineage fields require a real host-owned workflow integration. They do not authorize a Polycli task DAG, scheduler, inbox, gate engine, or coordinator.

No gate may be implemented by introducing a shared provider base class, provider protocol framework, or unified provider event schema.

## Current Facts

The current implementation has the right execution foundation but not yet one canonical agent-facing command contract:

- `plugins/polycli/scripts/polycli-companion.mjs` manually defines root help, per-command parser configuration, dispatch, error classification, and output calls.
- `scripts/validate-host-command-map.mjs` repeats the top-level command list and regex-scrapes the dispatcher, skills, OpenCode surface, and documentation.
- `packages/polycli-utils/src/args.js` intentionally treats unknown option-looking tokens as positionals. This is a public utility behavior and cannot be changed globally by this feature.
- prompt commands join remaining positionals into prompt text, so a misspelled option such as `--modle x` can become part of the prompt.
- all command-specific `--help` requests currently render the same root usage block.
- the terminal wrapper has a separate manual `tui` route; the TUI also has its own strict local parser.
- provider runtime capabilities already exist as static data in `packages/polycli-runtime/src/registry.js`.
- review safety already has a provider-specific source in `packages/polycli-runtime/src/review-flags.js`.
- the run ledger already provides redacted, per-workspace, append-only event storage with stable `eventId` values and a 2 MB retention ceiling.
- background jobs already have durable `jobId`, terminal intent recovery, PID identity checks, cancellation, timing, and result envelopes.
- the current job field `sessionId` means host session ownership while a job is active and provider session identity after completion.
- ledger projections do not have an explicit invocation or attempt identity, so repeated attempts from one provider under the same `runId` can be conflated.

These facts mean the control plane should be added above the existing job/runtime architecture, not replace it.

## Goals

1. Give agents a pure offline description of the installed Polycli command surface.
2. Make help, parsing, suggestions, machine discovery, and host validation derive from the same command metadata.
3. Reject misspelled options before any provider request or state mutation.
4. Preserve literal prompt tokens that begin with `-` through the existing `--` delimiter.
5. Keep current `--json` payloads compatible while offering a coherent opt-in JSON v2 envelope.
6. Make job, invocation, attempt, host session, provider session, and worker identity unambiguous.
7. Ensure every started attempt reaches a durable terminal ledger pair or remains honestly unfinished.
8. Let agents observe redacted ledger progress incrementally without rereading the full ledger or raw job logs.
9. Keep every new discovery and inspection path bounded, short-lived, and safe to call headlessly.

## Non-Goals

- No daemon, server, monitor, background supervisor, or persistent Polycli runtime.
- No repo, project, worktree, editor, PTY, browser, computer-use, emulator, pairing, or remote-runtime ownership.
- No scheduler, cron/RRULE service, orchestration inbox, task DAG, decision gate, or coordinator loop.
- No shared `BaseProvider`, provider inheritance tree, or provider protocol framework.
- No unified provider event model. Ledger control events remain distinct from provider-specific protocol events.
- No automatic reading or embedding of full provider logs in agent responses.
- No full prompts, environment dumps, tokens, or secrets in the ledger or `agent-context`.
- No change to the public default behavior of `@bbingz/polycli-utils/args`.
- No silent migration of existing `--json` consumers to the v2 envelope.
- No dynamic plugin loading or remote skill download.

## Architecture

```text
Claude / Codex / Copilot / OpenCode / Terminal
                       |
                       v
          declarative command registry
             |       |       |
             |       |       +--> agent-context + JSON schemas
             |       +----------> generated help + suggestions
             +------------------> strict parser + host validation
                       |
                       v
              explicit handler map
                       |
                       v
       existing job / ledger / review / timing code
                       |
                       v
          flat provider runtime registry/adapters
```

The command registry describes the CLI. It does not execute commands and does not own provider behavior.

The handler map remains explicit. Each registered executable command path must have exactly one handler binding, and every handler binding must refer to exactly one registered command path. This removes the current `if (command === ...)` discovery mechanism without creating a command framework.

### Canonical Module

Add:

```text
plugins/polycli/scripts/lib/command-registry.mjs
```

It exports only deeply frozen, JSON-serializable metadata and pure helpers:

```js
export const COMMAND_SURFACE_VERSION = 1;
export const COMMAND_DEFINITIONS = Object.freeze([...]);
export const ERROR_DEFINITIONS = Object.freeze([...]);
export const OUTPUT_SCHEMA_DEFINITIONS = Object.freeze({...});

export function listCommandDefinitions(options = {}) {}
export function resolveCommandPath(argv, options = {}) {}
export function getCommandDefinition(path) {}
export function assertCommandRegistry() {}
```

The module must not import state, job control, provider processes, filesystem mutation, network clients, or command handlers.

### Handler Binding

`polycli-companion.mjs` owns a small explicit binding map:

```js
const COMMAND_HANDLERS = Object.freeze({
  setup: runSetup,
  health: runHealth,
  ask: runAsk,
  rescue: runRescue,
  review: (args) => runReviewCommand(args, { adversarial: false }),
  "adversarial-review": (args) => runReviewCommand(args, { adversarial: true }),
  status: runStatus,
  result: runResult,
  cancel: runCancel,
  timing: runTiming,
  "debug.runs": runDebugRuns,
  "debug.show": runDebugShow,
  "debug.explain": runDebugExplain,
  "debug.tail": runDebugTail,
  "sessions.list": runSessionsList,
  "sessions.purge": runSessionsPurge,
  "agent-context": runAgentContext,
  "_stop-review-gate": runStopReviewGate,
  "_job-worker": runJobWorker,
});
```

Gate A splits the current `runDebugCommand` and `runSessionsCommand` switches into the leaf handlers shown above. Registry validation compares registry executable paths and handler keys as sets. The registry must not contain function references.

### Registered Surfaces

Gate A registers these shared public top-level commands:

- `agent-context`
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
- `debug`
- `sessions`

Nested paths:

- `debug runs`
- `debug show`
- `debug explain`
- `debug tail` in Gate D
- `sessions list`
- `sessions purge`

Terminal-only `tui` is registered as a visible delegated command with `surfaces: ["terminal"]` and `dispatchTarget: "terminal-wrapper"`. Its top-level existence, summary, usage, and options are canonical registry data, while its runtime continues to be `polycli-tui.mjs`.

Internal `_stop-review-gate` and `_job-worker` entries use `visibility: "internal"`. They never appear in root help, host command docs, or the public `agent-context` command list unless `includeInternal` is explicitly requested by an internal test helper. There is no public CLI flag for exposing them.

### Registry Entry Contract

Every command or leaf subcommand uses this serializable shape:

```js
{
  id: "ask",
  path: ["ask"],
  aliases: [],
  visibility: "public",             // public | internal
  surfaces: [
    "claude-plugin",
    "codex-skill",
    "copilot-skill",
    "opencode-plugin",
    "terminal"
  ],
  dispatchTarget: "companion",      // companion | terminal-wrapper
  summary: "Ask one provider a prompt.",
  usage: "polycli ask [provider] [options] <prompt...>",
  argumentMode: "provider-prompt-tail",
  runTracked: true,
  effects: {
    providerInvocation: true,
    readsWorkspace: true,
    writesLocalState: true,
    destructive: false
  },
  options: [/* option definitions */],
  positionals: [/* positional definitions */],
  constraints: [/* machine-readable conflicts and requirements */],
  examples: [/* argv arrays plus descriptions */],
  outputs: {
    text: "execution-text-v1",
    jsonV1: "execution-result-v1",
    jsonV2: "execution-result-v2"
  },
  errors: ["missing_provider", "unknown_provider", "missing_prompt", "provider_failed"],
  exitCodes: [0, 1]
}
```

The example shows the end-state entry. During Gate A, `jsonV2` is `null`; Gate C adds the reference only when that command's v2 serializer and schema tests pass. `debug tail` is absent from the installed registry until Gate D. Installed metadata never advertises a planned but unavailable surface.

Every option definition uses:

```js
{
  name: "model",
  aliases: ["m"],
  type: "string",                   // boolean | string | integer | enum
  forms: ["--model <model>", "-m <model>"],
  required: false,
  repeatable: false,
  default: null,
  enumValues: null,
  enumSource: null,
  description: "Override the provider model.",
  conflictsWith: [],
  requires: [],
  sensitive: false
}
```

Positionals declare `name`, `required`, `variadic`, `sensitive`, and `role`. Provider-first compatibility is represented explicitly with `role: "provider-or-prompt"`; it must not be inferred from help text.

Registry validation fails on:

- duplicate command IDs, paths, or aliases;
- duplicate long or short option names within a command;
- an alias colliding with another command or option;
- unresolved output schema or error references;
- a public command with no summary, usage, example, output contract, or surface;
- a command marked `runTracked` that omits the shared `run-id` option;
- a non-terminal command that declares the `terminal`-only `tui` options;
- a destructive command without an explicit confirmation constraint;
- a handler/registry path mismatch.

## Strict Argument Contract

### Compatibility Boundary

Do not change the default behavior of public `parseArgs(argv, config)`.

Extend it with an opt-in policy:

```js
parseArgs(argv, {
  ...config,
  unknownOptionMode: "error", // current default remains "positional"
  rejectDuplicateOptions: true
});
```

Only registered Polycli commands enable strict mode. Existing external callers of `@bbingz/polycli-utils/args` keep the current lenient behavior.

### Parsing Rules

The parser pipeline is fixed:

1. create `invocationId`;
2. pre-scan only exact output-mode forms (`--json`, `--json=true|false`, `--json-v2`, `--json-v2=true|false`) so even parse errors use the requested machine format;
3. resolve the longest registered command path: `debug tail` before `debug`;
4. parse only options declared for that path plus applicable global options;
5. resolve and validate `runId` only after the full command parse succeeds;
6. create state/ledger context and call the handler.

An invalid command line performs no provider request and no state, cache, or ledger write.

Argument rules:

1. Reject an unknown long or short option before calling a handler.
2. Reject duplicate non-repeatable options, including long/short alias combinations.
3. Boolean options accept bare form, `=true`, or `=false`; other inline values are invalid.
4. A value option accepts `--name=value`, `--name value`, `-mvalue`, or `-m value` when the short alias is declared.
5. If a value option is followed by another recognized option, report the value as missing rather than consuming the option.
6. Short-option clusters are unsupported. `-abc` is valid only when `a` is a declared value option and `bc` is its value; otherwise it is rejected.
7. `--` ends option parsing. Every following token is positional and may begin with `-`.
8. Options may appear before, between, or after ordinary positionals until `--`.
9. Unknown command and subcommand errors use the same suggestion engine as options.
10. Suggestions use bounded edit distance and prefix matching only against valid values for the current command/surface. They never suggest internal commands.

The pre-scan rejects both output modes being true. A false form does not request that mode. No other option is interpreted during pre-scan.

Example:

```bash
polycli ask --provider qwen --modle qwen3-coder hello
# invalid_argument; suggestion: --model

polycli ask --provider qwen -- --modle is literal prompt text
# valid; prompt begins with "--modle"
```

This is a deliberate CLI bug fix. The old behavior for undocumented option-looking prompt tokens is preserved through `--`, documented in help, and covered by release notes when implemented.

### Global Options

The registry defines global options once and attaches them by applicability:

- `--help`, `-h`: every public command path;
- `--json`: commands with a legacy JSON contract;
- `--json-v2`: operational commands after Gate C;
- `--run-id <id>`: run-tracked commands only.

`--json` and `--json-v2` conflict. `agent-context --json` is a discovery document and does not use the operational v2 envelope.

## Generated Help

Replace `printUsage()` with pure renderers over the registry:

```js
renderRootHelp({ hostSurface })
renderCommandHelp(commandDefinition, { hostSurface })
```

Required behavior:

- `polycli --help` lists public commands available on the detected host surface.
- `polycli ask --help` shows only `ask` usage, options, positional rules, effects, and examples.
- `polycli debug show --help` resolves the full nested path.
- terminal root help includes `tui`; non-terminal host help does not.
- an `unknown` host surface receives the shared companion command set and excludes terminal-only commands.
- help always uses the public executable noun `polycli`, never `polycli-companion.mjs`.
- help generation performs no provider probe, state read, filesystem write, or network call.
- examples are rendered from argv arrays, not duplicated prose strings.

The host-specific command/skill documents may retain richer operational guidance. Their supported command inventories and example command names are validated against the registry rather than treated as another source of truth.

## Offline `agent-context`

### Discovery Command

```bash
polycli agent-context --json
```

Without `--json`, render a compact human summary and point to `--json` for the complete contract.

The JSON path is a direct discovery document, not an operational envelope. It must:

- work when no provider binary is installed;
- work with no auth or network access;
- work when no Polycli state directory exists;
- create no state directory, cache, ledger event, timing record, or job;
- avoid timestamps so repeated calls against the same build and host surface are byte-stable;
- filter commands by host surface;
- contain no environment values, paths outside static examples, credentials, or local job state.

### Build Identity

`scripts/build-plugin-bundles.mjs` reads the release-facing `@bbingz/polycli` package version and injects it into all five byte-identical companion bundles. The existing release-manifest guard remains the authority that verifies host/package version alignment; the bundle build does not duplicate that policy.

Unbundled development execution reports `version: "0.0.0-dev"` and `versionSource: "development"`. It must not shell out to Git or search parent directories at runtime.

### Discovery Schema

`agent-context` schema version 1:

```json
{
  "schemaVersion": 1,
  "commandSurfaceVersion": 1,
  "build": {
    "version": "0.6.29",
    "versionSource": "bundled-release",
    "nodeMinimum": "20"
  },
  "hostSurface": "terminal",
  "offline": true,
  "commands": [],
  "providers": [],
  "outputSchemas": {},
  "errors": [],
  "exitCodes": [],
  "features": {
    "legacyJson": true,
    "jsonEnvelopeV2": false,
    "ledgerCursor": false,
    "skillsDiscovery": false,
    "workflowRuntime": false
  }
}
```

The `0.6.29` value is the repository snapshot on the design date, not a constant in the schema. Implemented output always uses the injected installed package version.

`features` describes the installed build, not the roadmap. A field becomes `true` only in the gate that implements it.

Each command entry exposes:

- `id`, `path`, aliases, visibility, surfaces;
- summary, usage, argument mode, effects;
- option and positional definitions;
- constraints and examples;
- output schema references;
- possible typed errors and exit codes.

### Provider Capability Composition

Provider discovery composes two existing static sources without probing providers:

1. flat runtime capabilities from `packages/polycli-runtime/src/registry.js`;
2. review safety from `packages/polycli-runtime/src/review-flags.js`.

Add a pure JSON-safe descriptor export to the existing runtime index and update the exact export test in the same change. The existing `"."` export already exposes `src/index.js`, so this design does not add a new package export path.

Each provider entry has:

```json
{
  "id": "qwen",
  "runtimeOperations": ["prompt"],
  "commandSupport": {
    "setup": true,
    "health": true,
    "ask": true,
    "rescue": true,
    "review": true,
    "adversarialReview": true
  },
  "capabilities": {
    "streaming": true,
    "sessionResume": true,
    "structuredOutput": true,
    "authProbeCost": "model",
    "runtimePersistence": "session",
    "timing": {
      "ttft": true,
      "gen": true,
      "tail": true,
      "tool": true
    }
  },
  "reviewSafety": {
    "mode": "enforced",
    "stopReviewGate": "enforced"
  }
}
```

`reviewSafety.mode` is exactly one of:

- `enforced`: an independently verified runtime restriction enforces the read-only contract;
- `prompt_only`: review relies on prompt instruction because no hard restriction is verified;
- `unsupported`: ordinary review is rejected.

The Gate A static mapping is:

- `enforced`: `claude`, `gemini`, `qwen`, `copilot`, `opencode`, `pi`, `cmd`, `grok`;
- `prompt_only`: `kimi`, `minimax`;
- `unsupported`: `agy`.

Only `enforced` providers are eligible for the automatic stop-review gate. A future mapping change requires the existing provider-specific drift evidence and consistency tests; `agent-context` never upgrades safety from availability or prompt wording.

Extend `REVIEW_FLAG_EXPECTATIONS` with an explicit `reviewSafety` field instead of inferring it from flag arrays. A consistency test ensures `reviewUnsupported`, `reviewSafety`, and `stopReviewGateSafety` cannot contradict one another.

Do not expose raw provider invocation flags, credentials, detected versions, auth state, cached default models, or availability in `agent-context`. Those remain operational `setup`/`health` concerns.

### Output Schemas

The registry stores named, serializable JSON Schema fragments for machine outputs. Command entries refer to schemas by stable ID rather than embedding copies.

Required schema IDs include:

- `polycli.agent-context.v1`
- `polycli.error.v2`
- `polycli.envelope.v2`
- per-command v2 result schemas;
- descriptive legacy v1 schema IDs for current outputs.

Legacy schemas are descriptive compatibility records. The implementation does not reshape legacy output merely to make it fit a new schema.

All `$ref` targets must resolve in registry tests. Representative command fixtures must validate against their declared schema. Runtime output validation is not added to hot paths.

## Typed Error Catalog

Replace message-prefix classification as the primary source with explicit error objects at validation and command boundaries:

```js
new PolycliCliError({
  code: "invalid_argument",
  message: "Unknown option '--modle' for 'ask'.",
  exitCode: 1,
  data: {
    command: ["ask"],
    argument: "--modle",
    validFlags: ["--provider", "--model", "--background", "--json"],
    suggestions: ["--model"]
  },
  nextSteps: ["Run `polycli ask --help`."]
});
```

The initial catalog includes:

- `invalid_argument`
- `unknown_command`
- `unknown_subcommand`
- `missing_provider`
- `unknown_provider`
- `missing_prompt`
- `invalid_scope`
- `job_not_found`
- `ambiguous_selector`
- `no_active_job`
- `no_completed_job`
- `cursor_expired`
- `provider_failed`
- `ledger_persist_failed`
- `worker_identity_unverified`
- `cancel_failed`
- `internal_error`

Provider-specific failure classes remain provider result data. The CLI catalog must not flatten provider protocols into one event taxonomy.

`provider_failed` is reserved for a provider/runtime path that throws or otherwise fails to return the normal compact provider result. A normal provider result with inner `ok: false` remains an authoritative command result and is not rewritten as a top-level CLI error.

Text mode prints the message, suggestions, and next steps to stderr. Legacy `--json` keeps its established top-level shape for existing commands. JSON v2 serializes the complete typed error.

Unknown thrown errors are wrapped as `internal_error`; their public message is bounded and must not expose stack traces or environment data. Tests and debug logs may retain stack details in controlled test output, not in the public envelope.

## JSON Envelope v2

### Activation

Gate C adds:

```bash
polycli <command> --json-v2
```

It never becomes an alias for `--json` within this spec. Host adapters continue using legacy output until each adapter is explicitly migrated and tested.

### Success Shape

```json
{
  "schemaVersion": 2,
  "id": "inv_01J...",
  "ok": true,
  "result": {},
  "_meta": {
    "command": ["status"],
    "hostSurface": "terminal",
    "workspaceSlug": "polycli-abc123",
    "runId": null,
    "jobId": "review_abc123"
  }
}
```

### Error Shape

```json
{
  "schemaVersion": 2,
  "id": "inv_01J...",
  "ok": false,
  "error": {
    "code": "invalid_argument",
    "message": "Unknown option '--modle' for 'ask'.",
    "data": {
      "argument": "--modle",
      "validFlags": ["--model"],
      "suggestions": ["--model"]
    },
    "nextSteps": ["Run `polycli ask --help`."]
  },
  "_meta": {
    "command": ["ask"],
    "hostSurface": "terminal",
    "workspaceSlug": null,
    "runId": null,
    "jobId": null
  }
}
```

Invariants:

- `id` is the command invocation ID and never a worker PID or provider session ID.
- success has `result` and no `error`;
- failure has `error` and no `result`;
- `_meta` contains only identifiers already safe for machine output;
- omitted or unavailable identity values are `null`, not fabricated;
- no daemon/runtime ID is introduced because Polycli has no daemon;
- no timestamp is required in the envelope; durable event timestamps remain in the ledger.

### Meaning Of `ok`

`ok` means the command parsed and produced an authoritative control-plane result. It does not mean the requested business condition is true.

Therefore:

- `health` with no healthy providers returns `ok: true`, contains `anyHealthy: false`, and retains exit code 2;
- `status --wait` timeout returns `ok: true`, contains `wait.timedOut: true`, and retains exit code 2;
- cancellation of an already terminal job returns `ok: true`, `cancelled: false`, and retains the current soft-condition exit behavior;
- invalid input, missing job, unverified worker identity, provider invocation failure without a normal result, and internal failure return `ok: false`.

The exit code remains an independent shell contract and is listed by `agent-context`.

Gate C fixes the v2 shell contract as follows while leaving legacy JSON behavior untouched:

| Exit | v2 meaning |
|---:|---|
| 0 | command returned an authoritative result, including a normal provider result whose inner `ok` is false |
| 1 | invalid input, missing selector target, provider/runtime throw without a normal result, or internal failure |
| 2 | authoritative soft condition: no healthy provider or wait timeout |
| 4 | cancellation target is already terminal/not cancellable |
| 5 | cancellation could not safely terminate or verify the worker |

Legacy `cancel --json` retains its current exit behavior. `cancel --json-v2` uses exit 4 or 5 as listed above.

### Result Shapes

Gate C wraps, but does not blindly reuse, the current legacy payloads. Each v2 result has a stable `type` discriminator:

| Command | Result `type` |
|---|---|
| `setup` | `provider.setup` |
| `health` | `provider.health` |
| foreground ask/rescue/review | `provider.execution` |
| background ask/rescue/review | `job.started` |
| `status` snapshot | `job.status-list` |
| `status` one job | `job.status` |
| `result` | `job.result` |
| `cancel` | `job.cancel` |
| `timing` | `timing.report` |
| `debug runs` | `ledger.run-list` |
| `debug show` | `ledger.run-events` |
| `debug explain` | `ledger.explanation` |
| `debug tail` | `ledger.tail` |
| `sessions list` | `session.list` |
| `sessions purge` | `session.purge` |

The inner data reuses current fields where their semantics are already sound. Renames happen only for ambiguous identity fields described below.

Shared v2 result contracts are:

- `provider.setup`: `providers` is the current setup row array.
- `provider.health`: `results`, `healthyProviders`, `unhealthyProviders`, `allHealthy`, and `anyHealthy` retain current meanings.
- `provider.execution`: `execution` contains `provider`, `kind`, `model`, and redacted `promptPreview`; `providerResult` contains the compact provider result, requires its existing boolean `ok`, renames its upstream `sessionId` to `providerSessionId`, and permits provider-specific additional fields instead of pretending all provider protocols are identical.
- `job.started`: contains one normalized `job`.
- `job.status-list`: contains `totalJobs`, `running`, and `recent`, where both arrays contain normalized jobs.
- `job.status`: contains one normalized `job` and either `wait: null` or the typed wait result.
- `job.result`: contains one normalized terminal `job` and its compact provider-specific `providerResult`.
- `job.cancel`: contains `jobId`, `cancelled`, and a typed `reason`; it includes no raw PID evidence.
- `timing.report`: retains `records`, `aggregate`, and `metadata` under the discriminator.
- ledger and session result types retain their current domain fields under their discriminator, subject to the identity and cursor rules in this spec.

A normalized v2 job has these stable fields:

```json
{
  "jobId": "review-abc12345",
  "provider": "qwen",
  "kind": "review",
  "status": "running",
  "model": null,
  "defaultModel": null,
  "promptPreview": "review staged changes",
  "hostSessionId": null,
  "providerSessionId": null,
  "createdAt": "2026-07-15T00:00:00.000Z",
  "updatedAt": "2026-07-15T00:00:01.000Z",
  "finishedAt": null,
  "logFile": "/bounded/workspace-state/jobs/review-abc12345.log",
  "error": null
}
```

`workerPid`, worker command lines, and config-file paths are internal and excluded from normalized v2 jobs. Existing legacy status/result JSON retains its current `pid` field.

## Identity And State Semantics

### Identifier Model

Use distinct identifiers for distinct lifetimes:

| Field | Meaning | Lifetime |
|---|---|---|
| `hostSessionId` | host conversation/session that launched work | host session |
| `invocationId` | one Polycli command invocation | one process invocation |
| `runId` | caller-selected or generated correlation group | one or more invocations |
| `jobId` | durable background job | one background execution |
| `attemptId` | one provider attempt | one provider call |
| `providerSessionId` | upstream provider session/resume identity | provider-defined |
| `workerPid` | local OS process identity | one worker process |

Do not add a generic `runtimeHandle`. `workerPid` remains an internal operational field guarded by config-file command-line identity checks. It is not a durable cross-process selector.

### Invocation And Attempt IDs

Every command invocation creates `invocationId` before parsing finishes so JSON errors can still be correlated.

IDs reuse the repository's existing dependency-free random UUID pattern:

```js
const invocationId = `inv_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const attemptId = `att_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
```

They are opaque lowercase identifiers matching `^(inv|att)_[a-f0-9]{20}$`. Callers must not derive time or ordering from them.

Every provider call creates one `attemptId` before `attempt_started`:

- foreground: create immediately before the provider call;
- background: create in the parent, persist in `runContext`, and reuse in worker/recovery terminal events;
- retry: create a new `attemptId` for every retry while preserving `runId`, `invocationId`, and `jobId` as applicable.

Ledger terminal-pair identity includes `attemptId`; it must not rely only on provider plus ordinal.

Gate B extends the existing terminal-pair helper beyond its current `runId`/`jobId` background-only key:

- background key: `["job", runId, jobId, attemptId]`;
- foreground key: `["attempt", runId, invocationId, attemptId]`.

Both events in a pair must share the selected key and contain exactly one `attempt_result` plus one `provider_decision`. A missing `jobId` is valid only for the foreground form. Recovery refuses an incomplete or conflicting pair.

### Job Session Migration

New jobs persist both:

```json
{
  "hostSessionId": "host-session-or-null",
  "providerSessionId": "provider-session-or-null"
}
```

All new internal logic uses the explicit fields.

Gate B increments the internal workspace state version from 1 to 2. The v2 reader accepts state versions 1 and 2; all new writes use 2. Per-job result/config readers remain field-tolerant and normalize legacy records before business logic runs.

For legacy `--json`, retain `sessionId` as a deprecated compatibility alias:

- active new job: alias `hostSessionId`;
- terminal new job: alias `providerSessionId`;
- old active job with only `sessionId`: normalize it as `hostSessionId`;
- old terminal job with only `sessionId`: normalize it as `providerSessionId`;
- never infer the missing identity from the other kind.

JSON v2 exposes only explicit fields. `agent-context` marks legacy `sessionId` as ambiguous and deprecated.

The session lifecycle hook matches `hostSessionId`, with fallback to old active-job `sessionId` only. Upstream session artifact discovery and purge use `providerSessionId`, with fallback to old terminal-job `sessionId` only.

### Ledger Schema Evolution

New ledger events use event schema version 2 and add:

- `invocationId`;
- `attemptId` when applicable;
- `providerSessionId` when the provider returns one.

`hostSessionId` stays in private job state and job config; it is not copied into the run ledger. This avoids adding host-conversation identity to the durable observability stream when `invocationId` already provides the required correlation.

Readers accept mixed v1/v2 ledgers. The v1 normalizer:

- maps ledger `sessionId` to `providerSessionId`, because ledger session IDs were provider artifacts;
- leaves `invocationId` and `attemptId` null;
- preserves the original raw event for `debug show` legacy output;
- supplies normalized events to projections and JSON v2.

No in-place ledger rewrite is performed.

### Attempt-Correct Projection

TUI and explanation projections group terminal evidence by:

1. `attemptId` when present;
2. `jobId` for older background events;
3. a conservative legacy epoch that starts at each later `attempt_started`/`job_started` after prior terminal evidence.

The provider summary displays the newest attempt by event order. Terminal evidence from an older attempt cannot mark a newer started attempt failed or completed.

If identity is insufficient, report `unknown` or `unfinished`; do not infer success or failure.

## Lifecycle Completeness

### Foreground Exceptions

After writing `attempt_started`, `runForegroundExecution` must produce one atomic terminal pair for every returned result or thrown exception:

- `attempt_result`;
- `provider_decision`.

On a thrown provider/runtime exception:

1. normalize a bounded failure result with explicit CLI/provider failure code;
2. prepare a terminal descriptor containing the same `invocationId` and `attemptId`;
3. publish the terminal pair with the existing atomic ledger helper;
4. perform runtime-option cleanup in `finally`;
5. return/throw according to text, legacy JSON, or JSON v2 behavior;
6. let `main()` write the run summary after the terminal pair is durable.

The run summary is not a substitute for an attempt terminal pair.

If foreground terminal-pair persistence fails, return `ledger_persist_failed` and do not emit the provider result as a successfully finalized command. Foreground execution has no job envelope in which to preserve terminal intent, so the error must state that provider work may have occurred but durable finalization is unverified. Background execution keeps the existing recoverable-intent invariant in its job envelope.

### Decoder Overflow

An overlong unterminated provider stream line is a runtime failure, not permission to abandon a live child.

When `createLineDecoder` throws:

1. store a single `decoderError` and stop accepting stdout data;
2. signal the child or detached process group with `SIGTERM`;
3. schedule `SIGKILL` after `killGraceMs` when it remains alive;
4. keep the close/error listeners needed to observe termination;
5. resolve exactly once with `ok: false`, the bounded decoder error, and the observed status/signal;
6. clear timers and listeners after settlement.

The decoder path uses the same process-group signaling rules as timeout and abort. It must not call the current immediate `finish()` path before signaling the child.

Tests use a fake detached child and assert `SIGTERM` then `SIGKILL`; they also assert no late stdout callback and no double resolution.

## Typed Job Selectors

Gate C adds `--job <selector>` to `status`, `result`, and `cancel` while preserving existing positional job references.

Selector grammar:

- `id:<full-job-id>`: exact only;
- `prefix:<job-id-prefix>`: must resolve uniquely;
- `latest`: newest matching job;
- `latest-active`: newest queued/running job;
- `latest-terminal`: newest completed/failed/cancelled job.

Compatibility rules:

- a legacy bare positional keeps exact-then-unique-prefix behavior;
- passing both a positional reference and `--job` is `invalid_argument`;
- `status --all` conflicts with `--job`;
- `result` defaults to `latest-terminal`;
- `cancel` defaults to `latest-active`;
- plain `status` with no selector remains a snapshot;
- an ambiguous prefix returns `ambiguous_selector` with bounded candidate IDs rather than pretending the job is missing.

Selectors operate only inside the current workspace state directory.

## Typed Waits

Gate C extends job wait:

```bash
polycli status --job id:<job-id> --wait --for terminal --timeout-ms 30000
```

Allowed `--for` values:

- `terminal` (default): completed, failed, or cancelled;
- `completed`;
- `failed`;
- `cancelled`.

The v2 result includes:

```json
{
  "type": "job.status",
  "job": {},
  "wait": {
    "for": "completed",
    "satisfied": false,
    "timedOut": false,
    "terminalMismatch": true
  }
}
```

If a job reaches a different terminal state from the requested one, return immediately with `terminalMismatch: true`; do not wait until timeout. Timeout remains exit code 2. Existing `status <job> --wait` behavior maps to `--for terminal`.

No `tui-idle`, provider-token, or arbitrary expression wait is added.

## Cursor-Based Ledger Observation

### Tail Command

Gate D adds:

```bash
polycli debug tail [run-id] \
  [--after <event-id>] \
  [--limit <n>] \
  [--wait] \
  [--timeout-ms <ms>] \
  [--json|--json-v2]
```

This reads only the redacted run ledger. It never reads the raw job log.

### Semantics

- no `run-id` and no `--after`: pin the latest run at command start;
- no `run-id` with `--after`: locate the retained cursor first and pin its `runId`;
- no `--after`: return the last `limit` matching events in chronological order;
- `--after`: return the first `limit` matching events after that event;
- `--wait`: if no newer event exists, poll the ledger until one appears or timeout expires;
- `--wait` requires `--after`; callers first obtain a cursor with a non-waiting read, then follow from that cursor;
- default `limit`: 100;
- maximum `limit`: 500;
- default wait timeout: 30 seconds;
- wait poll interval: 500 milliseconds, rereading the bounded ledger only when file size or modification time changes;
- `--timeout-ms` without `--wait` is invalid;
- corrupt ledger lines remain ignored under the existing reader policy.

The cursor is the opaque `eventId`. Clients must not parse ordering from its characters.

Result fields:

```json
{
  "type": "ledger.tail",
  "runId": "run_abc",
  "events": [{"eventId": "evt_150"}],
  "cursor": {
    "requested": "evt_100",
    "oldest": "evt_050",
    "latest": "evt_200",
    "next": "evt_150"
  },
  "limited": true,
  "cursorExpired": false,
  "waitTimedOut": false
}
```

If an explicit `--after` cursor is absent from the retained valid events for the selected run, fail deterministically with `cursor_expired` and `data.reason: "not_retained"`. With the bounded NDJSON store, Polycli cannot distinguish rotation from a cursor that never belonged to the run, so it must not claim a more precise cause. Include current `oldest` and `latest` cursors. Never silently resume from the oldest retained event because that could hide missed decisions.

When the ledger is empty, `oldest`, `latest`, and `next` are null. When a wait times out with a valid cursor, return an authoritative empty result, `waitTimedOut: true`, and exit code 2.

The reader remains bounded by the existing 2 MB ledger cap. Gate D does not introduce an index database or daemon.

## Host Integration

### Validation

Rewrite `scripts/validate-host-command-map.mjs` so expected commands come from the registry, not `EXPECTED_COMMANDS` or dispatcher regexes.

The validator checks:

- every shared public top-level command has the expected Claude command file;
- Codex and Copilot skill inventories match shared registry commands;
- OpenCode's generic tool description covers shared commands;
- `docs/host-command-map.md` contains one row per shared command;
- terminal-only `tui` is present only on the terminal surface;
- internal commands appear on no host surface;
- companion handler bindings match executable registry paths;
- generated root and per-command help are internally consistent.

Rich command prose remains handwritten. Only inventories, parser semantics, help, and machine descriptions are canonicalized.

### New Host Command

Gate A adds `agent-context` to all five host surfaces:

- Claude command wrapper;
- Codex skill subcommand;
- Copilot skill subcommand;
- OpenCode `polycli_run(["agent-context", "--json"])`;
- terminal `polycli agent-context --json`.

It remains offline regardless of host.

### Terminal TUI

The registry describes `tui`, and the terminal wrapper continues to delegate execution to `polycli-tui.mjs`. `scripts/build-plugin-bundles.mjs` deterministically writes `packages/polycli-terminal/lib/command-surface.generated.mjs` from the canonical registry. The terminal wrapper derives delegated terminal commands from that generated module instead of comparing `command === "tui"`. The TUI imports the generated option definitions and calls enhanced strict `parseArgs` from `@bbingz/polycli-utils/args`.

The terminal package already publishes `lib/**/*.mjs`; Gate A adds the existing public utility package as an explicit terminal-package dependency, so no repo-relative runtime import is needed. Bundle/build validation compares the generated module with a fresh in-memory render and fails on drift. The generated file carries metadata only, not handlers or provider code.

## Security And Privacy

- `agent-context` is static and contains no availability/auth/cached-model data.
- strict parsing runs before provider calls and before mutating `setup` or `sessions purge` behavior.
- suggestion lists contain only public commands/options for the current host surface.
- typed errors bound all user-controlled echoed values.
- ledger cursor output inherits current redaction; no full prompt/stdout/stderr/env is added.
- cursor reads stay within the current workspace's resolved state directory.
- job selectors never search other workspaces or the user's home directory.
- host and provider session IDs are never inferred from one another.
- JSON v2 does not expose worker command lines, config paths, environment, or PID identity evidence.
- `sessions purge` keeps its exact realpath, symlink, containment, and explicit-confirmation safeguards.
- no discovery command performs a provider auth probe that could spend tokens.

## Compatibility And Migration

### Preserved

- existing `--json` payload shapes for existing commands;
- existing command names and provider-first positional forms;
- existing `status`, `result`, and `cancel` defaults;
- `status --wait` as terminal wait;
- public lenient `parseArgs()` default behavior;
- flat provider registry and provider-specific parsing;
- ledger retention and redaction boundaries;
- byte-identical companion bundle targets.

### Intentional Changes

- unknown option-looking tokens on registered Polycli commands become errors before `--`;
- command-specific help replaces the current root-help-for-every-command behavior;
- ambiguous job prefixes become distinguishable from missing jobs;
- new ledger writes use schema version 2 with explicit identities;
- new job state writes include explicit host/provider session fields;
- `agent-context` becomes the thirteenth shared top-level capability.

### Backward Readers

- state readers accept jobs with only legacy `sessionId`;
- ledger readers accept v1 and v2 events in one file;
- old queued job configs without `invocationId`/`attemptId` continue to run and produce conservative legacy projections;
- missing new registry/build fields in a development source run use deterministic null/dev defaults;
- host adapters remain on legacy JSON until separately migrated.

No migration command or destructive rewrite is required.

## Implementation Staging

### Gate A — Command Contract Foundation

Primary files:

- add `plugins/polycli/scripts/lib/command-registry.mjs`;
- add focused registry/parser/help tests under `plugins/polycli/scripts/tests/`;
- update `packages/polycli-utils/src/args.js` and its tests with opt-in strict behavior;
- refactor `plugins/polycli/scripts/polycli-companion.mjs` to use the registry and handler map;
- update `scripts/build-plugin-bundles.mjs` with deterministic build version injection;
- generate `packages/polycli-terminal/lib/command-surface.generated.mjs`, add the terminal package's explicit utils dependency, and route terminal/TUI parsing through it;
- update host wrappers/skills/docs and `scripts/validate-host-command-map.mjs`;
- update bundle and packaging tests;
- add `agent-context` and its offline tests.

Gate A does not add JSON v2, new selectors, or ledger tail.

### Gate B — Identity And Reliability

Primary files:

- `plugins/polycli/scripts/polycli-companion.mjs`;
- `plugins/polycli/scripts/lib/state.mjs`;
- `plugins/polycli/scripts/lib/job-control.mjs`;
- `plugins/polycli/scripts/lib/run-ledger.mjs`;
- `plugins/polycli/scripts/session-lifecycle-hook.mjs`;
- `packages/polycli-terminal/lib/tui/view-model.mjs`;
- `packages/polycli-runtime/src/spawn.js`;
- focused state/job/ledger/TUI/spawn/integration tests.

Gate B lands explicit identity fields, mixed-schema readers, attempt-correct projection, foreground terminalization, and decoder termination together so no partial identity model ships.

### Gate C — Versioned Operational Contract

Primary files:

- command/error/output schema definitions;
- companion output boundary and typed errors;
- job selector resolver and wait logic;
- host adapter compatibility tests;
- public surface and host command documentation.

Gate C keeps host defaults on legacy JSON.

### Gate D — Incremental Observation

Primary files:

- bounded ledger reader helpers in `run-ledger.mjs`;
- `debug tail` handler and registry metadata;
- cursor expiration, rotation, wait, corruption, redaction, and JSON schema tests;
- TUI may consume the cursor API only in a later change. Gate D does not rewrite the TUI automatically.

### Generated Bundles

For every implementation gate:

1. write source and focused tests first;
2. run focused tests against source;
3. rebuild all five companion bundles once source is green;
4. run bundle parity and host-map validation;
5. inspect the generated diff for unintended dependency or secret inclusion.

## Failure Handling And Rollback

- Each gate is a separate implementation/release unit. Do not begin the next gate while the current gate's focused tests, full suite, bundle parity, host validation, and release check are red.
- Gate A writes no new persistent schema. Rollback restores the prior parser/help/dispatcher and removes the generated terminal metadata artifact.
- Gate B performs no in-place state or ledger rewrite. Current state/ledger readers are field- and version-tolerant; before landing, fixture tests must prove new readers accept v1 data and the pre-Gate-B readers tolerate additive v2 job fields/events. This keeps a code rollback from requiring data rollback.
- Gate C is opt-in. Removing `--json-v2` restores the prior public machine surface without changing legacy payloads or stored state.
- Gate D is read-only over existing ledger storage. Rollback removes the handler/registry entry and leaves no new persistent service or index.
- A failed generated-bundle build must not be worked around by editing bundle output. Fix source or the generator and rebuild.
- Any release blocker caused by an external provider probe must be distinguished from deterministic contract/test failures. Deterministic failures block completion.

## Test Strategy

### Registry And Help

- registry is deeply serializable and passes all uniqueness/reference invariants;
- executable paths equal handler-map keys;
- every public command has usage, examples, output schemas, errors, and exit codes;
- root help is surface-filtered;
- nested help resolves the longest path;
- help says `polycli`, not `polycli-companion.mjs`;
- terminal help includes `tui`; plugin help excludes it;
- internal commands never appear.

### Strict Parser

- preserve every existing lenient `parseArgs` test unchanged;
- strict mode rejects unknown long and short options;
- `--modle` suggests `--model` only where valid;
- unknown option rejection happens before a fake provider binary is invoked;
- `-- --literal` remains prompt text;
- duplicates and conflicts are rejected;
- valid inline/adjacent values and `-mvalue` remain supported;
- recognized next option is not consumed as a missing value;
- JSON v1 error remains compatible and JSON v2 contains structured suggestions.

### Agent Context

- output is deterministic for the same build and surface;
- schema and every `$ref` resolve;
- all command/provider/error entries are JSON-safe;
- no provider method is invoked;
- an empty temporary state root remains absent after the command;
- command succeeds with provider binary env vars pointing to nonexistent paths;
- provider review safety matches `REVIEW_FLAG_EXPECTATIONS`;
- build version is release version in bundles and deterministic dev sentinel in source tests;
- all five bundles return the same context except expected host-surface filtering.

### Identity And Projection

- host and provider session IDs coexist without overwrite;
- legacy active and terminal jobs normalize conservatively;
- lifecycle cleanup matches host session only;
- session purge uses provider session only;
- repeated same-provider attempts get distinct `attemptId` values;
- an old failed attempt followed by a new started attempt renders the new attempt as unfinished;
- terminal-pair deduplication keys include attempt identity;
- mixed ledger v1/v2 input remains readable.

### Lifecycle

- foreground returned failure writes one terminal pair;
- foreground thrown error writes one terminal pair before run summary;
- ledger write failure cannot expose a contradictory completed attempt;
- decoder overflow signals detached group `SIGTERM`, then `SIGKILL`;
- decoder failure resolves once and ignores late stdout;
- existing timeout, abort, stdin drain, and normal close behavior remains green.

### JSON v2

- success and failure envelopes are mutually exclusive;
- `id` matches invocation identity in ledger events;
- every command result validates against its declared schema fixture;
- health-none and wait-timeout are `ok: true` with exit 2;
- invalid input is `ok: false` with exit 1;
- legacy `--json` snapshots remain byte/shape compatible where currently asserted;
- `--json` plus `--json-v2` is rejected.

### Selectors And Waits

- exact, prefix, latest, active, and terminal selectors resolve correctly;
- ambiguity returns bounded candidates;
- selectors cannot cross workspaces;
- positional compatibility remains;
- requested terminal state succeeds only on that state;
- different terminal state returns terminal mismatch immediately;
- timeout preserves the latest authoritative job state.

### Ledger Tail

- no cursor returns the last bounded events chronologically;
- valid cursor returns only newer events;
- limit and max limit are enforced;
- wait wakes on a new event and times out cleanly;
- a rotated-away cursor returns `cursor_expired` with oldest/latest anchors;
- corrupt lines do not corrupt valid cursors;
- output contains redacted events only and never reads a referenced log file;
- empty ledger behavior is explicit.

### Required Verification Per Gate

Run focused tests first, then:

```bash
npm test
npm run validate:host-map
npm run validate:bundles
npm run validate:codex-adapter
npm run release:check
git diff --check
```

Where a command is duplicated by `release:check`, the final closeout may cite the release check instead of rerunning it separately, but the exact executed commands and results must be reported.

## Acceptance Criteria

### Gate A Done When

- one registry is the source for shared command inventory, strict parsing, help, suggestions, host validation, and `agent-context`;
- existing public `parseArgs` default semantics remain green;
- `polycli ask --provider qwen --modle x hello` fails before provider invocation and suggests `--model`;
- `polycli ask --provider qwen -- --modle x` treats the tokens as prompt text;
- command-specific and nested help work;
- `polycli agent-context --json` succeeds offline, is deterministic, and describes commands, providers, review safety, schemas, errors, and exit codes;
- all host inventories are derived/validated from the registry;
- generated bundles remain byte-identical.

### Gate B Done When

- new jobs carry explicit host/provider session identities, and new ledger events carry explicit invocation/attempt/provider-session identities;
- old state and ledger data remain readable without destructive migration;
- TUI and debug projections cannot apply an older attempt's terminal result to a newer attempt;
- every returned or thrown foreground attempt gets exactly one terminal pair;
- decoder overflow terminates the child/process group and settles once;
- focused integration, job, ledger, TUI, hook, session, and spawn tests pass.

### Gate C Done When

- `--json-v2` works for every operational command with schema-validated result types;
- legacy `--json` remains compatible and is still the host default;
- typed errors include suggestions and next steps without leaking internals;
- explicit selectors distinguish missing and ambiguous jobs;
- typed waits report satisfied, timed out, and terminal mismatch states honestly;
- agent context advertises `jsonEnvelopeV2: true` only after all command schemas and tests pass.

### Gate D Done When

- `debug tail` provides bounded redacted events with opaque cursor anchors;
- cursor rotation/expiration cannot silently skip events;
- wait behavior is bounded and exit-code compatible;
- raw logs remain pointers only;
- agent context advertises `ledgerCursor: true` only after cursor tests pass.

## Rejected Alternatives

### Put Command Metadata In `polycli-utils`

Rejected. Command semantics are host/companion-specific and do not belong in the low-semantic-risk shared utility package. Only the generic opt-in strict parser behavior belongs there.

### Put Command Metadata In The Provider Runtime Registry

Rejected. Provider capabilities and CLI command grammar are different axes. Combining them would make the internal runtime package a CLI framework and blur Path B boundaries.

### Store Handler Functions In The Registry

Rejected. It prevents pure offline serialization and couples validators/help to executable code. Keep static metadata and explicit bindings separate, then validate one-to-one parity.

### Change Existing `--json` In Place

Rejected. It would break host adapters and machine consumers. The v2 envelope is opt-in until a future explicit major-surface decision.

### Make `parseArgs` Strict By Default

Rejected. Its current unknown-token behavior is a public utility contract. Registered Polycli commands opt in to strictness.

### Tail Raw Job Logs

Rejected. Raw logs can contain full model output or sensitive material. Agent observation uses the already redacted ledger; log files remain explicit pointers for a human/operator.

### Add An Index Database Or Daemon For Cursors

Rejected. The current 2 MB ledger is bounded and sufficient for a cursor scan. A persistent process would violate an explicit project non-goal.

### Add A Generic Runtime Handle

Rejected. Polycli has short-lived invocations and local worker PIDs, not a durable runtime service. Durable selectors remain `runId` and `jobId`.

### Add A Task DAG Or Scheduler

Rejected. External hosts and workflow systems own orchestration. Polycli remains the execution, review-safety, timing, and observability control surface.

## Deferred Conditional Extensions

### Version-Matched Skills Discovery

Consider `polycli skills list/get` only when at least two consumers need runtime-readable operational guidance that cannot reliably ship through their host plugin/skill package.

If activated:

- topics are bundled, versioned, local, and read-only;
- discovery never fetches remote content;
- topic IDs and summaries enter the command registry;
- full text is bounded and contains no environment-specific state;
- `agent-context.features.skillsDiscovery` becomes true only then.

Until that gate is met, command metadata plus existing host skills are sufficient.

### Lightweight Lineage

Consider optional `parentRunId`, `parentJobId`, and `causedByEventId` only when a real host-owned workflow launches related Polycli operations and needs correlation.

Lineage fields:

- are metadata only;
- do not create or schedule child tasks;
- do not imply ownership, cancellation propagation, or retries;
- must be explicitly supplied by the host and validated within length/character limits;
- remain null when unknown.

No generic workflow runtime is implied or authorized by this deferred extension.
