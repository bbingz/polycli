# Claude Workflow Orchestration Design

## Objective

Define the implementable path for using Codex xhigh as the planning layer for Claude Code Dynamic Workflows, then launching Claude Code's official workflow runtime through the existing Claude tmux TUI path so Claude subagent work does not default back to `claude -p` or the Agent SDK credit path.

The result should let a human or host agent ask polycli to produce, launch, observe, and archive repeatable multi-agent workflow runs without turning polycli into its own agent framework.

## Current Facts

- Claude Code Dynamic Workflows are JavaScript scripts that orchestrate subagents at scale, run in the background, and store run progress under the Claude session directory.
- Claude Code documents workflows as the right primitive for codebase audits, large migrations, cross-checked research, and repeatable quality patterns.
- Starting 2026-06-15, Claude Agent SDK and `claude -p` usage on subscription plans draw from a separate Agent SDK credit. That makes SDK and `-p` unsuitable as the default path for this project goal.
- Polycli already keeps Claude `ask` and `review` on `executionMode: "tmux-tui"` to avoid silently returning to `claude -p`.
- Local workflow evidence shows the useful pattern:
  - implementation waves use disjoint file ownership, TDD-first instructions, and exact focused test commands;
  - review waves use one-finding-per-auditor, verbatim evidence requirements, adversarial verification, and a synthesis stage;
  - run metadata is already available in Claude's `workflows/wf_*.json` plus `subagents/workflows/<run-id>/*.jsonl`.

Primary references:

- Claude Dynamic Workflows: https://code.claude.com/docs/en/workflows
- Claude Agent SDK overview and 2026-06-15 credit note: https://code.claude.com/docs/en/agent-sdk/overview
- Claude subagents: https://code.claude.com/docs/en/sub-agents
- Codex subagents: https://developers.openai.com/codex/subagents
- Codex xhigh profile configuration: https://developers.openai.com/codex/config-advanced

## Non-Goals

- Do not implement a general workflow runtime in polycli.
- Do not add a provider base class, agent base class, or template-method runtime.
- Do not make `claude -p` or the Claude Agent SDK the default execution path.
- Do not require all providers to support Claude workflows. This track is Claude-runner-specific, with polycli acting as host-neutral control and observability surface.
- Do not hand-edit generated companion bundles in worker tasks.
- Do not use workflow scripts as direct shell or filesystem actors. Workflow scripts coordinate agents; agents perform reads, edits, and commands under Claude Code's permission model.

## Recommended Architecture

### 1. Planner: Codex xhigh

Codex xhigh is used to create or revise a workflow script from a user objective, repo constraints, and verification gates.

Inputs:

- objective text;
- repo root;
- relevant AGENTS.md / CLAUDE.md / project memory context;
- optional scope such as files, directories, PR, audit finding list, or release task;
- desired workflow kind: `implementation`, `review`, `research`, or `release-closeout`.

Output:

- a workflow JavaScript script that Claude Code can run;
- a short manifest with name, kind, owner, expected phases, file ownership, and validation commands;
- no source edits unless the caller explicitly asks the planner to patch an existing workflow script.

Codex xhigh is a planner/compiler, not the executor. If the planner is unavailable, the user can supply a script manually and skip the planning step.

### 2. Runner: Claude tmux TUI

Polycli starts Claude Code in a detached tmux TUI session, preserving the existing Claude cost-path constraint.

The runner prompt should ask Claude to execute an explicit workflow script or create a workflow from an explicit prompt. For saved workflows, it can ask Claude to run the saved slash command. The runner returns detached startup metadata, not an LLM answer:

```json
{
  "detached": true,
  "responseKind": "workflow_tui_session_started",
  "tmuxSession": "polycli-claude-...",
  "attachCommand": "tmux attach -t polycli-claude-...",
  "workflow": {
    "requested": true,
    "runId": null,
    "scriptPath": null,
    "status": "starting"
  }
}
```

`runId` and `scriptPath` may be null at startup because the workflow is created inside the Claude session after TUI launch. Observation commands fill these in by scanning the Claude session's workflow artifacts.

### 3. Workflow Runtime: Claude Code Dynamic Workflows

The workflow script remains a Claude Code workflow script, not a polycli DSL.

Allowed workflow primitives:

- `meta` to name the workflow and describe phases;
- `phase(...)`;
- `agent(...)`;
- `parallel(...)`;
- `pipeline(...)` when one stage feeds another;
- JSON schemas for worker outputs.

Implementation workflows should use this pattern:

1. Recon or plan stage, read-only.
2. One or more parallel implementation waves with disjoint file ownership.
3. Integrator stage that resolves conflicts, regenerates bundles, runs broad verification, and writes durable notes.

