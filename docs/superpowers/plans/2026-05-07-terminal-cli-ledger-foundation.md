# Terminal CLI And Run Ledger Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PATH-callable `polycli` terminal package and a persistent redacted run ledger that can explain multi-provider review failures across host surfaces.

**Architecture:** Keep the companion as the single command implementation. Add a thin terminal wrapper around a fifth companion bundle target, plus focused ledger helpers under the existing plugin script library. The ledger is local append-only NDJSON beside existing state files and is read by shared `debug` companion commands.

**Tech Stack:** Node.js `>=20`, plain ESM JavaScript, `node:test`, existing `@bbingz/polycli-utils`, existing companion/runtime adapters, existing esbuild bundle scripts.

---

## Review Fixes Already Applied To The Spec

- Shared `debug runs/show/explain` is now companion vocabulary, not a terminal-only fork.
- `--run-id` is now a global option that must be stripped before provider and prompt positional parsing.
- Joined runs now have explicit lifecycle grouping rules and a `commands` command set.
- Background jobs now write provider decisions when workers observe final state.
- No-diff review invocations now write skipped `no_changes` state.
- Redaction now covers inline and case-insensitive token-like arguments.
- Real `cmd` and `pi` failure samples are a pre-writer gate for the ledger implementation.

## File Structure

- Create `plugins/polycli/scripts/lib/run-ledger.mjs`: pure-ish run id, redaction, append/read, grouping, and explain helpers.
- Create `plugins/polycli/scripts/tests/run-ledger.test.mjs`: focused helper tests with temp state roots.
- Modify `plugins/polycli/scripts/polycli-companion.mjs`: parse `--run-id`, write ledger events, add shared `debug` command dispatch.
- Modify `plugins/polycli/scripts/tests/integration.test.mjs`: companion command behavior and ledger integration tests.
- Create `packages/polycli-terminal/package.json`: public terminal package metadata and `bin.polycli`.
- Create `packages/polycli-terminal/bin/polycli.mjs`: thin wrapper that executes the bundled companion.
- Create `packages/polycli-terminal/README.md`: terminal package scope and examples.
- Modify `scripts/build-plugin-bundles.mjs`: add terminal companion bundle target.
- Modify `scripts/validate-plugin-bundles.mjs` and `scripts/tests/validate-plugin-bundles.test.mjs`: include the fifth bundle target.
- Modify `scripts/validate-host-command-map.mjs`: include shared `debug` command vocabulary and terminal column expectations.
- Modify `scripts/check-release.mjs`, `scripts/validate-release-manifests.mjs`, and script tests: include terminal package hygiene in release checks.
- Modify `plugins/polycli/scripts/tests/host-packaging.test.mjs` and `scripts/tests/open-source-packaging.test.mjs`: verify terminal package inclusion without weakening existing host assertions.
- Modify `docs/host-command-map.md`, `docs/polycli-v1-public-surface.md`, README, `docs/roadmap.md`, and `tasks/terminal-cli-tui-observability.md`: document only the landed surface.

### Task 1: Capture Provider Failure Fixtures

**Files:**
- Create: `plugins/polycli/scripts/tests/fixtures/run-ledger/cmd-health-ask-failure.meta.json`
- Create: `plugins/polycli/scripts/tests/fixtures/run-ledger/pi-health-failure.meta.json`
- Create: `plugins/polycli/scripts/tests/fixtures/run-ledger/README.md`

- [ ] **Step 1: Create fixture directory**

Run: `mkdir -p plugins/polycli/scripts/tests/fixtures/run-ledger`
Expected: command exits `0`.

- [ ] **Step 2: Capture `cmd` health and ask behavior**

Run:

```bash
RUN_ID="fixture-cmd-$(date +%Y%m%d%H%M%S)"
node plugins/polycli/scripts/polycli-companion.mjs health --provider cmd --json --run-id "$RUN_ID" > /tmp/polycli-cmd-health.json
node plugins/polycli/scripts/polycli-companion.mjs ask --provider cmd --json --run-id "$RUN_ID" "Return exactly POLYCLI_FIXTURE_OK" > /tmp/polycli-cmd-ask.json
```

Expected: health command exits `0`; ask command may exit non-zero or return JSON with unusable/empty provider output. Preserve the exact `status`, `ok`, `error`, `response`, `stdoutBytes`, and `stderrBytes` shape in sanitized metadata.

- [ ] **Step 3: Capture `pi` health behavior**

Run:

```bash
RUN_ID="fixture-pi-$(date +%Y%m%d%H%M%S)"
node plugins/polycli/scripts/polycli-companion.mjs health --provider pi --json --run-id "$RUN_ID" > /tmp/polycli-pi-health.json
```

Expected: health command exits non-zero or returns JSON with a failed provider report. Preserve the exact `status`, `ok`, `available`, `error`, `responsePreview`, `stdoutBytes`, and `stderrBytes` shape in sanitized metadata.

- [ ] **Step 4: Write sanitized fixture metadata**

Write metadata files with this shape, using values from the captured files and no full prompt or secret material:

