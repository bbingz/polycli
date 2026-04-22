# Commit Review — fb64b1e `fix: harden review follow-up invariants`

Follow-up review of Codex's response to `docs/review-2026-04-22.md`. Written for the next fix-batch.

**Commit stats:** 31 files, +2,350 / -700 lines, 23 new tests (123 → 146 total, all passing).

**Verdict: A-.** All 6 P0 ship blockers fixed with correct semantics and regression tests. Most of the mechanical P1 work (pattern replication, data locking, secret-leak paths) is done. 5 P1 items intentionally deferred — they require per-CLI research or independent durability work.

**Follow-up update (2026-04-22):** Group 1 is now complete in the next local batch. The runtime no longer accepts generic `event.text` fallback in `opencode` / `pi` / `gemini`, `copilot` and `opencode` now treat standalone `type:"error"` events as terminal failures, gemini now fails when no visible assistant text is emitted, and `registry.isTerminalSummaryEvent()` now includes gemini `type:"result"`. Regression coverage was added for all four fixes, and the bundled gemini integration fixture was tightened to emit an explicit assistant message shape so full-test coverage matches the stricter parser contract. Current verification: `npm test` passes `152 / 152`.

---

## P0 — all fixed

| # | Item | Fix location | Notes |
|---|---|---|---|
| P0-1 | `runProviderPrompt` missing `supportedMetrics` | `registry.js:258` | One-line `supportedMetrics: getTimingSupport(provider)` — minimal diff as suggested. |
| P0-2 | cancel vs completion race | `state.mjs` new `updateJobAtomically` + `job-control.mjs` cancel + `polycli-companion.mjs` worker completion | Single `withLockfile` scope wraps state read + CAS + envelope write + state write. Worker completion checks `latest.status === "cancelled"` before writing envelope, returns `{ written: false }` if stale. Clean pattern. |
| P0-3 | state corruption silent overwrite | `state.mjs` `backupCorruptStateFile` | Renames to `state.json.corrupt-<ISO>` before returning default. Covered by new test. |
| P0-4 | SIGTERM → SIGKILL escalation + process group kill | `spawn.js` `signalChild` + `killGraceMs` (default 2s) | Uses `process.kill(-pid, signal)` only when `detached === true && process.platform !== "win32"`. Windows branch preserved. |
| P0-5 | UUID v6/v7/v8 rejected by regex | `session-id.js:2` | Version nibble `[1-5]` → `[0-9a-f]`. See "Minor nits" below. |
| P0-6 | `measured` and `zero` collapsed into one percentile input | `aggregate.js` | `values` renamed to `measuredValues`; `zero` no longer pushed; percentile computed over `measuredValues` only. New derived `capability: "unsupported" | "supported" | "mixed"` field per metric. Matches the fix spec. |

---

## P1 — fixed

| # | Item | Status |
|---|---|---|
| P1-A | Transient probe pattern for opencode / pi / kimi / qwen | Fixed. Each provider now has `<X>_EXPLICIT_AUTH_ERROR_RE` + `<X>_TRANSIENT_PROBE_ERROR_RE` + a `buildXAuthStatus(result)` helper with three branches (explicit → `loggedIn:false`; transient → `loggedIn:true, detail:"auth probe inconclusive: …"`; fallback → `loggedIn:false`). Also dropped the spurious `qwen auth status` subcommand call. |
| P1-B | All providers route session id through `resolveSessionId` | Fixed for claude / copilot / gemini / kimi / opencode / pi / qwen. All use `priority: ["stdout", "stderr", "file"]`. Kimi's prior stderr-only call is gone. |
| P1-G | `jobs/<id>.json` writes not lock-protected | Fixed as a side effect of P0-2. `updateJobAtomically` writes the envelope inside the same `withLockfile` scope. |
| P1-H | stdout used as error fallback (secret leak path) | Fixed in kimi / copilot / pi / qwen (diff-visible). Claude and opencode verified clean via `grep stdout.trim` — zero matches remaining across the runtime package. |

---

## P1 — deferred, recommended next-batch

### Group 1 — streaming parser consistency (do together)

One batch, one theme: "terminal / non-assistant events must not pollute ttft/tail, and failure events must not be missed." All four items touch the same stream-parse surfaces.

**P1-C** — `opencode.js:69`, `pi.js:59`, `gemini.js:45` still carry a generic `typeof event.text === "string"` fallback. `tool_result`, `step_finish`, and other non-assistant events with a `text` field leak into `response` and into the ttft/tail timing window.
*Fix:* drop the generic branch. Keep only the explicit event-type branches (`type:"text"` / `type:"message"` / `type:"result"` as appropriate).

**P1-D** — `copilot.js` and `opencode.js` parsers still only capture `type:"result"` into `resultEvent` and check `is_error` / `exitCode` / `resultEvent?.error`. Real CLI flows also emit `type:"error"` as a standalone terminal event, which is currently silently ignored.
*Fix:* capture both `type:"result"` and `type:"error"` into `resultEvent`, and include `event.error`/`event.error?.message`/`event.status` in the failure predicate.

