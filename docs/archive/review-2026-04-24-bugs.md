# Runtime Observation Report — 2026-04-24

Bugs surfaced by running the polycli Claude-Code host bundle (`plugins/polycli/scripts/polycli-companion.bundle.mjs`) against all 8 providers on a local workstation. These are issues that the unit-test suite does not catch because they depend on real provider CLI output or cross-command exit-code conventions.

Observation environment:

- Node 20, macOS darwin 25.4.0
- All 8 providers installed and authenticated (`setup` reports every provider `authenticated`)
- Commit under test: `4b1aae7 Harden polycli provider health and review flows`
- Test suite: 211/211 pass — none of these bugs flagged by it

## Summary

| ID | Severity | Area | One-line |
|----|----------|------|----------|
| B1 | 🔴 high | utils | `binaryAvailable` keeps inner newlines in `detail`, breaking text rendering |
| B2 | 🔴 high | host companion | `--json` flag ignored on argument-parse and lookup errors |
| B3 | 🟠 medium | host companion | `cancel` no-op returns exit 3 (text) vs exit 1 (JSON); undocumented |
| B4 | 🟠 medium | host companion | `timing --provider <unknown>` silently returns empty with exit 0 |
| B5 | 🟡 low | host companion | `timing --history` accepts non-integer / negative values silently |
| B6 | 🟠 medium | runtime | `ask` response top-level `model` populated for only 2 of 8 providers |
| B7 | 🟠 medium | host companion | `ask --help` sends `--help` to the provider as prompt text instead of printing usage |
| B8 | 🟠 medium | host companion | `result --json` envelope shape differs from `ask --json` (nested vs flat) |

## Real-CLI observation summary

Tested every provider with `ask --provider <p> --json "Reply with only: OK"` on commit `4b1aae7`. All 8 providers returned `response: "OK"` with `ok: true` and exit 0. Happy path works. Four-state timing semantics held up in live data — `qwen` correctly reported `tool: "missing"` (declares support, no tool fired) while the other seven reported `tool: "unsupported"` (do not declare support) — distinct states, not collapsed. `minimax` correctly reported every streaming metric as `unsupported` except `total`. Session IDs were returned by 7 of 8 (minimax is `null` by capability).

---

## B1 — `binaryAvailable` leaves interior newlines in `detail`

**File:** `packages/polycli-utils/src/process.js:52`

**Evidence:**

```
$ node plugins/polycli/scripts/polycli-companion.bundle.mjs setup
[copilot] available=yes loggedIn=yes model=gpt-5.4 version=GitHub Copilot CLI 1.0.35.
Run 'copilot update' to check for updates. detail=authenticated
```

The `version=` field contains a literal `\n` because `copilot --version` prints two lines (the version, then an update notice). `binaryAvailable`'s return value:

```js
return {
  available: true,
  detail: result.stdout.trim() || result.stderr.trim() || "ok",
};
```

`String.prototype.trim()` only strips leading/trailing whitespace, not interior newlines. The same bug will trigger for any provider CLI whose `--version` output ever grows a second line (e.g., deprecation warnings, breaking-change notices).

**JSON consumers:** see the full multi-line string in `availabilityDetail`. That is arguably the desired behavior (preserve raw CLI output). The bug is at the **rendering** layer or at the **trim policy** — pick one.

**Proposed fix (recommended: single-line at the util layer):**

```js
// process.js around line 52 — replace
detail: result.stdout.trim() || result.stderr.trim() || "ok",
// with
detail: firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr) || "ok",

// add helper at top of file:
function firstNonEmptyLine(text) {
  for (const line of (text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
```

Apply the same policy to the `available=false` branches (lines 47–48) so error output is consistent.

**Alternative fix (preserve raw in JSON, sanitize only in text):** keep `process.js` as-is, and in `polycli-companion.mjs` render the `version=` token with `detail.split(/\r?\n/)[0].trim()`. Use this if anyone actually wants the update notice in the structured output.

**Test plan:**

1. Add a unit test in `packages/polycli-utils/test/process.test.js` feeding a mocked `runCommand` result whose stdout is `"cli 1.0\nupdate available\n"` and assert `detail === "cli 1.0"`.
2. After the fix, re-run `setup` by hand and confirm the copilot line renders on one line.

**Scope guard:** do not change `available`, `status`, or `runCommand`. This is a one-liner + helper in `process.js`.

---

## B2 — `--json` ignored on argument-parse and lookup errors

**File:** `plugins/polycli/scripts/polycli-companion.mjs` (the `handleError` / early-exit paths in each subcommand dispatcher)

**Evidence:**