```json
{
  "provider": "cmd",
  "capturedAt": "2026-05-07T00:00:00.000Z",
  "scenario": "health-passed-ask-failed",
  "health": {
    "ok": true,
    "status": 0,
    "responsePreview": "POLYCLI_HEALTH_OK"
  },
  "ask": {
    "ok": false,
    "status": 1,
    "errorPreview": "process exited with code 1",
    "stdoutBytes": 0,
    "stderrBytes": 0
  }
}
```

```json
{
  "provider": "pi",
  "capturedAt": "2026-05-07T00:00:00.000Z",
  "scenario": "health-failed",
  "health": {
    "ok": false,
    "status": 1,
    "available": false,
    "errorPreview": "health probe failed",
    "stdoutBytes": 0,
    "stderrBytes": 0
  }
}
```

- [ ] **Step 5: Document fixture origin**

Create `plugins/polycli/scripts/tests/fixtures/run-ledger/README.md`:

```markdown
# Run Ledger Fixtures

These sanitized fixtures capture real provider failure shapes used by the run-ledger tests.

- `cmd-health-ask-failure.meta.json`: `cmd` health can pass while prompt-bearing `ask` is not usable.
- `pi-health-failure.meta.json`: `pi` health can fail and should become a skipped provider decision.

Fixtures must not include full prompts, full stdout/stderr, environment variables, API keys, tokens, or local-only secrets.
```

- [ ] **Step 6: Commit fixture contract**

Run:

```bash
git add plugins/polycli/scripts/tests/fixtures/run-ledger
git commit -m "test: capture run ledger failure fixtures"
```

Expected: commit succeeds with only fixture files staged.

### Task 2: Run Ledger Helper Module

**Files:**
- Create: `plugins/polycli/scripts/lib/run-ledger.mjs`
- Create: `plugins/polycli/scripts/tests/run-ledger.test.mjs`

- [ ] **Step 1: Write failing helper tests**

Create `plugins/polycli/scripts/tests/run-ledger.test.mjs` with tests for ids, append/read, corrupt-line skipping, grouping, explanations, rotation, and redaction:

```js
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendRunLedgerEvent,
  buildRunExplanation,
  groupRunLedgerEvents,
  readRunLedgerEvents,
  redactArgv,
  resolveRunId,
  resolveRunLedgerFile,
  summarizeRunLedger,
} from '../lib/run-ledger.mjs';

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'polycli-ledger-'));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('resolveRunId uses explicit value, env value, then generated id', () => {
  assert.equal(resolveRunId({ runId: 'explicit-run' }, { POLYCLI_RUN_ID: 'env-run' }), 'explicit-run');
  assert.equal(resolveRunId({}, { POLYCLI_RUN_ID: 'env-run' }), 'env-run');
  assert.match(resolveRunId({}, {}), /^[A-Za-z0-9_.-]{1,96}$/);
  assert.throws(() => resolveRunId({ runId: '../bad' }, {}), /Invalid run id/);
});

test('redactArgv removes prompts and token-like values', () => {
  assert.deepEqual(
    redactArgv(['ask', '--provider', 'qwen', '--api-key', 'secret', '--token=abc', 'full prompt'], { command: 'ask' }),
    ['ask', '--provider', 'qwen', '--api-key', '<secret:redacted>', '--token=<secret:redacted>', '<prompt:redacted>'],
  );
  assert.deepEqual(
    redactArgv(['review', '--focus', 'private context', 'API_TOKEN=secret'], { command: 'review' }),
    ['review', '--focus', '<prompt:redacted>', 'API_TOKEN=<secret:redacted>'],
  );
});

test('appendRunLedgerEvent and readRunLedgerEvents tolerate corrupt lines', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-a',
      command: 'health',
      phase: 'run_started',
      status: 'started',
      hostSurface: 'terminal',
    });
    const file = resolveRunLedgerFile(workspaceRoot);
    await writeFile(file, `${await readFile(file, 'utf8')}{bad json}\n`);
    const events = await readRunLedgerEvents(workspaceRoot);
    assert.equal(events.length, 1);
    assert.equal(events[0].runId, 'run-a');
    assert.equal(events[0].commands[0], 'health');
  });
});

test('groupRunLedgerEvents and summarizeRunLedger count provider decisions', () => {
  const events = [
    { runId: 'run-a', at: '2026-05-07T00:00:00.000Z', command: 'health', commands: ['health'], phase: 'run_started', status: 'started', hostSurface: 'terminal' },
    { runId: 'run-a', at: '2026-05-07T00:00:01.000Z', command: 'health', commands: ['health'], phase: 'provider_decision', provider: 'pi', status: 'skipped', reason: 'health_failed', hostSurface: 'terminal' },
    { runId: 'run-a', at: '2026-05-07T00:00:02.000Z', command: 'ask', commands: ['ask', 'health'], phase: 'provider_decision', provider: 'cmd', status: 'failed', reason: 'ask_failed', hostSurface: 'terminal' },
    { runId: 'run-a', at: '2026-05-07T00:00:03.000Z', command: 'ask', commands: ['ask', 'health'], phase: 'provider_decision', provider: 'qwen', status: 'adopted', reason: null, hostSurface: 'terminal' },
  ];
  const grouped = groupRunLedgerEvents(events);
  assert.deepEqual(grouped.get('run-a').commands, ['ask', 'health']);
  assert.deepEqual(summarizeRunLedger(events)[0], {
    runId: 'run-a',
    commands: ['ask', 'health'],
    startedAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:03.000Z',
    providerCount: 3,
    adoptedCount: 1,
    skippedCount: 1,
    failedCount: 1,
  });
  assert.match(buildRunExplanation(events, 'run-a').text, /qwen adopted/);
  assert.match(buildRunExplanation(events, 'run-a').text, /cmd failed/);
  assert.match(buildRunExplanation(events, 'run-a').text, /pi skipped/);
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run: `node --test plugins/polycli/scripts/tests/run-ledger.test.mjs`
Expected: fail with module-not-found for `../lib/run-ledger.mjs`.

- [ ] **Step 3: Implement `run-ledger.mjs`**

Create `plugins/polycli/scripts/lib/run-ledger.mjs` with these exported functions:

```js
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { appendNdjson, readNdjson } from '@bbingz/polycli-utils/ndjson';
import { resolveStateDir } from './state.mjs';

