# Commit Review — fb64b1e `fix: harden review follow-up invariants`

Follow-up review of Codex's response to `docs/archive/review-2026-04-22.md`. Written for the next fix-batch.

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
- **Group 3 (P1-I `/review` hard constraints)** — complete. Phase 1 findings are recorded in [review-cli-flags.md](/home/user/-Code-/polycli/docs/archive/review-cli-flags.md). `/review` now applies provider-specific hard constraints for `claude`, `gemini`, `copilot`, `opencode`, `pi`, and `minimax`; the constraints are explicitly non-overridable.

Verification after Group 2 + 3: `npm test` → 171 / 171 passing.

---

## Release backlog

Original `docs/archive/review-2026-04-22.md` P0 / P1 scope is now fully cleared. Remaining work moves to release triage only:

- **P2 items**: parser minor bugs (`args.js` short-option concat, double-quote escapes, `--flag=` empty), `stream.js` `maxBufferBytes`, `spawn.js` `AbortSignal`, host-plugin nits (O(n²) `appendPreview`, emoji slicing in `previewText`, `auto`-scope shallow-clone distinction, etc.).
- **P3 items**: exit-code `130/143/124` mapping, `listModels` decision, test-fixture migration from synthetic to real-CLI saved stdout.

Do not bundle these into the completed Group 2 / Group 3 fixes; schedule them as separate release-backlog PRs.

---

## Follow-up commit 95b003c `fix: harden atomic save and review constraints` — verdict A

Group 2 and Group 3 both landed cleanly. `npm test` → 171 / 171 passing (+19 new regression tests).

**Group 2 — atomic-save durability: complete.**

