# Capturing Runtime Fixtures

Date: 2026-04-22

Purpose: capture real CLI stdout fixtures for `packages/polycli-runtime/test/fixtures/` so parser tests can replay real event shapes without making live API calls in CI.

## Rules

- Capture locally only. Do not run fixture capture in CI.
- Use low-cost prompts with exact short outputs.
- Commit stdout only for CLI-based providers.
- For `minimax`, also commit the referenced log file because the runtime parses the log body, not just stdout.
- Scrub credentials before committing.
- Keep synthetic fixtures and tests. Real fixtures are additive coverage, not replacements.

## Prerequisites

- All provider CLIs installed and authenticated locally.
- Run captures from the repo root.
- Expect small real API costs because each capture is a real provider call.

## Captures Used

Two captures were recorded per provider:

- `claude`
  - `claude -p 'Reply with exactly HELLO_CLAUDE_FIXTURE and nothing else.' --output-format stream-json --verbose --max-turns 1`
  - `claude -p 'Reply with exactly HELLO_CLAUDE_FIXTURE_ALT and nothing else.' --output-format stream-json --verbose --max-turns 1`
- `copilot`
  - `copilot -p 'Reply with exactly HELLO_COPILOT_FIXTURE and nothing else.' --output-format json --stream on --allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user`
  - `copilot -p 'Reply with exactly HELLO_COPILOT_FIXTURE_ALT and nothing else.' --output-format json --stream on --allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user`
- `gemini`
  - `gemini -p 'Reply with exactly HELLO_GEMINI_FIXTURE and nothing else.' -o stream-json --approval-mode plan`
  - `gemini -p 'Reply with exactly HELLO_GEMINI_FIXTURE_ALT and nothing else.' -o stream-json --approval-mode plan`
- `kimi`
  - `kimi -p 'Reply with exactly HELLO_KIMI_FIXTURE and nothing else.' --print --output-format stream-json`
  - `kimi -p 'Reply with exactly HELLO_KIMI_FIXTURE_ALT and nothing else.' --print --output-format stream-json --no-thinking --max-steps-per-turn 1`
- `opencode`
  - `opencode run 'Reply with exactly HELLO_OPENCODE_FIXTURE and nothing else.' --format json --dir \"$PWD\" --dangerously-skip-permissions`
  - `opencode run 'Reply with exactly HELLO_OPENCODE_FIXTURE_ALT and nothing else.' --format json --dir \"$PWD\" --agent plan`
- `pi`
  - `pi --print --mode json 'Reply with exactly HELLO_PI_FIXTURE and nothing else.'`
  - `pi --print --mode json --no-tools 'Reply with exactly HELLO_PI_FIXTURE_ALT and nothing else.'`
- `qwen`
  - `qwen --output-format stream-json --approval-mode auto-edit --max-session-turns 20 'Reply with exactly HELLO_QWEN_FIXTURE and nothing else.'`
  - `qwen --output-format stream-json --approval-mode plan --max-session-turns 1 'Reply with exactly HELLO_QWEN_FIXTURE_ALT and nothing else.'`
- `minimax`
  - `mini-agent -t 'Reply with exactly HELLO_MINIMAX_FIXTURE and nothing else.' -w \"$PWD\"`
  - `mini-agent -t 'Reply with exactly HELLO_MINIMAX_FIXTURE_ALT and nothing else.' -w \"$PWD\"`

## Scrubbing Policy

Before writing fixtures, scrub:

- absolute repo paths -> `/repo`
- home-directory paths -> `/home/user`
- obvious credential fields such as `api_key`, `authorization`, and `token` values -> `[REDACTED]`

Session ids and ordinary request metadata were left intact because they are part of the parse contract and are not authentication secrets.

## File Layout

- `packages/polycli-runtime/test/fixtures/<provider>/<name>.stream.txt`
- `packages/polycli-runtime/test/fixtures/<provider>/<name>.meta.json`
- `packages/polycli-runtime/test/fixtures/minimax/<name>.log.txt` for mini-agent log-body replay

Each `.meta.json` stores:

- `provider`: provider id, matching the fixture directory
- `name`: fixture name, matching the file stem before `.meta.json`
- `capturedAt`: ISO timestamp for the real CLI capture
- `version`: CLI version string observed during capture
- `argv`: non-empty argv array used for capture
- `expected.response`: exact visible assistant response expected by replay tests
- `expected.sessionId`: optional string session id when the provider emits one

The metadata contract is release-checked by:

```bash
npm run validate:fixtures
```

Run it after adding or recapturing fixtures. The command does not call provider CLIs; it only validates committed metadata shape.

## Re-capture Policy

Re-capture fixtures when:

- a provider CLI major/minor version changes its event shape
- parser logic changes and the saved stdout no longer reflects the real runtime
- release verification shows a real CLI shape that synthetic tests still miss

When re-capturing:

1. overwrite the existing fixture files
2. inspect the diff for parser-shape changes
3. re-run `node --test packages/polycli-runtime/test/*.test.js`
4. re-run `npm run validate:fixtures`
5. call out any fixture-driven parser changes explicitly in the commit message