const MAX_LEDGER_BYTES = 2_000_000;
const KEEP_RATIO = 0.5;
const RUN_ID_RE = /^[A-Za-z0-9_.-]{1,96}$/;
const SECRET_LONG_OPT_RE = /(token|secret|password|api-?key|access-?key|credential)/i;
const SECRET_ENV_KEY_RE = /(TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_KEY|CREDENTIAL)/i;
const PROMPT_COMMANDS = new Set(['ask', 'rescue', 'review', 'adversarial-review']);
const VALID_HOST_SURFACES = new Set(['terminal', 'claude-plugin', 'codex-skill', 'copilot-skill', 'opencode-plugin', 'unknown']);

export function resolveRunLedgerFile(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), 'run-ledger.ndjson');
}

export function createRunId() {
  return `run_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

export function resolveRunId(options = {}, env = process.env) {
  const runId = options.runId || env.POLYCLI_RUN_ID || createRunId();
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  return runId;
}

export function resolveHostSurface(env = process.env, companionUrl = import.meta.url) {
  if (VALID_HOST_SURFACES.has(env.POLYCLI_HOST_SURFACE)) return env.POLYCLI_HOST_SURFACE;
  if (env.CLAUDE_PLUGIN_ROOT) return 'claude-plugin';
  if (companionUrl.includes('polycli-codex')) return 'codex-skill';
  if (companionUrl.includes('polycli-copilot')) return 'copilot-skill';
  if (companionUrl.includes('polycli-opencode')) return 'opencode-plugin';
  return 'unknown';
}

export function stripRunIdArgs(argv) {
  const next = [];
  let runId = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run-id') {
      runId = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--run-id=')) {
      runId = arg.slice('--run-id='.length);
      continue;
    }
    next.push(arg);
  }
  return { argv: next, runId };
}

function redactInlineValue(arg) {
  const eq = arg.indexOf('=');
  if (eq === -1) return arg;
  const key = arg.slice(0, eq);
  if (key.startsWith('--') && SECRET_LONG_OPT_RE.test(key)) {
    return `${key}=<secret:redacted>`;
  }
  if (!key.startsWith('--') && SECRET_ENV_KEY_RE.test(key)) {
    return `${key}=<secret:redacted>`;
  }
  return arg;
}

export function redactArgv(argv, { command } = {}) {
  const redacted = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        redacted.push(redactInlineValue(arg));
        continue;
      }
      redacted.push(arg);
      if (SECRET_LONG_OPT_RE.test(arg) || (command === 'review' && arg === '--focus')) {
        if (i + 1 < argv.length) {
          redacted.push(SECRET_LONG_OPT_RE.test(arg) ? '<secret:redacted>' : '<prompt:redacted>');
          i += 1;
        }
      }
      continue;
    }
    redacted.push(redactInlineValue(arg));
  }
  if (PROMPT_COMMANDS.has(command) && redacted.length > 0) {
    const last = redacted.length - 1;
    if (!String(redacted[last]).startsWith('-') && !String(redacted[last]).includes('=')) {
      redacted[last] = '<prompt:redacted>';
    }
  }
  return redacted;
}

export function createRunLedgerEvent(event) {
  const at = event.at || new Date().toISOString();
  const command = event.command || null;
  const commands = [...new Set(event.commands || (command ? [command] : []))].sort();
  return {
    version: 1,
    eventId: event.eventId || `evt_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    at,
    workspaceRoot: event.workspaceRoot || null,
    workspaceSlug: event.workspaceSlug || null,
    kind: event.kind || event.command || null,
    provider: event.provider ?? null,
    reason: event.reason ?? null,
    attempt: event.attempt ?? null,
    jobId: event.jobId ?? null,
    model: event.model ?? null,
    defaultModel: event.defaultModel ?? null,
    timingRef: event.timingRef ?? null,
    error: event.error ?? null,
    preview: event.preview ?? null,
    stdoutBytes: event.stdoutBytes ?? null,
    stderrBytes: event.stderrBytes ?? null,
    logFile: event.logFile ?? null,
    argv: event.argv || [],
    ...event,
    command,
    commands,
    status: event.status,
    phase: event.phase,
    hostSurface: event.hostSurface || 'unknown',
  };
}

