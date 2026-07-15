# Capturing Runtime Fixtures

Date: 2026-07-14

Purpose: capture real CLI stdout fixtures for `packages/polycli-runtime/test/fixtures/` so parser tests can replay real event shapes without making live API calls in CI.

## Rules

- Capture locally only. Do not run fixture capture in CI.
- Use low-cost prompts with exact short outputs.
- Run each command from an isolated empty working directory and use the most restrictive supported permission mode.
- Commit stdout only for CLI-based providers.
- For `minimax`, commit only the `mmx text chat --output json` stdout fixture.
- Scrub credentials before committing.
- Keep synthetic fixtures and tests. Real fixtures are additive coverage, not replacements.

## Prerequisites

- All provider CLIs installed and authenticated locally.
- The selected account, organization policy, and billing plan permit the requested model call.
- Keep the repository worktree clean; give each provider command an isolated temporary working directory.
- Expect small real API costs because each capture is a real provider call.

## Captures Used

The repository has two named fixture slots per provider. Record the exact invocation in metadata only after a successful real call:

- `claude`
  - `claude -p 'Reply with exactly HELLO_CLAUDE_FIXTURE and nothing else.' --output-format stream-json --verbose --permission-mode plan --max-turns 1 --tools '' --safe-mode --no-session-persistence`
  - `claude -p 'Reply with exactly HELLO_CLAUDE_FIXTURE_ALT and nothing else.' --output-format stream-json --verbose --permission-mode plan --max-turns 1 --tools '' --safe-mode --no-session-persistence`
- `copilot`
  - `copilot -p 'Reply with exactly HELLO_COPILOT_FIXTURE and nothing else.' --output-format json --stream on --mode plan --no-ask-user --excluded-tools bash,apply_patch`
  - `copilot -p 'Reply with exactly HELLO_COPILOT_FIXTURE_ALT and nothing else.' --output-format json --stream on --mode plan --no-ask-user --excluded-tools bash,apply_patch`
  - The local subscription capture route is temporarily archived. Do not re-capture until a suitable plan is explicitly approved and the authenticated route has been re-verified.
- `gemini`
  - `gemini -p 'Reply with exactly HELLO_GEMINI_FIXTURE and nothing else.' -o stream-json --approval-mode plan`
  - `gemini -p 'Reply with exactly HELLO_GEMINI_FIXTURE_ALT and nothing else.' -o stream-json --approval-mode plan`
  - The current Google sign-in route for Gemini Code Assist individuals is retired in this workspace. Google announced that consumer requests stop on 2026-06-18, while enterprise licenses and paid API keys remain separate routes: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/ Do not re-capture through the retired route; an API Key or Vertex AI route requires separate authorization and a successful real capture before reactivation.
- `kimi`
  - `kimi -p 'Reply with exactly HELLO_KIMI_FIXTURE and nothing else.' --output-format stream-json`
  - `kimi -p 'Reply with exactly HELLO_KIMI_FIXTURE_ALT and nothing else.' --output-format stream-json`
- `opencode`
  - `opencode run 'Reply with exactly HELLO_OPENCODE_FIXTURE and nothing else.' --format json --dir "$PWD" --agent plan`
  - `opencode run 'Reply with exactly HELLO_OPENCODE_FIXTURE_ALT and nothing else.' --format json --dir "$PWD" --agent plan`
- `opencode2` (OpenCode 2 preview compatibility channel; does not replace the stable `opencode` runtime)
  - `opencode2 run 'Reply with exactly HELLO_OPENCODE2_FIXTURE and nothing else.' --format json --agent plan`
  - `opencode2 run 'Reply with exactly HELLO_OPENCODE2_FIXTURE_ALT and nothing else.' --format json --agent plan`
  - Run from the isolated working directory directly: this CLI has no `--dir` or standalone `--variant` flag.
- `pi`
  - `pi --print --mode json --no-tools --session-dir /tmp/polycli-pi-sessions 'Reply with exactly HELLO_PI_FIXTURE and nothing else.'`
  - `pi --print --mode json --no-tools --session-dir /tmp/polycli-pi-sessions 'Reply with exactly HELLO_PI_FIXTURE_ALT and nothing else.'`
