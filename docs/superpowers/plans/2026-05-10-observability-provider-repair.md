# Observability Provider Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local Polycli observability truthful, then fix the highest-signal provider failure classifications with TDD.

**Architecture:** Add a small state-root metadata surface in `plugins/polycli/scripts/lib/state.mjs`, keep timing storage local to workspace slugs, and expose explicit timing/debug metadata from the companion. Provider fixes stay flat in their provider modules and host runtime-option helpers.

**Tech Stack:** Node.js ESM, `node:test`, existing `@bbingz/polycli-*` packages.

---

## File Structure

- Modify `plugins/polycli/scripts/lib/state.mjs`: state-root precedence and metadata.
- Modify `plugins/polycli/scripts/lib/timing.mjs`: list all records and expose timing file metadata.
- Modify `plugins/polycli/scripts/polycli-companion.mjs`: parse `--history all` / `--all`, include metadata in JSON output.
- Modify `plugins/polycli/scripts/lib/run-ledger.mjs`: classify attempt-result failures in summaries/explanations.
- Modify `packages/polycli-runtime/src/timing.js`: carry optional outcome fields.
- Modify `packages/polycli-runtime/src/qwen.js`, `kimi.js`, `cmd.js`, `opencode.js`: deterministic provider classifications only.
- Modify tests under `plugins/polycli/scripts/tests/` and `packages/polycli-runtime/test/`.

## Task 1: State Root And Timing Metadata

- [ ] Write failing tests in `plugins/polycli/scripts/tests/timing.test.mjs`:

```js
test("POLYCLI_STATE_ROOT takes precedence over CLAUDE_PLUGIN_DATA", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-state-root-"));
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const previousStateRoot = process.env.POLYCLI_STATE_ROOT;
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.POLYCLI_STATE_ROOT = stateRoot;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  try {
    const workspaceRoot = "/tmp/polycli-state-root-test";
    const file = resolveTimingHistoryFile(workspaceRoot);
    assert.equal(file.startsWith(stateRoot), true);
    assert.equal(describeTimingStore(workspaceRoot).stateRootSource, "POLYCLI_STATE_ROOT");
  } finally {
    if (previousStateRoot == null) delete process.env.POLYCLI_STATE_ROOT;
    else process.env.POLYCLI_STATE_ROOT = previousStateRoot;
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});
```

- [ ] Run: `node --test plugins/polycli/scripts/tests/timing.test.mjs`

Expected: FAIL because `POLYCLI_STATE_ROOT` and `describeTimingStore` do not exist.

- [ ] Implement minimal state metadata helpers:

```js
const POLYCLI_STATE_ROOT_ENV = "POLYCLI_STATE_ROOT";

export function describeStateRoot() {
  if (process.env[POLYCLI_STATE_ROOT_ENV]) {
    return { stateRoot: path.resolve(process.env[POLYCLI_STATE_ROOT_ENV]), source: POLYCLI_STATE_ROOT_ENV };
  }
  if (process.env[PLUGIN_DATA_ENV]) {
    return { stateRoot: path.join(process.env[PLUGIN_DATA_ENV], "state"), source: PLUGIN_DATA_ENV };
  }
  return { stateRoot: FALLBACK_STATE_ROOT, source: "temp" };
}
```

- [ ] Run the focused timing test again and make it pass.

## Task 2: `timing --all` And Honest Aggregate Metadata

- [ ] Write failing integration tests in `plugins/polycli/scripts/tests/integration.test.mjs` or focused unit tests in `timing.test.mjs` for:

```js
assert.equal(parseHistoryLimit("all"), null);
assert.equal(parseHistoryLimit(undefined), 20);
```

and JSON output containing:

```js
assert.equal(payload.metadata.historyLimit, "all");
assert.equal(payload.metadata.aggregateScope, "records");
assert.equal(payload.metadata.recordCount, 3);
assert.match(payload.metadata.stateDir, /polycli/);
```

- [ ] Run the focused test and confirm it fails.
- [ ] Export or test through companion helpers with the smallest surface needed.
- [ ] Implement `--all`, `--history all`, and `metadata`.
- [ ] Run `node --test plugins/polycli/scripts/tests/timing.test.mjs plugins/polycli/scripts/tests/integration.test.mjs`.

## Task 3: Timing Outcome Fields

- [ ] Write failing tests in `packages/polycli-runtime/test/timing.test.js`:

```js
const record = buildPromptTimingRecord({
  provider: "qwen",
  totalMs: 10,
  outcome: "timed_out",
  exitCode: 124,
  terminationReason: "timeout",
  responseMatched: false,
});
assert.equal(record.outcome, "timed_out");
assert.equal(record.exitCode, 124);
assert.equal(record.terminationReason, "timeout");
assert.equal(record.responseMatched, false);
assert.equal(validateTimingRecord(record).ok, true);
```

- [ ] Run: `node --test packages/polycli-runtime/test/timing.test.js`
- [ ] Implement optional fields in `buildPromptTimingRecord` and pass them through `attachPromptTiming`.
- [ ] Run runtime timing tests again.

## Task 4: Run-Ledger Failure Classification

- [ ] Write failing tests in `plugins/polycli/scripts/tests/run-ledger.test.mjs`:

```js
const summary = summarizeRunLedger([
  { runId: "r", at: "2026-05-10T00:00:00.000Z", command: "ask", phase: "attempt_result", provider: "qwen", status: "failed", error: { message: "Reached max session turns for this session." } },
  { runId: "r", at: "2026-05-10T00:00:01.000Z", command: "ask", phase: "provider_decision", provider: "qwen", status: "failed", reason: "ask_failed" },
]);
assert.equal(summary[0].failureClassCounts.qwen_max_session_turns, 1);
assert.match(buildRunExplanation(events, "r").text, /qwen_max_session_turns/);
```

- [ ] Run the run-ledger test and confirm failure.
- [ ] Add a pure `classifyRunFailure(event)` helper and use it from summary/explain.
- [ ] Run the run-ledger test again.

## Task 5: Provider Classification Slices

- [ ] Add failing tests for deterministic provider classifications:

```js
// qwen
assert.equal(classifyQwenError("Reached max session turns for this session."), "qwen_max_session_turns");

// kimi
assert.equal(isKimiResumeFooter("To resume this session: kimi -r 123e4567-e89b-42d3-a456-426614174000"), true);

// opencode
assert.equal(classifyOpenCodeError("spawn opencode ENOENT"), "opencode_unavailable");
```

- [ ] Run relevant runtime tests and confirm failures.
- [ ] Implement only pure classifiers and wire them into returned `errorCode` / `terminationReason` fields.
- [ ] Run `node --test packages/polycli-runtime/test/*.test.js`.

## Task 6: Verification

- [ ] Run focused script tests:

```bash
node --test plugins/polycli/scripts/tests/timing.test.mjs plugins/polycli/scripts/tests/run-ledger.test.mjs
```

- [ ] Run focused runtime tests:

```bash
node --test packages/polycli-runtime/test/*.test.js
```

- [ ] Run full verification:

```bash
npm test
npm run release:check
```

- [ ] Report exact results and any remaining provider follow-ups.
