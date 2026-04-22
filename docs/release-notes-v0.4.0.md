# Release Notes Draft - v0.4.0

Status: draft for the next external release steps.

Release date target: 2026-04-22 or later, when tag / push / GitHub release / npm publish are executed.

## Highlights

- Added and hardened provider runtimes for `claude`, `copilot`, `opencode`, `pi`, `gemini`, `kimi`, `qwen`, and `minimax`.
- Tightened streamed parser correctness around visible-text extraction, terminal error handling, session id capture, and timing boundaries.
- Locked `/review` into provider-specific no-tools hard constraints instead of prompt-only guidance.
- Eliminated the background-job cancel/completion race with one lock-protected compare-and-swap path.
- Hardened local durability with atomic file fsync + parent-directory fsync and PID-aware lockfile ownership.
- Added real saved-stdout replay fixtures for all eight providers so parser regressions are tested against actual CLI output shapes.

## User-Facing Changes

- `setup`, `ask`, `review`, `rescue`, `result`, and `timing` flows now work through the shared runtime surface for all eight providers.
- Background review workers now preserve provider-specific runtime options and surface auto-scope warnings when git fallback resolution fails.
- Host preview text no longer splits emoji mid-surrogate pair, and repeated streamed preview blocks no longer trigger O(n^2) log rereads.
- Review executions now apply hard no-tools constraints for `claude`, `gemini`, `copilot`, `opencode`, `pi`, and `minimax`.

## Fixes Since v0.3.0

- `claude`
  - `stream-json` invocations now add `--verbose`.
  - sync and streaming paths both treat subtype-only terminal errors as failures.
  - session id resolution respects stdout / stderr / file priority consistently.
- `copilot`
  - parser accepts the real `assistant.message_delta` and `assistant.message` schemas.
  - standalone `type:"error"` terminal events now fail correctly.
  - non-zero exits no longer leak stdout as fallback error text.
- `opencode`
  - parser accepts real `type:"text"` and `message.delta` output shapes.
  - standalone `type:"error"` terminal events now fail correctly.
  - `/review` no longer relies on `--dangerously-skip-permissions`; it injects a deny-all config and uses a non-writing agent mode.
- `pi`
  - parser captures top-level session envelopes and no longer falls back to generic `event.text`.
  - auth probing treats transient failures as inconclusive instead of logged-out.
- `gemini`
  - no longer falls back to arbitrary `event.text`.
  - empty-output runs now fail with `gemini produced no visible text`.
  - terminal summary events are excluded from timing extension.
- `kimi`
  - supports string assistant content.
  - no-text clean exits now fail explicitly.
  - auth probing now matches the transient-probe pattern used by other CLIs.
- `qwen`
  - auth probing no longer depends on `qwen auth status`.
  - result-only success/error flows are handled correctly in both foreground and streaming paths.
- `minimax`
  - replay coverage now includes real stdout plus real log-body parsing fixtures.

## Reliability / Data Integrity

- `state.json` corruption is now preserved as `state.json.corrupt-<timestamp>` before recovery.
- Timed-out detached children escalate from `SIGTERM` to `SIGKILL` at the process-group level when supported.
- Timing aggregation keeps `measured`, `zero`, `missing`, and `unsupported` distinct.
- Atomic writes now fsync the temp file before rename and fsync the parent directory after rename.
- Lockfiles now use owner-PID liveness instead of mtime-based stale detection.

## Test Coverage

- Added host-plugin hygiene regressions for preview dedupe, emoji-safe preview slicing, and auto-scope warnings.
- Added real-fixture replay cases for every provider while keeping the synthetic parser-shape tests.
- Current local verification at release-prep time: `npm test` -> `184` passed, `0` failed.

## Packaging Notes

- Release-facing host artifacts are bumped to `0.4.0`:
  - `plugins/polycli/.claude-plugin/plugin.json`
  - `plugins/polycli-codex/.codex-plugin/plugin.json`
  - `plugins/polycli-copilot/plugin.json`
  - `plugins/polycli-opencode/package.json`
- Internal workspace packages remain at `1.0.0`.
  - Reason: they were already at `1.0.0`; downgrading them to `0.4.0` would be a semver regression, and they are not the externally published release line for this tag.