```
$ node bundle.mjs ask --json
Error: Missing provider. Pass --provider <...>
exit=1

$ node bundle.mjs ask --provider nonexistent --json hi
Error: Unknown provider 'nonexistent'. Expected one of: ...
exit=1

$ node bundle.mjs review --provider claude --scope wrong --json
Error: Invalid --scope value 'wrong'. Expected one of: ...
exit=1

$ node bundle.mjs result --json
Error: No completed job found.
exit=1

$ node bundle.mjs status bogus-id --json
Error: Job 'bogus-id' not found.
exit=1

$ node bundle.mjs bogus --json
Error: Unknown subcommand 'bogus'.
exit=1
```

All of these violate the `--json → structured output` contract. `polycli-opencode`'s `polycli_run` tool-call consumer (`plugins/polycli-opencode/index.mjs`) is the most affected downstream — its caller parses stdout as JSON.

**Proposed fix shape:** introduce a single helper, route every error through it.

```js
// in polycli-companion.mjs
function exitWithError({ message, code = "error", asJson, exitCode = 1 }) {
  if (asJson) {
    process.stdout.write(JSON.stringify({ error: message, code }, null, 2) + "\n");
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(exitCode);
}
```

Then grep for every `console.error("Error: ...")` + `process.exit(1)` / `process.exitCode = N` pair in the companion and replace with `exitWithError`. Preserve the codes for the known categories:

- `missing_provider`, `unknown_provider`, `invalid_scope`, `missing_prompt`, `unknown_subcommand`, `job_not_found`, `no_completed_job`, `no_active_job`

**Test plan:**

1. In `plugins/polycli/scripts/tests/integration.test.mjs` add one table-driven test feeding every error trigger (`ask --json` no provider, `ask --provider bogus --json hi`, `review --provider claude --scope wrong --json`, `bogus --json`, `result --json`, `status fake --json`) and assert `JSON.parse(stdout).error` is a string, `.code` is the expected kebab.
2. Existing `result --json` / `cancel --json` happy-path assertions must keep passing.

**Scope guard:**
- Do NOT change the text-mode stderr wording. Preserve all current `Error: ...` strings so existing CHANGELOG / docs / user-visible error copy stay stable.
- Do NOT change exit codes in this bug fix. B3 is the separate exit-code consolidation.

---

## B3 — `cancel` no-op: exit code 3 vs 1 inconsistency, undocumented

**File:** `plugins/polycli/scripts/polycli-companion.mjs:746` and `:750`

**Evidence:**

```
$ node bundle.mjs cancel
No active job found to cancel.
exit=3          # <- text mode: exit 3

$ node bundle.mjs cancel --json
{ "cancelled": false, "reason": "not_found", "jobId": null }
exit=1          # <- JSON mode: exit 1
```

Compare with other no-op paths:

- `result` (no completed job) → exit 1
- `status bogus-id` → exit 1

And `plugins/polycli/commands/cancel.md` (413 bytes) does not explain exit codes.

`process.exitCode = 3` at lines 746 and 750 appears deliberate (probably signaling "no-op distinct from error") but the signal is:

- undocumented,
- inconsistent across output modes (text=3 vs JSON=1),
- inconsistent across sibling no-op commands.

**Proposed fix — pick one option and apply it fully:**

- **Option A (simplify — recommended):** replace `process.exitCode = 3;` with `process.exitCode = 1;` at both sites. Unify with `result` and `status`'s no-op convention. One-word mention in `cancel.md` that `cancel` returns non-zero when there is nothing to cancel.

- **Option B (keep the semantic distinction):** leave exit 3 but (a) apply it to the JSON path too (align text/JSON), and (b) add an `# Exit codes` section to `cancel.md`: `0 = cancelled`, `3 = no active/terminal job to cancel`, `1 = argument/validation error`. Propagate the same convention to `status` and `result` no-op paths if you want a consistent semantic.

Either way, the text and JSON branches must agree on the exit code.

**Test plan:**

1. In `integration.test.mjs`, assert the chosen exit code for `cancel` no-op in both text and JSON modes.
2. If Option B: add a doc-freshness assertion (e.g., grep `cancel.md` for the string `Exit codes`) in one of the tests.

**Scope guard:** touching only the two `process.exitCode = 3` sites and (optionally) `cancel.md`. Do not refactor the surrounding cancel logic.

---

## B4 — `timing --provider <unknown>` silently returns empty, exits 0

**File:** `plugins/polycli/scripts/polycli-companion.mjs` — `timing` dispatch

**Evidence:**

```
$ node bundle.mjs timing --provider nonexistent --json
{ "records": [], "aggregate": { "recordCount": 0, "invalidRecords": [], "byProvider": {} } }
exit=0
```

Compare:

```
$ node bundle.mjs ask --provider nonexistent --json hi
Error: Unknown provider 'nonexistent'. Expected one of: gemini, kimi, qwen, ...
exit=1
```

