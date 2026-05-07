# TUI Inspector MVP Design

## Objective

Build the first terminal UI slice for Q6: a short-lived, read-only inspector over the existing `polycli` debug/run-ledger control plane.

The TUI must make multi-provider runs easier to inspect without inventing a new orchestration engine. It consumes the same facts already available through `debug runs`, `debug show <runId>`, and `debug explain <runId>`, then renders them as navigable run lists, provider status summaries, run details, attempt/event timelines, timing/failure panels, and reproduction commands.

## Problem

The headless CLI can now explain foreground and background provider outcomes, but the operator still has to read raw JSON or text summaries. For multi-provider reviews this is slow because the useful facts are spread across:

- run list summary fields
- raw ledger events
- provider decisions
- attempt result previews
- timing references
- job ids and log file pointers
- redacted argv

The TUI should not add new provider semantics. Its job is to make the existing persisted story visible and scannable.

## Scope

Include:

- A terminal-only `polycli tui` command.
- A dependency-light, short-lived Node.js terminal UI.
- Read-only run inspection.
- Keyboard navigation for run list and detail panes.
- Provider status matrix derived from ledger events.
- Run detail timeline derived from raw events.
- Attempt/timing/failure panel derived from `attempt_result`, `provider_decision`, `health_result`, and `job_started`.
- Reproduction command panel from sanitized `argv`.
- Explicit `unfinished` / `unknown` rendering for runs that have `job_started` or `attempt_started` without a terminal `attempt_result` or `provider_decision`.
- Tests for the pure view model and terminal command routing.
- Packaging/release checks for any new terminal package files.

Exclude:

- No provider execution from inside the TUI.
- No cancel/retry/rerun actions.
- No daemon, server, watch mode, or background monitor.
- No full log ingestion command.
- No clipboard integration.
- No mouse support.
- No new provider runtime abstractions.
- No killed-worker perfect recovery.
- No release version bump in this slice.

## Command Surface

Add a terminal package command:

```text
polycli tui [--run-id <runId>] [--history <count>]
```

Rules:

- `polycli tui` starts on the recent run list.
- `polycli tui --run-id <runId>` opens that run detail directly.
- `--history <count>` limits the initial run list; default should match `debug runs` behavior unless implementation evidence shows a smaller TUI default is safer.
- `--json` is not a TUI option. JSON inspection remains under `debug`.

The command belongs to the terminal CLI surface. Host plugins do not need new slash commands or skills for this slice.

## Architecture

### Terminal Wrapper

Keep the companion behavior as the source of truth. The terminal wrapper should route `polycli tui` to a terminal-package-owned module and leave all existing commands delegated to `polycli-companion.bundle.mjs`.

The TUI module should call the bundled companion with:

- `debug runs --json`
- `debug show <runId> --json`
- `debug explain <runId> --json`

This keeps the TUI as a consumer of stable CLI/debug commands rather than a second reader with subtly different behavior.

### Pure View Model

Build a pure view-model layer that accepts:

- terminal dimensions
- `debug runs` JSON
- `debug show` JSON
- `debug explain` JSON
- current selection state

It returns renderable rows, panes, statuses, and labels. This layer is where tests should prove provider state classification.

### Terminal Renderer

Use Node.js built-ins:

- `readline`
- raw stdin mode
- ANSI escape sequences
- `process.stdout.columns` and `process.stdout.rows`

Avoid adding a UI dependency in the first slice unless implementation proves built-ins are not enough. If a dependency becomes necessary, it must be justified in the plan execution report and covered by packaging tests.

### Data Refresh

First TUI is snapshot-based:

- Load runs at startup.
- Load selected run detail on selection change.
- Provide a keyboard refresh action.
- Do not poll automatically.

This keeps it short-lived and avoids introducing monitor semantics.

## Layout

Use a dense operational layout, not a landing page:

```text
┌ runs ──────────────┬ provider matrix ───────────────┐
│ run_abc  ask       │ qwen adopted     842ms          │
│ run_def  review    │ cmd  failed      ask_failed     │
│ run_xyz  rescue    │ pi   skipped     health_failed  │
├ timeline ──────────┴─────────────────────────────────┤
│ 12:00 run_started terminal                            │
│ 12:01 qwen attempt_started job_123                    │
│ 12:02 qwen adopted preview...                         │
├ detail / repro ───────────────────────────────────────┤
│ argv: polycli ask --provider qwen <prompt:redacted>   │
│ log:  /state/jobs/job_123.log                         │
└ q quit  ↑/↓ select  enter open  b back  r refresh ───┘
```

Responsive behavior:

- Under narrow widths, collapse to one pane at a time: runs, matrix, timeline, detail.
- Under short heights, keep the footer visible and truncate rows.
- Never wrap long run ids or paths into adjacent columns; truncate with an ASCII ellipsis marker such as `...`.

## State Classification

The TUI must classify provider/run state from events:

- `adopted`: at least one `provider_decision status=adopted`.
- `failed`: `provider_decision status=failed`.
- `skipped`: `provider_decision status=skipped`.
- `cancelled`: `provider_decision status=cancelled`.
- `unfinished`: `job_started` or `attempt_started` exists and no terminal `attempt_result` / `provider_decision` exists for that provider/job.
- `unknown`: insufficient events to classify.

Do not invent success or failure for killed-worker gaps. Display `unfinished` / `unknown`, show the last known event, and surface `jobId` / `logFile` when present.

## Keyboard

Minimum controls:

- `q`: quit
- `up` / `down` or `k` / `j`: move selection
- `enter`: open selected run detail
- `b`: return to run list
- `r`: refresh current data
- `tab`: move focus between panes when multiple panes are visible
- `?`: toggle help footer

The first TUI should not perform destructive or provider-running actions.

## Reproduction Commands

Use ledger `argv` only. The displayed command should:

- Prefix with `polycli`.
- Preserve redacted prompt placeholders.
- Quote argv tokens only when needed for shell readability.
- Never reconstruct full prompts or secrets.

If no argv exists, display `not recorded`.

## Error Handling

- If `debug runs --json` fails, show a terminal error screen with stderr/code and exit nonzero after keypress.
- If a selected run disappears or cannot be shown, keep the run list visible and show `run not found`.
- If terminal size is too small, show a single-line message that asks for a larger terminal and keep `q` active.
- If stdin is not a TTY, print a concise error and exit nonzero.

## Tests

Required test layers:

- Pure view-model unit tests for classification, truncation, layout mode, and reproduction command rendering.
- Terminal wrapper tests proving `polycli tui` routes to the TUI module and existing commands still route to the companion.
- Integration-style test with fixture debug JSON proving the TUI can render run list/detail text in a non-interactive smoke mode.
- Packaging tests proving new terminal files are included in the npm tarball.

The implementation may add a hidden test flag such as `POLYCLI_TUI_SMOKE=1` or `--smoke` to render one frame and exit. That flag is test-only and should not be documented as a primary user command.

## Acceptance Criteria

- `polycli tui` opens a read-only TUI from the terminal package.
- Recent runs render without requiring direct access to private companion paths.
- Selecting a run shows provider matrix, timeline, detail, and reproduction command.
- Adopted, failed, skipped, cancelled, unfinished, and unknown states render distinctly in text.
- `started` / `attempt_started` without final events never renders as adopted or failed.
- Existing terminal commands continue to work.
- New package files are present in terminal tarball dry-run.
- Focused tests, `npm test`, and `npm run release:check` pass.

## Deferred

- Full log viewer.
- Clipboard integration.
- Mouse support.
- Watch/auto-refresh mode.
- Retry/rerun/cancel actions.
- Killed-worker perfect recovery.
- Release prep and publishing.