export async function appendRunLedgerEvent(workspaceRoot, event) {
  const file = resolveRunLedgerFile(workspaceRoot);
  const full = createRunLedgerEvent({ ...event, workspaceRoot });
  appendNdjson(file, full, { maxBytes: MAX_LEDGER_BYTES, keepRatio: KEEP_RATIO });
  return full;
}

export async function readRunLedgerEvents(workspaceRoot) {
  const file = resolveRunLedgerFile(workspaceRoot);
  return readNdjson(file);
}

export function groupRunLedgerEvents(events) {
  const groups = new Map();
  for (const event of events) {
    if (!event?.runId) continue;
    const group = groups.get(event.runId) || { runId: event.runId, commands: [], events: [] };
    group.events.push(event);
    group.commands = [...new Set([...group.commands, ...(event.commands || []), event.command].filter(Boolean))].sort();
    groups.set(event.runId, group);
  }
  for (const group of groups.values()) {
    group.events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return groups;
}

export function summarizeRunLedger(events) {
  return [...groupRunLedgerEvents(events).values()].map((group) => {
    const decisions = group.events.filter((event) => event.phase === 'provider_decision' && event.provider);
    return {
      runId: group.runId,
      commands: group.commands,
      startedAt: group.events[0]?.at || null,
      updatedAt: group.events.at(-1)?.at || null,
      providerCount: new Set(decisions.map((event) => event.provider)).size,
      adoptedCount: decisions.filter((event) => event.status === 'adopted').length,
      skippedCount: decisions.filter((event) => event.status === 'skipped').length,
      failedCount: decisions.filter((event) => event.status === 'failed').length,
    };
  });
}

export function buildRunExplanation(events, runId) {
  const group = groupRunLedgerEvents(events).get(runId);
  if (!group) return { runId, found: false, text: `Run ${runId} was not found.`, events: [] };
  const decisions = group.events.filter((event) => event.phase === 'provider_decision');
  const lines = decisions.map((event) => `${event.provider || 'run'} ${event.status}${event.reason ? ` (${event.reason})` : ''}`);
  return { runId, found: true, text: lines.join('\n'), events: group.events };
}
```

- [ ] **Step 4: Run helper tests**

Run: `node --test plugins/polycli/scripts/tests/run-ledger.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit helper module**

Run:

```bash
git add plugins/polycli/scripts/lib/run-ledger.mjs plugins/polycli/scripts/tests/run-ledger.test.mjs
git commit -m "feat: add run ledger helpers"
```

Expected: commit succeeds with only helper and helper-test files staged.

### Task 3: Companion Run-Id Parsing And Ledger Writes

**Files:**
- Modify: `plugins/polycli/scripts/polycli-companion.mjs`
- Modify: `plugins/polycli/scripts/tests/integration.test.mjs`

- [ ] **Step 1: Write failing integration tests**

Add tests that spawn the companion in a temp workspace and assert ledger files exist after commands:

```js
import { appendRunLedgerEvent, readRunLedgerEvents } from "../lib/run-ledger.mjs";

function createFakeCmdBin(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-cmd-"));
  const bin = path.join(root, "cmd");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("cmd 0.0.0-test\\n");
  process.exit(0);
}
if (args[0] === "status") {
  process.stdout.write("authenticated\\n");
  process.exit(0);
}
process.exit(0);
`,
    { mode: 0o755 },
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return bin;
}