Review workflows should use this pattern:

1. Finder or claim-expansion stage.
2. One independent auditor per claim or area.
3. Adversarial verification with at least two independent lenses for any finding that will survive.
4. Synthesis stage that emits status, evidence, severity, remediation, and unverified scope.

### 4. Polycli Control Surface

Add a new companion command group:

```text
workflow plan   [--kind <implementation|review|research|release-closeout>] [--profile <codex-profile>] [--output <path>] <objective>
workflow start  [--script <path> | --saved <name> | --prompt <text>] [--json]
workflow list   [--json]
workflow status [workflow-run-ref] [--json]
workflow result [workflow-run-ref] [--json]
workflow cancel [workflow-run-ref] [--json]
```

First implementation slice:

- `workflow plan` may be a documented/manual handoff if invoking Codex from polycli is not yet stable.
- `workflow start` must use Claude tmux TUI and return detached startup metadata.
- `workflow list/status/result` should read Claude workflow artifacts from known Claude config roots and correlate them with the current workspace.
- `workflow cancel` can be deferred unless there is a reliable TUI/workflow artifact path to stop a run without guessing.

Do not add a provider option to `workflow start` in the first slice. The runner is explicitly Claude Code. Other providers can still participate inside worker prompts via existing polycli commands if the workflow author chooses that.

### 5. Artifact Discovery

Workflow observation reads from Claude stores, not from model output.

Candidate roots:

- `~/.claude/projects/<encoded-workspace>/workflows/wf_*.json`
- `~/.claude/projects/<encoded-workspace>/subagents/workflows/<wf-id>/`
- wrapper stores that have been used locally:
  - `~/.claude-qwen/projects/<encoded-workspace>/...`
  - `~/.claude-minimax/projects/<encoded-workspace>/...`
  - `~/.claude-kimi/projects/<encoded-workspace>/...`
  - `~/.claude-mimosg/projects/<encoded-workspace>/...`

The implementation must treat this format as observed, not guaranteed. Readers should be tolerant:

- missing fields become `null`;
- unknown fields are preserved in verbose JSON;
- malformed individual JSONL lines are skipped with a warning count;
- artifact paths are realpath-checked and must stay under the expected Claude root;
- no workflow is reported as belonging to the current workspace unless its path or stored script metadata proves that workspace.

## Command Semantics

### `workflow plan`

Purpose: produce a reusable workflow script from an objective.

Behavior:

- reads project constraints and supplied context;
- asks Codex xhigh to draft a script and manifest;
- writes to `docs/workflows/<slug>.workflow.js` or a caller-provided `--output`;
- does not run the script;
- does not edit project source files outside the workflow artifact unless explicitly requested.

Fallback:

- if Codex is unavailable, return a structured error suggesting `workflow start --script <path>` with a manually authored script.

### `workflow start`

Purpose: start Claude Code in tmux TUI and trigger a Dynamic Workflow.

Behavior:

- validates tmux and Claude availability;
- starts Claude through the same narrow environment propagation policy as current Claude TUI prompt runs;
- pastes a prompt that references the script or saved workflow explicitly;
- returns startup metadata;
- records a run-ledger event with `kind: "workflow"`, `phase: "workflow_start_requested"`, and `tmuxDetached: true`.

It must not claim the workflow completed or that agents finished. It only proves the TUI startup and request handoff.

### `workflow list/status/result`

Purpose: observe completed or running workflow artifacts.

Behavior:

- scans known Claude workflow roots for the current workspace;
- sorts by timestamp or mtime descending;
- exposes top-level fields such as `workflowName`, `runId`, `status`, `durationMs`, `agentCount`, `totalTokens`, and `totalToolCalls`;
- optionally includes phase and agent summaries;
- links back to artifact paths for attach/debug.

`result` returns the stored workflow result if available, plus artifact paths. If there is no terminal result yet, it returns `status` and a clear "not complete" message.

## Workflow Templates

### Implementation Wave Template

Required fields:

- objective;
- file ownership list per worker;
- forbidden files per worker;
- exact focused test command per worker;
- explicit "do not run broad tests or regenerate bundles" rule for workers;
- integrator-only broad verification list.

Worker schema:

```json
{
  "task": "string",
  "status": "done | partial | blocked",
  "filesChanged": ["string"],
  "testsAdded": ["string"],
  "focusedTestCmd": "string",
  "focusedTestResult": "string",
  "deviationsFromSpec": ["string"],
  "risksOrNotes": ["string"]
}
```

### Review And Reaudit Template