**P1-E** — `runGeminiPromptStreaming` returns `error: result.ok ? null : result.error` without a `hasVisibleText` check. Other six streamed providers fail with `"<provider> produced no visible text"` when `!response.trim()`.
*Fix:* mirror the pattern — `ok: result.ok && !resultError && hasVisibleText`, and fail with `"gemini produced no visible text"` when the response is empty.

**Registry gap** — `registry.js:211-217` `isTerminalSummaryEvent` covers qwen / claude / opencode / copilot / pi but not gemini. If gemini emits a terminal `type:"result"` with text, it extends the visible-text window incorrectly.
*Fix:* add `if (provider === "gemini") return event.type === "result";`.

### Group 2 — data durability (independent batch)

**P1-F** — `atomic-save.js` untouched. Two related durability gaps remain:
- `writeFileAtomic` does not `fsync` the tmp file before rename, and does not `fsync` the parent directory after rename. Classic ext4 / APFS rename-truncate data-loss window.
- Stale-lock reclaim is based on `mtime`, but the lock owner never touches the lockfile after creation. A long-running critical section can be mis-classified as stale and dual-owned.

*Fix:* open with fd → `write` → `fsync(fd)` → `close` → `rename` → open parent dir → `fsync`. For the lock: either have the owner periodically `utimesSync`, or write owner PID and check liveness via `process.kill(pid, 0)` before unlinking.

### Group 3 — `/review` CLI hard constraints (per-provider research)

**P1-I** — `polycli-companion.mjs:507-571` still delivers the no-tools rule only as prompt text for claude / gemini / copilot / opencode / pi / minimax. Claude specifically defaults to `maxTurns: 10` and `permissionMode: "acceptEdits"`, so a `/review` call can actually spawn tool invocations.

*Fix:* per-provider `runtimeOptions.extraArgs`:
- claude: `--max-turns 1 --disallowed-tools ...`
- gemini: equivalent approval-mode / max-steps flag
- opencode / copilot / pi: equivalent max-steps / no-tools flag
- minimax: constrain in the agent config

Needs CLI-flag verification for each provider before merging.

---

## Minor nits on the fixes

- **UUID regex permissiveness** — `session-id.js:2` loosened to `[0-9a-f]`, which accepts version nibbles `0, 9, a, b, c, d, e, f` that are reserved/invalid per RFC 9562. Stricter alternative is `[1-8]`. Low priority — the current regex covers v7 correctly.
- **Duplicate transient/explicit regex literals** — the four provider files each define identical `<X>_EXPLICIT_AUTH_ERROR_RE` and `<X>_TRANSIENT_PROBE_ERROR_RE`. These are cross-provider by nature. Consolidating into a single helper in `@bbingz/polycli-utils` would be justified, though it sits at the edge of the Path B rule "do not move provider-specific logic into utils." Auth-probe classification is generic enough to qualify.
- **`writeJobConfigFile` still unlocked** — job config files are written once during job creation, not concurrently with cancel/completion, so this is benign. Noting for completeness in case config rewrites become a thing.
- **Timing record for cancelled-but-late-completing jobs** — `appendTimingRecord` runs outside the lock after `write.written === true`. If cancel fires between the lock release and the NDJSON append, a timing record for a cancelled job still gets written. Probably acceptable (timing is observability, not state).

---

## Positive observations beyond spec

- **Test DI via `promptRunner` / `envBuilder`** injection into `getKimiAuthStatus` / `getOpenCodeAuthStatus` / `getPiAuthStatus` / `getQwenAuthStatus` makes the transient-probe logic testable in isolation. Nice touch.
- **Qwen streaming error branch** simplified from `(resultEventError || "qwen produced no visible text")` to a direct string — unreachable branch removed, matching the earlier agent-finding #24.
- **23 new regression tests** include exactly the scenarios flagged as high-risk: `loadState preserves backup when corrupt`, `updateJobAtomically skips stale worker writes after cancellation`, UUIDv7 parsing, aggregate measured+zero separation, spawn SIGKILL escalation.
- **Platform-aware process-group kill** — `detached && process.platform !== "win32"` guard prevents a regression on Windows.

---

## Suggested next-commit order

1. **Group 1 (streaming parser consistency)** — P1-C + P1-D + P1-E + registry gemini branch. Single diff per provider, all share the same theme, all get the same test shape ("non-assistant event should not contribute to response or timing").
2. **Group 2 (atomic-save durability)** — P1-F standalone. Requires careful sync write + rename + parent-dir fsync; add a crash-simulation test.
3. **Group 3 (`/review` hard constraints)** — P1-I. Requires per-provider CLI-flag verification; schedule a research pass first to confirm each provider's equivalent of `--max-turns 1 --disallowed-tools`.