- `writeFileAtomicSync` now opens fd, `writeFileSync(fd)`, `fsyncSync(fd)`, `closeSync`, `renameSync`, then opens the parent dir and `fsyncSync(dirFd)`. Parent-dir fsync is wrapped in a tolerant catch for `EINVAL` / `ENOTSUP` / `EPERM` (filesystems that don't honor directory fsync).
- Tmp filename is now `${filePath}.tmp.${pid}.${Date.now()}.${crypto.randomUUID()}`, eliminating the same-ms same-PID collision window.
- `withLockfile` now writes JSON `{pid, acquiredAt}` into the lockfile on acquisition. Stale reclaim goes through `process.kill(pid, 0)`: `ESRCH` → owner dead, unlink + retry; `EPERM` → owner alive (safe default); success → owner alive. A PID-reuse fallback reclaims the lock when `ownerAlive && lockAgeMs > staleMs` (default raised from 30s to 600s to fit the new semantics).
- `normalizeWriteOptions` preserves the existing `(string | object)` call shape, so callers passing `"utf8"` or `{flag, mode, encoding}` keep working.
- Regression tests cover: fsync ordering (file-fsync before rename, dir-fsync after rename), live-PID no-reclaim, dead-PID reclaim via child spawn + exit, and the PID-reuse time-boxed fallback.

**Group 3 — `/review` CLI hard constraints: complete.**

- Codex delivered a Phase 1 research artifact at [docs/archive/review-cli-flags.md](review-cli-flags.md) (230 lines, all findings verified against locally installed CLI versions with `--help` / official docs / installed source). Four of the six hypotheses from this doc were corrected:
  - claude: `--tools ""` works directly; the exhaustive `--disallowed-tools` list was unnecessary.
  - gemini: `--approval-mode plan` is read-only, not no-tools; correct shape is a one-shot Policy Engine TOML with `toolName = "*"` / `decision = "deny"`, passed via `--policy <tmpfile>`.
  - copilot: `--available-tools ''` is filtered out by the CLI's own normalizer; correct shape is an exhaustive `--excluded-tools` denylist (22 documented tool names).
  - opencode: no CLI flag exists; correct shape is injecting `OPENCODE_CONFIG_CONTENT` with `permission: "deny"`, plus `--agent plan`, plus removing the default `--dangerously-skip-permissions`.
  - Confirmed: pi `--no-tools`, minimax `MINI_AGENT_CONFIG_PATH` one-shot YAML.
- Phase 2 implementation centralizes everything in `plugins/polycli/scripts/lib/review.mjs` under `buildReviewRuntimeOptions` + a `REVIEW_HARD_CONSTRAINTS` per-provider map. `assertNoReviewConstraintOverride` makes constraints **non-overridable** — any user-supplied `extraArgs` or conflicting `approvalMode` / `skipPermissions` / `maxSteps` throws before dispatch.
- `packages/polycli-runtime/src/opencode.js` grew two parameters (`skipPermissions`, `env`) that thread through both sync and streaming paths, enabling the env-injection constraint layer.
- `polycli-companion.mjs:559-570` replaced inline provider branching with a single `buildReviewRuntimeOptions` call.
- New tests: `plugins/polycli/scripts/tests/review.test.mjs` (+102), `plugins/polycli/scripts/tests/integration.test.mjs` (+235 LoC), `packages/polycli-runtime/test/opencode.test.js` (+37).

**Beyond-spec quality:**

- The research doc is a standalone reusable artifact, citing CLI versions (claude 2.1.117, gemini 0.38.2, copilot 1.0.34, opencode 1.14.20, pi 0.68.1, mini-agent 0.1.0) and primary sources for each finding. If any upstream CLI flag-surface drifts, this doc points directly at what to re-verify.
- The non-overridable decision was chosen explicitly and justified in the research doc's "Phase 2 implementation decision" section.
- opencode's three-layer defense (disable `--dangerously-skip-permissions`, add `--agent plan`, inject `permission: "deny"`) reflects real defense-in-depth reasoning rather than trusting a single switch.

**Minor nits (non-blocking):**

- `writeReviewTempFile` creates `mkdtempSync` directories that aren't cleaned up at process exit. Long-running hosts will slowly accumulate per-review dirs in `os.tmpdir()`. One-line `process.on("exit", ...)` cleanup or a tmp-registry pattern is sufficient. Release-blocker only if a host runs review thousands of times without restart.
- `readYamlScalar` in `review.mjs` still uses regex parsing for `api_key` / `api_base` / `model` / `provider`. Simple key-value configs parse fine; multi-line values or unusual quoting would be missed. Agent finding #26 in the original review flagged this — carrying forward as a future cleanup when MiniMax flow is next touched.

---

## Final scope status

- **P0**: 6 / 6 shipped.
- **P1 (A–I)**: 9 / 9 shipped.
- **P2**: ~15 items deferred to release-backlog (parser minor bugs, stream/spawn robustness, host-plugin UX nits).
- **P3**: ~20 items deferred to release-backlog (exit-code mapping, listModels, real-CLI fixture migration).

The original `docs/archive/review-2026-04-22.md` scope is now fully closed. Further work is tracked separately as release-candidate polish.

---

## Group 4 — P2 host-plugin hygiene (next batch for Codex)

Three small, independent fixes bundled into one commit. Each is low-risk and has obvious test coverage. Do NOT include `args.js` / `stream.js` / `spawn.js` / timing / parser-level P2 items in this batch — keep scope to the Claude host plugin.

### Fix 1 — `appendPreview` O(n²) disk I/O

**Location:** `plugins/polycli/scripts/polycli-companion.mjs:204-224`

**Problem:** on every streamed event, `appendPreview` reads the entire log file via `fs.readFileSync`, splits by line, and compares the tail to the incoming `block` to suppress duplicates. A rescue/review job that emits thousands of events grows log files to MB-scale; total I/O is O(n²).

**Fix shape:** keep an in-memory tail per log-file path, sized to the dedup window. Suggested:

```js
// module-level
const PREVIEW_TAIL_LINES = 10;
const previewTails = new Map(); // logFile → string[] (most recent <=PREVIEW_TAIL_LINES lines)

function appendPreview(logFile, provider, event) {
  const text = summarizeEventText(provider, event);
  if (!text) return;
  const lines = String(text).split(/\r?\n/).map(collapseWhitespace).filter(Boolean).slice(0, PREVIEW_TAIL_LINES);
  if (lines.length === 0) return;

  const existingTail = previewTails.get(logFile) ?? [];
  // dedup: if the incoming block matches the existing tail exactly (at length N), skip.
  const block = lines.join("\n");
  if (existingTail.length >= lines.length) {
    const comparable = existingTail.slice(-lines.length).join("\n");
    if (comparable === block) return;
  }

  fs.appendFileSync(logFile, `${block}\n`, "utf8");
  const merged = [...existingTail, ...lines];
  previewTails.set(logFile, merged.slice(-PREVIEW_TAIL_LINES));
}
```

**Scope:**
- Do NOT change `summarizeEventText` or `collapseWhitespace`.
- On worker restart the `previewTails` map starts empty — that's fine, just means the first-post-restart event may re-append a duplicate. Acceptable tradeoff.
- If the log file is rotated or removed externally, the cache is stale but the only consequence is one missed dedup. Don't try to detect external deletion.

**Tests (add to `plugins/polycli/scripts/tests/` — pick the most appropriate file or create a new one):**
- Given 1,000 synthetic events emitted in sequence, assert that `fs.readFileSync` is called 0 times during the loop (spy on it).
- Given identical-text events emitted twice in a row, assert the log file contains the block exactly once.
- Given non-overlapping events, assert each unique block is appended in order.

### Fix 2 — `previewText` UTF-16 surrogate splitting

**Location:** `plugins/polycli/scripts/polycli-companion.mjs:87-93`

**Problem:** `collapsed.slice(0, maxLength - 1)` slices by UTF-16 code unit. A prompt containing an emoji (e.g. 🧵, 🔥) can be split mid-surrogate-pair, producing an invalid UTF-16 string that renders as a replacement character in the preview.

**Fix shape:** iterate by code points using `Array.from` (Node 20+ handles this natively):

```js
function previewText(text, maxLength = 120) {
  const collapsed = collapseWhitespace(text);
  const codePoints = Array.from(collapsed);
  if (codePoints.length <= maxLength) {
    return collapsed;
  }
  return `${codePoints.slice(0, maxLength - 1).join("")}…`;
}
```

Grapheme clusters (emoji + ZWJ + skin tones combined) will still be split in rare cases; if you want stricter handling, switch the iteration to `Intl.Segmenter`:

```js
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = [...segmenter.segment(collapsed)].map((s) => s.segment);
```

Either is acceptable — `Array.from` is simpler and handles 95% of real cases; `Intl.Segmenter` is correct for every case but adds allocation overhead per call. Pick one and document the choice in the commit message.

**Tests:**
- `previewText("🔥🔥🔥", 2)` → should NOT return a replacement character; should return `"🔥…"` or `"🔥🔥"` depending on ellipsis accounting (pick one, pin in test).
- `previewText("abc".repeat(100), 10)` → returns exactly 10 visible characters ending in `…`.
- `previewText("", 10)` → returns `""`.

### Fix 3 — auto scope distinguishes git failure from "no changes"

**Location:** `plugins/polycli/scripts/lib/review.mjs:230-257` (`collectReviewContext`)

**Problem:** when auto-scope falls through to the `branch` attempt and `detectDefaultBaseRef` returns `"HEAD~1"` (because none of `origin/main / main / origin/master / master` exist), a single-commit or shallow-clone repo will have `HEAD~1` fail the `git rev-parse`. Current code silently swallows `branch.ok === false` and falls to `selected = { ok: true, diff: "" }`, indistinguishable from "no actual changes".

**Fix shape:** track the attempted sub-scopes and surface a diagnostic hint when auto-scope returns empty. Two acceptable implementations:

**Option A (minimal UX fix):** if the only failure was branch with fallback `HEAD~1`, return empty silently. If branch failed with a non-fallback baseRef OR staged/unstaged returned `!ok`, include a `warnings: [...]` array in the success envelope.

**Option B (stricter):** return `ok: false` with an explanatory error whenever any sub-scope returned `!ok` and the final selection is empty.

Pick Option A unless you want the companion layer to loudly fail on shallow repos. Flag the choice in the commit message.

Suggested Option A implementation:

```js
if (effectiveScope === "auto") {
  const attempts = [];
  const staged = diffForScope(cwd, "staged", null);
  attempts.push({ scope: "staged", ...staged });
  if (staged.ok && staged.diff.trim()) selected = { ...staged, scope: "staged" };

  if (!selected) {
    const unstaged = diffForScope(cwd, "unstaged", null);
    attempts.push({ scope: "unstaged", ...unstaged });
    if (unstaged.ok && unstaged.diff.trim()) selected = { ...unstaged, scope: "unstaged" };
  }

  if (!selected) {
    const branch = diffForScope(cwd, "branch", baseRef);
    attempts.push({ scope: "branch", ...branch });
    if (branch.ok && branch.diff.trim()) selected = { ...branch, scope: "branch" };
  }

  if (!selected) {
    const warnings = attempts
      .filter((a) => !a.ok)
      .map((a) => `${a.scope} diff failed: ${a.error}`);
    selected = {
      ok: true,
      diff: "",
      scope: "auto",
      baseRef: baseRef || detectDefaultBaseRef(cwd),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}
```

Then plumb the `warnings` array through the return object so the companion can surface them to the user (e.g. prefix the "No changes to review" message with "Note: could not compute branch diff against HEAD~1 (shallow clone?); staged/unstaged showed no changes.").

**Tests (`plugins/polycli/scripts/tests/review.test.mjs`):**
- Shallow/single-commit repo: `HEAD~1` resolve fails → auto returns `ok:true, diff:"", warnings: [...contains "branch diff failed"]`.
- Clean multi-commit repo with no diffs: auto returns `ok:true, diff:"", warnings: undefined`.
- Non-git cwd: `ok:false, error: "Not inside a git repository."` (unchanged).

### Commit message shape

```
fix: P2 host-plugin hygiene — preview perf, emoji safety, auto-scope diagnostics

- appendPreview keeps an in-memory tail instead of re-reading the log file per event (O(n) → O(1) per event).
- previewText slices by code point to avoid splitting UTF-16 surrogate pairs on emoji.
- collectReviewContext auto scope now surfaces sub-scope git failures as warnings when it falls through to empty, distinguishing "shallow clone" from "no changes".

Tests: +3 regression tests covering preview perf, emoji slicing, and shallow-clone warnings.
```

---

## Group 5 — real-CLI saved-stdout fixture migration (spec for Codex)

**Why this is deferred:** the current runtime tests for all 8 providers use synthetic JSON fixtures — hand-crafted event shapes that do not exactly match what the real CLIs emit. Two previous review rounds have already flagged this as a latent risk: a parser can pass all tests but still fail on real CLI output (e.g., the copilot `assistant.message` shape, the opencode `type: "error"` shape, the gemini `responseChunks` shape). Group 5 closes the loop.

### Phase 1: capture real stdout samples (needs CLI access + auth)

**Note:** this phase requires running each provider's CLI at least once with a recorded stdout. It has minor billing implications (each CLI call is a real API call). Do NOT run this in CI — run it once locally, commit the captured artifacts, then all future tests replay them.

Create a new directory `packages/polycli-runtime/test/fixtures/` with subdirs per provider.

For each provider, run two minimal invocations and capture the raw stdout stream:

| Provider | Capture invocation 1 | Capture invocation 2 |
|---|---|---|
| claude | `claude -p "say hi" --output-format stream-json --verbose` | `claude -p "force-error: ..." ...` (deliberately malformed to trigger error path) |
| copilot | `copilot -p "say hi" --stream-json` | capture a real tool-invocation flow then abort it |
| opencode | `opencode run -p "say hi" --format json` | capture a flow that hits permission denial |
| pi | `pi -p "say hi"` | capture a session-envelope-bearing call |
| gemini | `gemini --prompt "say hi"` | trigger `--approval-mode plan` to capture the plan shape |
| kimi | `kimi -p "say hi"` | capture a clean-exit-no-text flow (deliberately empty prompt?) |
| qwen | `qwen -p "say hi"` | trigger `result` error to capture the error result shape |
| minimax | `mini-agent -p "say hi"` | mini-agent's progress+result both |

For each, save the output as `fixtures/<provider>/<name>.stream.txt` with a sibling `<name>.meta.json` capturing the CLI version, invocation args, expected parse result, and any notes.

### Phase 2: write a replay helper

Add `packages/polycli-runtime/test/helpers/fixture-replay.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

export function loadStreamFixture(provider, name) {
  const base = path.join(import.meta.dirname, "..", "fixtures", provider, name);
  const stream = fs.readFileSync(`${base}.stream.txt`, "utf8");
  const meta = JSON.parse(fs.readFileSync(`${base}.meta.json`, "utf8"));
  return { stream, meta };
}
```

### Phase 3: migrate each provider test

For each `packages/polycli-runtime/test/<provider>.test.js`, add a new test block that:

1. Loads the fixture via `loadStreamFixture`.
2. Feeds the stream to `parseXStreamText`.
3. Asserts the parse result matches `meta.expected`.

Keep the existing synthetic tests — they're cheap regression guards for the specific shape-variations each parser has. The real-CLI fixtures are additive, not replacements.

### Phase 4: document the capture process

Add `docs/capture-fixtures.md` with the exact commands used, pre-requisites (CLI version, authenticated state), and re-capture policy (when a CLI upgrades, re-capture and commit diff to flag parser-impact).

**Scope guards:**
- Do NOT run the capture phase in CI.
- Do NOT capture from production workloads or real user sessions.
- Commit only stdout, never stderr with credentials or session tokens. Scrub any `authorization:` / `api_key:` / `token:` patterns before committing — add a helper or checklist.

**Out of scope for this batch:** P2 parser tightening (opencode `event.text`, etc.) — those should be a separate commit once the real fixtures are in place and expose the exact shapes that need handling.

---

## Release checklist — v0.4.0

The original review scope is closed and the repo is in a releasable state. The following sequence is a proposal, not an authorization — each external-effect step needs the user's explicit go-ahead.

### Step 1: local verification (safe, reversible)

```bash
# at repo root
npm test                          # expect 171/171 passing as of 95b003c
npm run release:check             # test + claude plugin validate + npm publish --dry-run
npm run pack:opencode             # produces dist/bbingz-polycli-opencode-<version>.tgz
```

If any of these fail, stop and triage before tagging.

### Step 2: version bump (local, reversible up to commit)

Decide the version. Public release is at `v0.3.0`; this would be `v0.4.0` given the feature/fix scope since (new provider runtimes, hardening passes, durability, review constraints). Bump:

- `packages/polycli-utils/package.json`
- `packages/polycli-timing/package.json`
- `packages/polycli-runtime/package.json`
- `plugins/polycli-opencode/package.json`
- `plugins/polycli/.claude-plugin/plugin.json` (if it carries a version)

Commit the bump separately so the tag points at a clean version commit.

### Step 3: tag locally (reversible before push)

```bash
git tag -a v0.4.0 -m "v0.4.0"
git log --oneline v0.3.0..v0.4.0
```

If the tag needs to move, `git tag -d v0.4.0` and retry. Tags are only published when pushed.

### Step 4: push to origin (EXTERNAL — needs user confirmation)

```bash
git push origin main
git push origin v0.4.0
```

Once pushed, tag and commits are visible in the public GitHub repo. Not strictly irreversible (can delete the tag remotely) but visible.

### Step 5: GitHub release (EXTERNAL — needs user confirmation + gh auth)

```bash
gh release create v0.4.0 \
  --title "v0.4.0" \
  --notes "$(cat <<'EOF'
## Highlights
- New provider runtimes: claude / copilot / opencode / pi / gemini / kimi / qwen / minimax
- Timing four-state semantics hardened at aggregation boundary
- /review CLI hard constraints (tool-free) for all eight providers
- atomic-save fsync + owner-PID lockfile
- Background job cancel-vs-completion race eliminated via withLockfile CAS
EOF
)"
```

### Step 6: npm publish (EXTERNAL — needs user's npm auth)

```bash
npm publish ./plugins/polycli-opencode --access public
```

This is the only currently-published npm package; the others are local-only until a subsequent release decision.

### Step 7: verification after external steps

```bash
claude plugin marketplace add bbingz/polycli
claude plugin install polycli@polycli-hosts
npm view @bbingz/polycli-opencode@0.4.0
```

Expect brief 404 propagation lag immediately after first publish — documented in `docs/archive/session-memory-2026-04-22.md`.

### What to tell Codex

Codex's role in the release flow is limited — the version bump commit is something Codex can prepare, but the external steps (push, release, publish) should stay with the user for credentials and intent verification. A reasonable division:

- **Codex**: Step 2 (version bump commit + release note draft).
- **User**: Steps 4, 5, 6 (external effects).
- **Claude**: Step 1 (verification dump), Step 3 (local tag), Step 7 (post-release smoke check).

Flag in commit message: `release: bump to v0.4.0` with body enumerating the P0/P1 items cleared since v0.3.0.