Required fields:

- finding or scope id;
- file and line targets when available;
- evidence requirement;
- allowed statuses;
- conservative default when uncertain.

Auditor schema:

```json
{
  "finding_id": "string",
  "status": "fixed | still-present | false-positive | mitigated | not-applicable",
  "evidence": "string",
  "reasoning": "string",
  "fixed_by": "string",
  "residual": "string"
}
```

Verifier schema:

```json
{
  "real": true,
  "confidence": "high | medium | low",
  "reasoning": "string"
}
```

A finding survives only when the configured vote threshold is met. The default threshold is 2 of 3 independent verifiers.

## Error Handling

- Missing tmux: fail before creating a workflow job and explain that Claude workflow execution requires tmux for this path.
- Missing Claude: fail before planning startup.
- Missing Codex planner: `workflow plan` fails, but `workflow start --script` remains usable.
- Missing workflow artifacts after startup: return `status: "starting"` or `status: "unobserved"`; do not mark failure until the TUI process exits or Claude records an error.
- Ambiguous workspace roots: return all candidates in JSON and require the caller to select a run ref.
- Partial artifact parse: report warning counts; do not throw away the whole run.

## Security And Cost Constraints

- Default path must not call `claude -p`.
- Default path must not import or depend on the Claude Agent SDK.
- Claude tmux environment propagation stays allowlisted.
- Workflow script paths must be absolute or resolved under the workspace, `.claude/workflows`, or `~/.claude/workflows`.
- Do not execute arbitrary workflow scripts from untrusted paths without showing the path in the startup payload.
- Do not store full prompts in the run ledger by default. Store preview, path, run id, and command metadata.
- Observation commands are read-only.

## Testing Strategy

Focused tests for the first implementation slice:

- CLI parsing for `workflow` subcommands.
- `workflow start` builds the expected Claude tmux prompt and detached JSON payload using fake tmux/Claude binaries.
- Missing tmux and missing Claude return structured failures.
- Workflow artifact reader handles:
  - valid `wf_*.json`;
  - missing optional fields;
  - malformed JSONL line inside an agent transcript;
  - multiple Claude roots;
  - path outside allowed root rejected.
- Host command map validator includes the new command surface once implemented.

Manual smoke after implementation:

1. Start a tiny Claude workflow through tmux TUI using a script with one read-only agent.
2. Attach to the tmux session and confirm Claude shows the workflow request.
3. Run `workflow list` and confirm the run appears.
4. Run `workflow status <run>` and confirm agent count, status, and artifact paths.
5. Run `workflow result <run>` after completion.

Broad verification after implementation:

- focused workflow tests;
- `npm test`;
- `npm run validate:host-map`;
- `npm run validate:bundles`;
- `npm run release:check`.

## Implementation Staging

Stage 1: design-only and artifact reader spike.

- Add this spec.
- Write a read-only artifact reader module behind tests.
- No new user-facing command until artifact discovery is reliable.

Stage 2: command surface.

- Add `workflow list/status/result`.
- Add host-map docs and validator updates.
- Keep `workflow start` behind a focused integration test with fake tmux/Claude.

Stage 3: planner integration.

- Add `workflow plan` once the Codex invocation contract is stable.
- Support profile configuration such as `deep-review` with `model_reasoning_effort = "xhigh"`.
- Keep manual `--script` start path as the reliable fallback.

Stage 4: saved workflow and cancellation.

- Add saved workflow discovery under `.claude/workflows` and `~/.claude/workflows`.
- Add cancellation only if a reliable workflow-run stop mechanism is available without screen-scraping unstable TUI text.

## Acceptance Criteria

The first implementation plan is complete only when:

- a user can start a Claude Dynamic Workflow through tmux TUI without `claude -p`;
- polycli can list and inspect the resulting workflow artifact for the current workspace;
- JSON output distinguishes startup, running, completed, failed, and unobserved states;
- tests prove artifact parsing and tmux-start behavior without requiring live Claude;
- docs clearly state that Agent SDK and `claude -p` are opt-in only due to the 2026-06-15 credit behavior;
- no Path-B runtime abstraction or provider base class is introduced.

## Open Decisions For Implementation Plan

1. The initial workflow artifact location should be `docs/workflows/` unless implementation discovers a stronger existing convention.
2. The initial command can be `workflow` as a companion subcommand group. If host adapters cannot express a nested command cleanly, document the host-specific shape in `docs/host-command-map.md`.
3. `workflow cancel` should remain deferred unless a stable stop primitive exists.
4. Planner execution can remain manual in the first release if direct Codex invocation would add fragile process orchestration.