The other seven commands reject unknown providers. `timing` silently filters to a provider that cannot exist, returning a successful empty response. For humans that is misleading ("why is my timing empty?"), for scripts it is a correctness bug (no way to distinguish "no records yet" from "you typo'd").

**Proposed fix:**

In the `timing` dispatcher, if `options.provider` is set, resolve it through the same mechanism `ask` uses (`resolveProvider`) before filtering records. On invalid provider, route to `exitWithError` with `code: "unknown_provider"`.

Edge case: leaving `--provider` unset must keep the current behavior (all providers).

**Test plan:**

1. `integration.test.mjs`: `timing --provider nonexistent --json` → exit 1 + `{error, code: "unknown_provider"}`.
2. `timing --provider claude --json` (valid name, zero records) → exit 0 + records array is `[]` — regression guard.
3. `timing --json` with no `--provider` → exit 0 + full aggregate — regression guard.

**Scope guard:** dispatch-level change only; do not touch `aggregateTimingRecords` or schema.

---

## B5 — `timing --history` accepts non-integer / negative values silently

**File:** `plugins/polycli/scripts/polycli-companion.mjs` — `timing` dispatch, history parsing

**Evidence:**

```
$ node bundle.mjs timing --history abc --json
{ "records": [ ...ALL records... ], ...}  # 'abc' silently ignored, full history returned
exit=0

$ node bundle.mjs timing --history -1 --json
{ "records": [], ... }  # -1 returns empty, no validation
exit=0

$ node bundle.mjs timing --history 0 --json
{ "records": [], ... }  # 0 is arguably valid "give me zero records"
exit=0
```

The `0` case is defensible as "trim to 0". `-1` and `abc` are not — they should surface as validation errors.

**Proposed fix:**

Parse `--history` with `Number.parseInt(raw, 10)`. If the result is `NaN` or `< 0`, route to `exitWithError({ message: "--history must be a non-negative integer.", code: "invalid_history" })`.

**Test plan:**

1. `integration.test.mjs`: `timing --history abc --json` and `timing --history -1 --json` both exit 1 with `code: "invalid_history"`.
2. `timing --history 0 --json` stays exit 0 (regression guard for the documented zero case).
3. `timing --history 5 --json` returns up to 5 records — regression guard.

**Scope guard:** argument parsing only. Do not change timing aggregation semantics.

---

---

## B6 — `model` in `ask` response top-level is populated inconsistently

**Files:** all of `packages/polycli-runtime/src/*.js` (provider runtimes), plus possibly `packages/polycli-runtime/src/registry.js` (`attachPromptTiming` / wrapper)

**Evidence:**

```
claude  : model = null       (ask response)
kimi    : model = null
qwen    : model = "qwen3.6-plus"
minimax : model = null
gemini  : model = null       (but `result.stats.models` has "gemini-3.1-pro-preview")
copilot : model = "gpt-5.4"
opencode: model = null
pi      : model = null
```

For comparison, `setup --json` reports a model for `gemini` (`gemini-3.1-pro-preview`), `minimax` (`MiniMax-M2.7-highspeed`), `qwen`, `copilot`. So the auth-probe layer extracts model for more providers than the ask-response layer does.

Consumers who want to display "answered by: <model>" have to check two places (top-level `model` + provider-specific field like `stats.models`, `meta`, etc.) and deal with `null`.

**Proposed fix shape:** in each provider's `runPrompt*` + `runPrompt*Streaming`, after computing the result, lift the best-available model name to a top-level `model` field. Preferred sources per provider:

- `gemini` → `stats.models` keys[0]
- `minimax` → `meta.model` or `resultEvent.model`
- `pi` → `resultEvent.model` (pi emits it)
- `opencode` → `resultEvent.model` or `meta.model`
- `claude` → `resultEvent.model` (claude stream-json emits it in init event)
- `kimi` → `resultEvent.model` if emitted, else `null` (kimi CLI may not emit)

If a provider genuinely never emits model, fallback to the `getAuthStatus().model` value — but cache it at dispatch time to avoid an extra probe per ask. Document the fallback policy so consumers can trust the field.

**Test plan:**

1. Add a fixture-replay assertion per provider: after running `ask` over a captured stream fixture, assert `result.model` equals the expected model name for that fixture.
2. Re-run the 8-provider smoke test: all 8 should report a non-null `model` in ask JSON.

**Scope guard:** do not change the `RUNTIMES` capability declarations in `registry.js`. Do not change `TIMING_SUPPORT`. This is purely about lifting existing event data into a stable top-level field.

---

## B7 — `ask --help` treats `--help` as a prompt token

**File:** `plugins/polycli/scripts/polycli-companion.mjs` (arg-parse for `ask` / `rescue` / `review` / `adversarial-review`)

**Evidence:**

