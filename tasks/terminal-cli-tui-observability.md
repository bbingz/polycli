# Terminal CLI/TUI and run ledger observability

Status: Spec 1 released in v0.6.7; Spec 2 and Spec 3 released in v0.6.8; Phase 5/6/7 follow-up hardening landed after v0.6.8.
Source: real Codex multi-provider review after v0.6.x host-adapter hardening.
Roadmap anchor: `docs/roadmap.md` Q6.
First spec: `docs/superpowers/specs/2026-05-07-terminal-cli-ledger-foundation-design.md`.
Second spec: `docs/superpowers/specs/2026-05-07-background-job-ledger-plumbing-design.md`.
Third spec: `docs/superpowers/specs/2026-05-07-tui-inspector-mvp-design.md`.

## Context

Polycli now ships as host plugins, a PATH-callable terminal CLI, and a shared companion bundle. The original track addressed two operational gaps:

- Agents could misclassify Polycli as a missing shell tool when no stable PATH-callable `polycli` binary existed.
- Failed multi-provider runs were hard to debug because state was split across `state.json`, `jobs/<id>.json`, `jobs/<id>.log`, and `timings.ndjson`, with no durable run-level explanation of health, attempts, retries, skip/adopt decisions, and raw log pointers.

The concrete failure case that triggered this track:

- Adopted provider output: `gemini`, `copilot`, `kimi`, `qwen`, `minimax`, `claude`, `opencode`.
- `cmd`: health passed, but two ask attempts failed, so it was not adopted.
- `pi`: health failed, so it was skipped before prompt-bearing work.

The target is not a daemon and not a provider framework. The target is a short-lived terminal CLI plus a TUI inspector over the same persisted control plane.

## Follow-up

- README now points unsupported hosts at the real `@bbingz/polycli` terminal CLI while keeping host-plugin invocation rules explicit.
- Keep the host plugins. The terminal CLI/TUI is a fifth surface, not a replacement for Claude Code, Codex, Copilot CLI, or OpenCode adapters.
- Preserve the current `setup` vs `health` distinction: default `setup` is install plus status-only auth inspection and skips model-based auth probes unless passed `--probe-auth`; `health` is a real model probe and should not become a routine preflight.
- Do not promote `@bbingz/polycli-runtime` into a public provider framework as part of this work. The CLI should wrap existing companion semantics while provider modules remain flat and explicit.
- Do not add daemon, monitor, or server mode. Every command and TUI session should be short-lived and compatible with the current timing contract.
- Preserve the captured `cmd` ask failure and `pi` health failure examples as schema-shaped docs/fixtures; live provider repro remains environment-gated.
- Treat debug retention as local and redacted by default. Persist enough to reproduce and explain failures, but do not store secrets or full prompts in the first slice.

## Roadmap

### Phase 0 - Contract boundary

- Choose package and binary shape, likely a new terminal-facing package with `bin.polycli`.
- Define which commands are public terminal contract: `setup`, `health`, `ask`, `review`, `adversarial-review`, `rescue`, `status`, `result`, `cancel`, `timing`, plus new run-inspection commands.
- Keep existing JSON shapes stable where the terminal command mirrors companion behavior.
- Document what remains internal: provider runtime imports, private bundle paths, and host-adapter implementation details.

### Phase 1 - Headless CLI parity

- Add PATH-callable `polycli` command parity for current companion commands.
- Ensure `polycli --help` and subcommand help match the companion command vocabulary.
- Support `--json` passthrough without summarizing or reshaping payloads.
- Print state directory, companion version/source, and reproducible command hints in verbose/debug modes.
- Add release checks for package `bin`, command help, and host-map parity.

### Phase 2 - Run ledger and diagnostics

- Add a run ledger independent of the existing recent-job list and timing history.
- Generate a stable `runId` for every foreground/background `health`, `ask`, `review`, `adversarial-review`, and `rescue` invocation.
- Generate an `attemptId` for every provider attempt, including failed foreground attempts.
- Persist health probe results, prompt-bearing attempts, retries, skips, adopts, timing links, raw log pointers, sanitized argv, and failure classifications.
- Add inspection commands as shared companion diagnostics: `polycli debug runs`, `polycli debug show <runId>`, and `polycli debug explain <runId>`. Keep full log viewing for a later TUI/log-viewer slice.