function createLedgerContext(t, extraEnv = {}) {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ledger-cwd-"));
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  t.after(() => {
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    fs.rmSync(pluginData, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  return {
    cwd,
    env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData, CMD_CLI_BIN: createFakeCmdBin(t), ...extraEnv }),
  };
}

test('health strips run-id before provider resolution and writes ledger events', async (t) => {
  const context = createLedgerContext(t);
  const result = await runCompanion(['health', '--provider', 'cmd', '--json', '--run-id=run-test'], context);
  assert.equal(result.code, 0);
  const events = await readRunLedgerEvents(context.cwd);
  assert.ok(events.some((event) => event.runId === 'run-test' && event.phase === 'health_result'));
  assert.ok(events.every((event) => event.provider !== '--run-id=run-test'));
});

test('ask writes failed provider decisions for unusable provider output', async (t) => {
  const context = createLedgerContext(t);
  await runCompanion(['ask', '--provider', 'cmd', '--json', 'Return exactly POLYCLI_FIXTURE_OK', '--run-id', 'run-cmd'], context);
  await runCompanion(['ask', '--provider', 'cmd', '--json', 'Return exactly POLYCLI_FIXTURE_OK', '--run-id', 'run-cmd'], context);
  const events = await readRunLedgerEvents(context.cwd);
  assert.equal(events.filter((event) => event.runId === 'run-cmd' && event.phase === 'provider_decision' && event.status === 'failed').length, 2);
});

test('review with no changes writes no_changes skipped decision', async (t) => {
  const context = createLedgerContext(t);
  const result = await runCompanion(['review', '--json', '--run-id', 'run-clean'], context);
  assert.equal(result.code, 0);
  const events = await readRunLedgerEvents(context.cwd);
  assert.ok(events.some((event) => event.runId === 'run-clean' && event.phase === 'provider_decision' && event.status === 'skipped' && event.reason === 'no_changes'));
});
```

- [ ] **Step 2: Run integration tests to verify failure**

Run: `npm run build:plugins && node --test plugins/polycli/scripts/tests/integration.test.mjs`
Expected: fail because the bundled companion does not yet parse `--run-id` globally or write the ledger.

- [ ] **Step 3: Import ledger helpers and strip run id once**

In `plugins/polycli/scripts/polycli-companion.mjs`, import:

```js
import {
  appendRunLedgerEvent,
  buildRunExplanation,
  readRunLedgerEvents,
  redactArgv,
  resolveHostSurface,
  resolveRunId,
  stripRunIdArgs,
  summarizeRunLedger,
} from './lib/run-ledger.mjs';
```

Near the top-level argument parse, normalize arguments:

```js
const rawArgs = process.argv.slice(2);
const { argv: normalizedArgs, runId: explicitRunId } = stripRunIdArgs(rawArgs);
const command = normalizedArgs[0] || 'help';
const hostSurface = resolveHostSurface(process.env, import.meta.url);
const runId = ['health', 'ask', 'rescue', 'review', 'adversarial-review'].includes(command)
  ? resolveRunId({ runId: explicitRunId }, process.env)
  : null;
```

Replace existing uses of `process.argv.slice(2)` for command dispatch with `normalizedArgs`.

- [ ] **Step 4: Add a small ledger writer wrapper**

In `plugins/polycli/scripts/polycli-companion.mjs`, add:

```js
async function recordRunEvent(workspaceRoot, base) {
  if (!base.runId) return null;
  return appendRunLedgerEvent(workspaceRoot, {
    ...base,
    hostSurface,
    argv: redactArgv(rawArgs, { command: base.command }),
  });
}
```

- [ ] **Step 5: Write run lifecycle events around supported commands**

At the start and end of `health`, `ask`, `rescue`, `review`, and `adversarial-review` command handling:

```js
await recordRunEvent(workspaceRoot, {
  runId,
  command,
  commands: [command],
  phase: 'run_started',
  status: 'started',
});

try {
  const result = await runCommandBody();
  await recordRunEvent(workspaceRoot, {
    runId,
    command,
    commands: [command],
    phase: 'run_summary',
    status: result?.ok === false ? 'failed' : 'completed',
  });
  return result;
} catch (error) {
  await recordRunEvent(workspaceRoot, {
    runId,
    command,
    commands: [command],
    phase: 'run_summary',
    status: 'failed',
    error: { message: String(error?.message || error).slice(0, 300) },
  });
  throw error;
}
```

Adapt the snippet to the existing command functions rather than wrapping the whole file in a new framework.

- [ ] **Step 6: Write health provider events**

Inside `runHealth`, after each provider report is available:

```js
await recordRunEvent(workspaceRoot, {
  runId,
  command: 'health',
  commands: ['health'],
  kind: 'health',
  provider: report.provider,
  phase: 'health_result',
  status: report.ok ? 'passed' : 'failed',
  reason: report.ok ? 'health_passed' : 'health_failed',
  model: report.model || null,
  preview: report.responsePreview || null,
  error: report.error ? { message: String(report.error).slice(0, 300) } : null,
});

await recordRunEvent(workspaceRoot, {
  runId,
  command: 'health',
  commands: ['health'],
  kind: 'health',
  provider: report.provider,
  phase: 'provider_decision',
  status: report.ok ? 'passed' : 'skipped',
  reason: report.ok ? 'health_passed' : 'health_failed',
});
```

- [ ] **Step 7: Write foreground attempt events**

In `runForegroundExecution`, before and after provider invocation:

```js
await recordRunEvent(workspaceRoot, {
  runId,
  command,
  commands: [command],
  kind,
  provider,
  phase: 'attempt_started',
  status: 'started',
  attempt: { ordinal: attemptOrdinal },
});

const result = await invokeProvider();

await recordRunEvent(workspaceRoot, {
  runId,
  command,
  commands: [command],
  kind,
  provider,
  phase: 'attempt_result',
  status: result.ok ? 'completed' : 'failed',
  attempt: { ordinal: attemptOrdinal },
  model: result.model || null,
  defaultModel: result.defaultModel || null,
  preview: String(result.response || '').slice(0, 180),
  stdoutBytes: result.stdoutBytes ?? null,
  stderrBytes: result.stderrBytes ?? null,
  timingRef: result.timing ? {
    provider: result.timing.provider,
    kind: result.timing.kind,
    completedAt: result.timing.completedAt,
  } : null,
});

await recordRunEvent(workspaceRoot, {
  runId,
  command,
  commands: [command],
  kind,
  provider,
  phase: 'provider_decision',
  status: result.ok ? 'adopted' : 'failed',
  reason: result.ok ? null : 'ask_failed',
});
```

- [ ] **Step 8: Write no-diff review skipped state**

On the existing no-diff early return path:

```js
await recordRunEvent(workspaceRoot, {
  runId,
  command,
  commands: [command],
  provider: null,
  phase: 'provider_decision',
  status: 'skipped',
  reason: 'no_changes',
});
```

- [ ] **Step 9: Run companion integration tests**

Run: `npm run build:plugins && node --test plugins/polycli/scripts/tests/integration.test.mjs plugins/polycli/scripts/tests/run-ledger.test.mjs`
Expected: all tests pass.

- [ ] **Step 10: Commit companion ledger writes**

Run:

```bash
git add plugins/polycli/scripts/polycli-companion.mjs plugins/polycli/scripts/polycli-companion.bundle.mjs plugins/polycli-codex/scripts/polycli-companion.bundle.mjs plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs plugins/polycli/scripts/tests/integration.test.mjs
git commit -m "feat: record companion run ledger events"
```

Expected: commit succeeds with only companion, generated bundle, and integration-test changes staged.

### Task 4: Shared Debug Commands

**Files:**
- Modify: `plugins/polycli/scripts/polycli-companion.mjs`
- Modify: `plugins/polycli/scripts/tests/integration.test.mjs`

- [ ] **Step 1: Write failing debug command tests**

Add integration tests:

```js
test('debug runs returns summarized ledger runs', async (t) => {
  const context = createLedgerContext(t);
  await appendRunLedgerEvent(context.cwd, { runId: 'run-debug', command: 'health', commands: ['health'], phase: 'run_started', status: 'started', hostSurface: 'terminal' });
  await appendRunLedgerEvent(context.cwd, { runId: 'run-debug', command: 'health', commands: ['health'], phase: 'provider_decision', provider: 'pi', status: 'skipped', reason: 'health_failed', hostSurface: 'terminal' });
  const result = await runCompanion(['debug', 'runs', '--json'], context);
  assert.equal(result.code, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.runs[0].runId, 'run-debug');
  assert.deepEqual(json.runs[0].commands, ['health']);
});

test('debug show returns raw events for a run', async (t) => {
  const context = createLedgerContext(t);
  await appendRunLedgerEvent(context.cwd, { runId: 'run-show', command: 'ask', commands: ['ask'], phase: 'provider_decision', provider: 'cmd', status: 'failed', reason: 'ask_failed', hostSurface: 'terminal' });
  const result = await runCompanion(['debug', 'show', 'run-show', '--json'], context);
  assert.equal(result.code, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.runId, 'run-show');
  assert.equal(json.events[0].provider, 'cmd');
});

test('debug explain returns provider decisions', async (t) => {
  const context = createLedgerContext(t);
  await appendRunLedgerEvent(context.cwd, { runId: 'run-explain', command: 'ask', commands: ['ask'], phase: 'provider_decision', provider: 'qwen', status: 'adopted', hostSurface: 'terminal' });
  const result = await runCompanion(['debug', 'explain', 'run-explain', '--json'], context);
  assert.equal(result.code, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.found, true);
  assert.match(json.text, /qwen adopted/);
});
```

- [ ] **Step 2: Run debug command tests to verify failure**

Run: `npm run build:plugins && node --test plugins/polycli/scripts/tests/integration.test.mjs`
Expected: fail because `debug` dispatch is not implemented.

- [ ] **Step 3: Implement `debug` dispatch**

Add command handling that reuses ledger helpers:

```js
async function runDebugCommand(workspaceRoot, args) {
  const subcommand = args[1] || 'runs';
  const json = args.includes('--json');
  const events = await readRunLedgerEvents(workspaceRoot);

  if (subcommand === 'runs') {
    const runs = summarizeRunLedger(events);
    if (json) return printJson({ ok: true, runs });
    return printText(formatRunsTable(runs));
  }

  if (subcommand === 'show') {
    const runId = args.find((arg, index) => index > 1 && !arg.startsWith('-'));
    const runEvents = events.filter((event) => event.runId === runId);
    if (json) return printJson({ ok: true, runId, events: runEvents });
    return printText(JSON.stringify({ runId, events: runEvents }, null, 2));
  }

  if (subcommand === 'explain') {
    const runId = args.find((arg, index) => index > 1 && !arg.startsWith('-'));
    const explanation = buildRunExplanation(events, runId);
    if (json) return printJson({ ok: true, ...explanation });
    return printText(explanation.text);
  }

  return failUnknownCommand(`debug ${subcommand}`);
}
```

Use existing companion JSON/text print helpers and error shapes rather than introducing a new output convention.

- [ ] **Step 4: Run focused tests**

Run: `npm run build:plugins && node --test plugins/polycli/scripts/tests/integration.test.mjs plugins/polycli/scripts/tests/run-ledger.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit debug commands**

Run:

```bash
git add plugins/polycli/scripts/polycli-companion.mjs plugins/polycli/scripts/polycli-companion.bundle.mjs plugins/polycli-codex/scripts/polycli-companion.bundle.mjs plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs plugins/polycli/scripts/tests/integration.test.mjs
git commit -m "feat: add run ledger debug commands"
```

Expected: commit succeeds with only companion, generated bundle, and debug test changes staged.

### Task 5: Terminal Package And Wrapper

**Files:**
- Create: `packages/polycli-terminal/package.json`
- Create: `packages/polycli-terminal/bin/polycli.mjs`
- Create: `packages/polycli-terminal/README.md`
- Modify: `scripts/tests/open-source-packaging.test.mjs`

- [ ] **Step 1: Write failing package hygiene tests**

Extend `scripts/tests/open-source-packaging.test.mjs`:

```js
test('terminal package exposes polycli bin and keeps runtime private', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../packages/polycli-terminal/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@bbingz/polycli');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.bin.polycli, './bin/polycli.mjs');
  assert.ok(pkg.files.includes('bin/polycli.mjs'));
  assert.ok(pkg.files.includes('bin/polycli-companion.bundle.mjs'));
});
```

- [ ] **Step 2: Run package test to verify failure**

Run: `node --test scripts/tests/open-source-packaging.test.mjs`
Expected: fail because `packages/polycli-terminal/package.json` does not exist.

- [ ] **Step 3: Add terminal package metadata**

Create `packages/polycli-terminal/package.json`:

```json
{
  "name": "@bbingz/polycli",
  "version": "0.6.6",
  "description": "Terminal CLI for Polycli provider diagnostics and host-compatible commands.",
  "type": "module",
  "bin": {
    "polycli": "./bin/polycli.mjs"
  },
  "files": [
    "bin/polycli.mjs",
    "bin/polycli-companion.bundle.mjs",
    "README.md"
  ],
  "engines": {
    "node": ">=20"
  },
  "license": "MIT"
}
```

- [ ] **Step 4: Add terminal wrapper**

Create `packages/polycli-terminal/bin/polycli.mjs`:

```js
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const companion = path.join(here, 'polycli-companion.bundle.mjs');

const child = spawn(process.execPath, [companion, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    POLYCLI_HOST_SURFACE: process.env.POLYCLI_HOST_SURFACE || 'terminal',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`polycli: failed to start companion: ${error.message}`);
  process.exit(1);
});
```

- [ ] **Step 5: Add terminal package README**

Create `packages/polycli-terminal/README.md`:

````markdown
# @bbingz/polycli

Terminal CLI for the same Polycli companion behavior used by the Claude Code, Codex, Copilot CLI, and OpenCode host adapters.

```bash
polycli health --json
POLYCLI_RUN_ID=review-20260507 polycli ask --provider qwen --json "Return exactly POLYCLI_HEALTH_OK"
POLYCLI_RUN_ID=review-20260507 polycli debug explain review-20260507
```

The terminal package does not expose provider runtime internals as a public framework.
````

- [ ] **Step 6: Run package hygiene test**

Run: `node --test scripts/tests/open-source-packaging.test.mjs`
Expected: all tests pass.

- [ ] **Step 7: Commit terminal package**

Run:

```bash
git add packages/polycli-terminal scripts/tests/open-source-packaging.test.mjs
git commit -m "feat: add terminal polycli package"
```

Expected: commit succeeds with only terminal package and package-test changes staged.

### Task 6: Bundle And Release Guardrails

**Files:**
- Modify: `scripts/build-plugin-bundles.mjs`
- Modify: `scripts/validate-plugin-bundles.mjs`
- Modify: `scripts/tests/validate-plugin-bundles.test.mjs`
- Modify: `scripts/validate-host-command-map.mjs`
- Modify: `scripts/check-release.mjs`
- Modify: `scripts/validate-release-manifests.mjs`
- Modify: `plugins/polycli/scripts/tests/host-packaging.test.mjs`

- [ ] **Step 1: Write failing bundle target test**

Extend `scripts/tests/validate-plugin-bundles.test.mjs` to include five matching files and assert mismatch detection still works:

```js
const targets = [
  'plugins/polycli/scripts/polycli-companion.bundle.mjs',
  'plugins/polycli-codex/scripts/polycli-companion.bundle.mjs',
  'plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs',
  'plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs',
  'packages/polycli-terminal/bin/polycli-companion.bundle.mjs',
];
```

- [ ] **Step 2: Update bundle build targets**

In `scripts/build-plugin-bundles.mjs`, add:

```js
{
  label: 'terminal',
  output: 'packages/polycli-terminal/bin/polycli-companion.bundle.mjs',
}
```

Use the existing target object shape in that file.

- [ ] **Step 3: Update bundle validator real targets**

In `scripts/validate-plugin-bundles.mjs`, include:

```js
'packages/polycli-terminal/bin/polycli-companion.bundle.mjs'
```

in the real bundle target list.

- [ ] **Step 4: Update host command map validation**

In `scripts/validate-host-command-map.mjs`, extend the expected command vocabulary to include `debug`, and update terminal-column validation so `docs/host-command-map.md` must cover terminal support.

Expected command set:

```js
const EXPECTED_COMMANDS = [
  'setup',
  'health',
  'ask',
  'rescue',
  'review',
  'adversarial-review',
  'status',
  'result',
  'cancel',
  'timing',
  'debug',
];
```

- [ ] **Step 5: Update release package checks**

In `scripts/check-release.mjs` and `scripts/validate-release-manifests.mjs`, include `packages/polycli-terminal/package.json` in public package checks while preserving `@bbingz/polycli-runtime` as bundled/internal.

- [ ] **Step 6: Run release guard tests**

Run:

```bash
node --test scripts/tests/validate-plugin-bundles.test.mjs scripts/tests/open-source-packaging.test.mjs plugins/polycli/scripts/tests/host-packaging.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Build and validate bundles**

Run:

```bash
npm run build:plugins
npm run validate:bundles
npm run validate:host-map
```

Expected: all commands pass and the terminal bundle exists at `packages/polycli-terminal/bin/polycli-companion.bundle.mjs`.

- [ ] **Step 8: Commit guardrails**

Run:

```bash
git add scripts plugins/polycli/scripts/tests/host-packaging.test.mjs packages/polycli-terminal/bin/polycli-companion.bundle.mjs
git commit -m "build: include terminal companion bundle"
```

Expected: commit succeeds with only bundle/validator/test changes staged.

### Task 7: Documentation Alignment

**Files:**
- Modify: `README.md`
- Modify: `docs/host-command-map.md`
- Modify: `docs/polycli-v1-public-surface.md`
- Modify: `docs/roadmap.md`
- Modify: `tasks/terminal-cli-tui-observability.md`

- [ ] **Step 1: Update README terminal guidance**

Replace the old no-standalone-shell wording with:

````markdown
### Terminal CLI

Install `@bbingz/polycli` when you need a PATH-callable terminal surface outside Claude Code, Codex, Copilot CLI, or OpenCode.

```bash
npm install -g @bbingz/polycli
polycli health --json
POLYCLI_RUN_ID=review-20260507 polycli debug explain review-20260507
```

The terminal CLI uses the same companion command behavior as host adapters. Provider runtime internals remain bundled implementation details.
````

- [ ] **Step 2: Update host command map**

Add a `Terminal CLI` column and a `debug` row. The `debug` row should mark all host surfaces as supported through the shared companion vocabulary, with examples limited to `debug runs`, `debug show`, and `debug explain`.

- [ ] **Step 3: Update public surface doc**

Add `@bbingz/polycli` as the terminal/operator public package, and keep `@bbingz/polycli-runtime` described as internal bundled adapter code.

- [ ] **Step 4: Update roadmap and task file**

Mark the first Q6 slice as planned/implemented according to the actual code state:

```markdown
- Spec 1 landed: terminal package wrapper, shared `debug` commands, and redacted run ledger foundation.
```

Use this only after Tasks 1 through 6 pass.

- [ ] **Step 5: Run docs validators**

Run:

```bash
npm run validate:host-map
npm run release:check
```

Expected: host map passes; release check passes or reports only provider availability issues unrelated to docs/package metadata.

- [ ] **Step 6: Commit docs**

Run:

```bash
git add README.md docs/host-command-map.md docs/polycli-v1-public-surface.md docs/roadmap.md tasks/terminal-cli-tui-observability.md
git commit -m "docs: document terminal run ledger surface"
```

Expected: commit succeeds with only documentation changes staged.

### Task 8: End-To-End Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
node --test plugins/polycli/scripts/tests/run-ledger.test.mjs plugins/polycli/scripts/tests/integration.test.mjs plugins/polycli/scripts/tests/host-packaging.test.mjs scripts/tests/validate-plugin-bundles.test.mjs scripts/tests/open-source-packaging.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full project tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Run release checks**

Run: `npm run release:check`
Expected: release check passes. If an external provider probe blocks the command, capture the exact provider/tool failure and verify all local validators before reporting the blocker.

- [ ] **Step 4: Run terminal smoke**

Run:

```bash
npm run build:plugins
node packages/polycli-terminal/bin/polycli.mjs health --provider cmd --json --run-id run-smoke
node packages/polycli-terminal/bin/polycli.mjs debug runs --json
```

Expected: first command returns companion health JSON; second command returns JSON containing `run-smoke` and `hostSurface: "terminal"` events in the ledger.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: no unrelated files are changed. Any generated bundle file should be intentional and covered by `validate:bundles`.