```
$ node bundle.mjs ask --help --provider claude
Error: claude produced no visible text
exit=1
```

`--help` is routed through to the provider CLI as the prompt (more precisely, the arg parser does not reserve `--help` as a usage flag for subcommands), resulting in a real provider invocation that spends tokens and then fails with "produced no visible text". The user's intent was obviously to see usage info.

Top-level `bundle.mjs --help` works correctly (prints Usage, exit 0). The bug is only in subcommand-level `--help`.

**Proposed fix shape:** in the subcommand dispatcher, before resolving `--provider` or `--scope` or any other flag, check for `--help` / `-h` in `args`. If present, print the per-subcommand Usage block (or at minimum the relevant line from the top-level Usage) and `process.exit(0)`.

**Test plan:**

1. `integration.test.mjs`: for each of `ask`, `rescue`, `review`, `adversarial-review`, `setup`, `health`, `status`, `result`, `cancel`, `timing`, assert `--help` exits 0 without invoking any provider CLI (mock `runCommand` to throw if called).

**Scope guard:** do not change the top-level `--help` handling. Do not introduce a flag-parsing framework; a short `if (args.includes("--help") || args.includes("-h"))` at the top of each dispatcher is sufficient.

---

## B8 — `result --json` envelope shape differs from `ask --json`

**File:** `plugins/polycli/scripts/polycli-companion.mjs` (result-command dispatcher output)

**Evidence:**

```
# ask --json top-level keys:
['provider', 'kind', 'model', ..., 'response', 'sessionId', 'timing', ...]

# result --json top-level keys:
['job', 'result']
# where result.response, result.sessionId, result.timing live one level deeper
```

Same semantic payload, two different envelope shapes. Downstream consumers (especially `polycli-opencode`'s `polycli_run` tool wrapper) have to do `data.response ?? data.result?.response` — classic sign of inconsistency.

**Proposed fix shape:**

Option A (recommended): flatten `result --json` to match `ask --json`. Keep a `job` sub-object for job-specific metadata (`jobId`, `createdAt`, `finishedAt`, `pid`, `logFile`, `status`) but lift the provider response fields (`response`, `sessionId`, `timing`, `ok`, `status`, `error`, `timedOut`, `resultEvent`, `stats`, etc.) to top level.

```js
// result --json shape after fix:
{
  "provider": "gemini",
  "kind": "ask",
  "model": "gemini-3.1-pro-preview",
  "response": "1\n2\n3\n4\n5",
  "sessionId": "...",
  "ok": true,
  "timing": { ... },
  "resultEvent": { ... },
  "job": {
    "jobId": "pa-76c06c5e",
    "createdAt": "...",
    "finishedAt": "...",
    "status": "completed",
    "logFile": "...",
    "pid": null
  }
}
```

Option B (not recommended but simpler): leave `result` nested and document it. This punts the consistency cost to every consumer.

**Test plan:**

1. `integration.test.mjs`: assert `ask --json` and `result --json` (for the same completed job) have the same top-level keys for `response`, `sessionId`, `ok`, `timing`.
2. Assert `result --json` preserves `job.jobId`, `job.createdAt`, `job.finishedAt`.

**Scope guard:** do not touch the `status --json` envelope — it is legitimately a *list of jobs*, not a single completed job payload, and its shape is appropriate. B8 is only about `result --json` aligning with `ask --json`.

---

## Delivery order

1. **B1** first (utility layer). One-line + helper, unblocks the rendering fix before anything else.
2. **B2** next (introduce `exitWithError`). Lays groundwork that B3/B4/B5/B7 can reuse.
3. **B7** right after B2 — same dispatcher file, adds the `--help` short-circuit in each subcommand.
4. **B4** and **B5** together — both are timing-command argument validation, reuse `exitWithError` from B2.
5. **B3** — requires a decision (Option A vs B) and a docs update if B is chosen.
6. **B8** — `result --json` envelope flattening. Touches the biggest surface (shape change), so do it last with the integration tests below as guardrails.
7. **B6** — per-provider model lifting. Independent from the host-companion work; can be done in parallel by a second Codex pass on `packages/polycli-runtime/src/*.js`.
8. After all eight: extend `plugins/polycli/scripts/tests/integration.test.mjs` with a single parameterized `--json error shape` test covering every error branch at once, plus one parameterized smoke test that runs `ask` per provider against fixtures and asserts `model` is non-null (locks B6).

## Out-of-scope

- No changes to the 8 provider runtimes (`packages/polycli-runtime/src/*.js`). None of these bugs originate there.
- No changes to `polycli-opencode`'s `index.mjs` tool wrappers. They will improve for free once B2 lands.
- No README / CHANGELOG rewrites beyond what B3 Option B explicitly requires.
- Do not unify text-mode wording between commands; only exit codes and JSON-mode shape.