### Phase 3 - TUI inspector

- Build the TUI only after Phase 1 and Phase 2 can answer the `cmd` and `pi` failure case from persisted state.
- Scope the first TUI to provider matrix, run list, run detail, attempt log viewer, timing/failure panels, and copyable reproduction commands.
- Keep TUI actions as wrappers over stable CLI commands rather than a separate orchestration engine.
- Make provider differences visible instead of smoothing them into a fake unified schema.

### Phase 4 - Documentation and release guardrails

- Update README "Outside a supported host" to point normal users at the real terminal CLI.
- Add a terminal column to `docs/host-command-map.md`.
- Update `docs/polycli-v1-public-surface.md` with the terminal CLI contract.
- Extend `npm run release:check` to validate terminal package metadata, help text, host-map parity, ledger redaction fixtures, and generated bundle/CLI drift.

## To-do

- [x] Decide package name, npm publish name, and binary name: `packages/polycli-terminal`, npm package `@bbingz/polycli`, binary `polycli`.
- [x] Decide whether terminal CLI imports source modules directly or shells through a bundled companion in the first release: use a wrapper around the same bundled companion.
- [x] Keep command behavior in the companion for Spec 1; do not extract a new runner until the debug/ledger surface proves it needs one.
- [x] Design the run ledger schema with `runId`, `attemptId`, `jobId`, `provider`, `kind`, `hostSurface`, `cwd`, `workspaceSlug`, `model`, `defaultModel`, timestamps, duration, status, signal, timeout, error code, error message, response preview, stdout/stderr byte counts, raw log path, timing link, skip reason, adopt decision, retry ordinal, and sanitized argv.
- [x] Add redaction helpers for argv/env/log previews and tests for common secret-looking values.
- [x] Persist `health` payloads per provider, including `available`, `availabilityDetail`, `model`, `probe.ok`, `responseMatched`, `responsePreview`, `error`, and timing.
- [x] Persist foreground `ask` / `review` / `adversarial-review` / `rescue` failures, not only background job results.
- [x] Add `cmd` regression coverage for health passing but repeated ask attempts failing.
- [x] Add `pi` regression coverage for health failure leading to explicit skipped-provider state. (Captured as fixture `pi-health-failure.meta.json`; live integration test wired to real `pi` deferred to follow-up slice that gates on environment availability.)
- [x] Add ledger rotation and corrupt-file recovery behavior parallel to existing state-file recovery.
- [x] Add `debug runs`, `debug show`, and `debug explain` before building the TUI; keep `debug logs` for a later log-viewer slice.
- [x] Add docs examples for the concrete failure case: `cmd health passed but ask failed twice`; `pi health failed and skipped`. Documented in `docs/polycli-v1-public-surface.md` under "Run ledger debug examples".
- [x] Update `docs/roadmap.md`, README, host command map, and public-surface docs when each phase lands.
- [x] Wire `runId` + `hostSurface` through job-config so background workers also append `job_started`/`attempt_started`/`attempt_result`/`provider_decision` events. Plan: `docs/superpowers/plans/2026-05-07-background-job-ledger-plumbing.md`.
- [x] Killed-worker terminal-event recovery: debug scan-on-read now refreshes dead jobs with residual run context and appends missing terminal ledger events idempotently. It classifies no-envelope deaths as `worker_exited` rather than inventing provider output.
- [x] Build first read-only terminal TUI inspector. Plan: `docs/superpowers/plans/2026-05-07-tui-inspector-mvp.md`.
- [x] Show local job log file pointers in the TUI without reading or printing log contents.
- [x] First TUI renders started/attempt_started-without-final-event as unfinished/unknown; scan-on-read recovery covers dead workers with residual run context.

## Non-goals

- No long-lived daemon, monitor, local server, or background supervisor.
- No shared provider base class.
- No public promotion of provider runtime internals.
- No unified event schema that collapses provider-specific semantics.
- No TUI-first implementation before headless CLI and run ledger diagnostics work.