After these three batches, the original review's P0/P1 scope is cleared. P2 and P3 (parser minor bugs, test coverage gaps, UX nits, exit-code mapping, listModels) remain as release-scheduled items.

---

## Files reviewed in this pass

Source changed in commit:

- `packages/polycli-utils/src/session-id.js`
- `packages/polycli-timing/src/aggregate.js`
- `packages/polycli-runtime/src/{registry,spawn,claude,copilot,gemini,kimi,opencode,pi,qwen}.js`
- `plugins/polycli/scripts/lib/{state,job-control}.mjs`
- `plugins/polycli/scripts/polycli-companion.mjs`

Source verified unchanged but checked for post-fix state:

- `packages/polycli-runtime/src/timing.js` (cold/retry still `unsupported` — correct per project decision)
- `packages/polycli-utils/src/atomic-save.js` (fsync gap remains, see Group 2)
- `packages/polycli-runtime/src/{claude,opencode}.js` (stdout-as-error paths verified clean via grep)

Tests run: `npm test` → 146 / 146 passing.

---

## Follow-up commit 6636b7a `fix: tighten streaming parser invariants` — verdict A

Group 1 executed cleanly. `npm test` → 152 / 152 passing (+6 new regression tests across opencode / pi / gemini / copilot / registry).

**All four Group 1 items landed:**

- **P1-C (generic `event.text` fallback dropped)** — `pi.js` removed the branch entirely; `opencode.js` kept only the explicit `type === "text"` branch and added a new `type === "message.delta"` branch; `gemini.js` now gates every text extraction on `type === "result"` or `type === "message"`. No code path extracts text from untyped events.
- **P1-D (`type:"error"` terminal event captured)** — extracted as `getCopilotResultError` / `getOpenCodeResultError` pure helpers handling both `type:"result"`/`"final"` and standalone `type:"error"`, checking `error.message` / string `error` / `is_error` / `exitCode` / `status` with consistent fallback text. `parseCopilotStreamText` and `parseOpenCodeStreamText` both fold `type:"error"` into `resultEvent`. Sync and streaming paths share the helper so they cannot drift.
- **P1-E (gemini visible-text check)** — `runGeminiPromptStreaming` now follows the canonical six-provider shape: `ok: result.ok && !resultError && hasVisibleText`, fails with `"gemini produced no visible text"`. `parseGeminiStreamText` also returns a `resultEvent` so the error-extraction step has a canonical input. Result text is only folded into `response` when no earlier assistant text exists (`if (!response.trim())`), matching qwen's constraint-4 style.
- **Registry terminal gap** — `registry.js` adds a gemini branch returning `event.type === "result"` to `isTerminalSummaryEvent`, preventing terminal summary text from extending the ttft/tail window.

**Beyond-spec improvements:**

- Extracted `getCopilotResultError` and `getOpenCodeResultError` as reusable pure helpers rather than inline ternaries; this eliminates the sync / streaming drift risk that the original review called out and makes the error-shape contract visible in one place.
- gemini extractor priority is now strict: `type === "result"` with explicit `event.text` wins; `type === "message"` branches require `role === "assistant"` (or no role); untyped events return empty. The old "any event with a text-ish field is assistant" bug class is closed.
- Integration fixtures were tightened to emit real-shape events matching the stricter parser, rather than loosening the parser to match synthetic fixtures. This is the correct direction.

**Final status for the original P1 scope:**

- **Group 2 (P1-F atomic-save durability)** — complete. `writeFileAtomic` now uses fd-level flush plus parent-dir fsync, temp files get a `crypto.randomUUID()` suffix, and lock reclaim is owner-PID based with explicit live / dead / PID-reuse coverage.
- **Group 3 (P1-I `/review` hard constraints)** — complete. Phase 1 findings are recorded in [review-cli-flags.md](/home/user/-Code-/polycli/docs/review-cli-flags.md). `/review` now applies provider-specific hard constraints for `claude`, `gemini`, `copilot`, `opencode`, `pi`, and `minimax`; the constraints are explicitly non-overridable.

Verification after Group 2 + 3: `npm test` → 171 / 171 passing.

---

## Release backlog

Original `docs/review-2026-04-22.md` P0 / P1 scope is now fully cleared. Remaining work moves to release triage only:

- **P2 items**: parser minor bugs (`args.js` short-option concat, double-quote escapes, `--flag=` empty), `stream.js` `maxBufferBytes`, `spawn.js` `AbortSignal`, host-plugin nits (O(n²) `appendPreview`, emoji slicing in `previewText`, `auto`-scope shallow-clone distinction, etc.).
- **P3 items**: exit-code `130/143/124` mapping, `listModels` decision, test-fixture migration from synthetic to real-CLI saved stdout.

Do not bundle these into the completed Group 2 / Group 3 fixes; schedule them as separate release-backlog PRs.
