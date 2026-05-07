# polycli v0.6.7

Adds a standalone terminal CLI plus a redacted run ledger on top of `v0.6.6`.

## What changed

- New npm package `@bbingz/polycli` (terminal CLI) wraps the same companion bundle that host adapters ship. Install with `npm install -g @bbingz/polycli` for environments without Claude Code, Codex, Copilot CLI, or OpenCode.
- Added shared `debug` companion vocabulary: `debug runs`, `debug show <run-id>`, `debug explain <run-id>` — surfaced as `/polycli:debug` (Claude), `Choose Polycli with @, then ask it to run: debug` (Codex), `polycli debug` (Copilot, terminal), and `polycli_run(["debug", ...])` (OpenCode).
- Added redacted append-only run ledger (NDJSON) per workspace. Every `health`, `ask`, `rescue`, `review`, and `adversarial-review` run records `run_started`, `attempt_started`, `attempt_result`, `provider_decision` (adopted / failed / skipped), and `run_summary` events with stable `runId`, `workspaceSlug`, and `hostSurface`.
- Added global `--run-id <id>` (or `POLYCLI_RUN_ID` env var) that joins multi-command flows into one ledger run and is stripped before provider/positional parsing.
- `argv` redaction covers all prompt and focus positionals, secret-bearing long options (`--token`, `--api-key`, …), inline `KEY=value` env-style assignments, and the defensive `--focus` flag for review commands. `provider`, `model`, `json`, `background`, and `run-id` stay visible.
- `review` / `adversarial-review` with no diff now write a `provider_decision` with `status=skipped` and `reason=no_changes`.
- Build / release guardrails: a fifth byte-identical companion bundle target (`packages/polycli-terminal/bin/polycli-companion.bundle.mjs`); `validate:host-map` requires the new `debug` row plus a Terminal CLI mention; `validate:manifests` cross-checks the terminal package version; `release:check` runs `npm publish ./packages/polycli-terminal --dry-run` and `open-source-packaging.test.mjs` asserts the tarball ships `LICENSE`.

## Verification targets

- `node --test plugins/polycli/scripts/tests/run-ledger.test.mjs plugins/polycli/scripts/tests/integration.test.mjs plugins/polycli/scripts/tests/host-packaging.test.mjs scripts/tests/validate-plugin-bundles.test.mjs scripts/tests/open-source-packaging.test.mjs`
- `npm test`
- `npm run release:check`

## Publish notes

This release adds a new npm package. After GitHub tag / release, also publish the terminal CLI:

```bash
npm publish ./packages/polycli-terminal --access public
```

See `docs/release.md` for the full sequence.