- `qwen`
  - `qwen --safe-mode --output-format stream-json --approval-mode plan --max-session-turns 1 'Reply with exactly HELLO_QWEN_FIXTURE and nothing else.'`
  - `qwen --safe-mode --output-format stream-json --approval-mode plan --max-session-turns 1 'Reply with exactly HELLO_QWEN_FIXTURE_ALT and nothing else.'`
- `minimax`
  - `mmx text chat --message 'Reply with exactly HELLO_MINIMAX_FIXTURE and nothing else.' --output json --non-interactive`
  - `mmx text chat --message 'Reply with exactly HELLO_MINIMAX_FIXTURE_ALT and nothing else.' --output json --non-interactive`
- `grok`
  - `grok -p 'Reply with exactly HELLO_GROK_FIXTURE and nothing else.' --output-format streaming-json -m grok-4.5 --permission-mode plan --disable-web-search --max-turns 1`

## Scrubbing Policy

Before writing fixtures, scrub:

- absolute repo paths -> `/repo`
- home-directory paths -> `/home/user`
- obvious credential fields such as `api_key`, `authorization`, and `token` values -> `[REDACTED]`
- opaque request, response, and tool-call ids -> `[REDACTED]`, unless a parser test explicitly needs a session id
- reasoning text, model signatures, plugin or MCP inventories, tool inputs/results, usage, cost, and rate-limit data -> remove

Retain only the minimum session id and event fields that a parser test requires. Do not preserve opaque metadata merely because it appeared in a real stream.

## File Layout

- `packages/polycli-runtime/test/fixtures/<provider>/<name>.stream.txt`
- `packages/polycli-runtime/test/fixtures/<provider>/<name>.meta.json`

Each `.meta.json` stores:

- `provider`: provider id, matching the fixture directory
- `name`: fixture name, matching the file stem before `.meta.json`
- `capturedAt`: ISO timestamp for the real CLI capture
- `version`: CLI version string observed during capture
- `argv`: non-empty argv array used for capture
- `expected.response`: exact visible assistant response expected by replay tests
- `expected.sessionId`: optional string session id when the provider emits one
- `lifecycle`: optional exclusion record: temporary `status: "archived"` with canonical UTC ISO `archivedAt`, or permanent `status: "retired"` with canonical UTC ISO `retiredAt`; both require a non-empty capture-route `reason`
- for `minimax`: `expected.finishReason` (non-empty string) and `expected.toolCalls` (array), matching the `mmx` JSON replay result

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
5. before a release, re-run `npm run check:fixture-freshness -- --strict`; this fails on stale version rows, while unavailable or unprobeable CLIs are reported as skips for release review
6. call out any fixture-driven parser changes explicitly in the commit message

If account access, organization policy, or billing prevents a live call, preserve the prior fixture and report the blocker. Do not turn an error stream into a successful fixture.

Do not rewrite historical fixture metadata just to match a newer invocation flag. Re-capture it with an explicitly authorized real provider call so the saved stream and its recorded argv remain truthful.

## Archived and Retired Capture Channels

When a capture route is intentionally paused, retain its historical parser fixture and add this `lifecycle` object to every affected metadata file:

```json
{
  "status": "archived",
  "archivedAt": "<canonical UTC ISO timestamp, e.g. 2026-07-15T00:00:00.000Z>",
  "reason": "temporary capture pause and reactivation condition"
}
```

Use `archived` only for a deliberately temporary pause. Remove it only after an explicitly authorized, successful real re-capture of every affected fixture slot.

For a permanently unavailable route, use `retired` instead:

```json
{
  "status": "retired",
  "retiredAt": "<canonical UTC ISO timestamp, e.g. 2026-07-15T00:00:00.000Z>",
  "reason": "specific capture route and retirement evidence"
}
```

`npm run check:fixture-freshness -- --strict` reports `archived` and `retired` rows separately from stale rows, and still fails for any other stale provider. Either status records a capture-channel state only; it does not remove or globally retire the corresponding runtime provider.
