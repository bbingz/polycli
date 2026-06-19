import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendRunLedgerEvent,
  buildRunExplanation,
  createRunLedgerEvent,
  groupRunLedgerEvents,
  readRunLedgerEvents,
  redactArgv,
  resolveRunId,
  resolveRunLedgerFile,
  summarizeRunLedger,
} from '../lib/run-ledger.mjs';
import { resolveStateDir } from '../lib/state.mjs';

async function fileMode(filePath) {
  return (await stat(filePath)).mode & 0o777;
}

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'polycli-ledger-'));
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = await mkdtemp(path.join(os.tmpdir(), 'polycli-ledger-data-'));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(process.env.CLAUDE_PLUGIN_DATA, { recursive: true, force: true });
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
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

test('redactArgv redacts every prompt positional, not only the last token', () => {
  assert.deepEqual(
    redactArgv(['ask', '--provider', 'qwen', 'hello', 'private', 'world'], { command: 'ask' }),
    ['ask', '--provider', 'qwen', '<prompt:redacted>', '<prompt:redacted>', '<prompt:redacted>'],
  );
  assert.deepEqual(
    redactArgv(['rescue', '--provider', 'qwen', '--model', 'foo', 'triage', 'these', 'tests'], { command: 'rescue' }),
    ['rescue', '--provider', 'qwen', '--model', 'foo', '<prompt:redacted>', '<prompt:redacted>', '<prompt:redacted>'],
  );
});

test('redactArgv redacts every focus positional for review and adversarial-review', () => {
  assert.deepEqual(
    redactArgv(['adversarial-review', '--provider', 'qwen', 'private', 'focus', 'words'], { command: 'adversarial-review' }),
    ['adversarial-review', '--provider', 'qwen', '<prompt:redacted>', '<prompt:redacted>', '<prompt:redacted>'],
  );
  assert.deepEqual(
    redactArgv(['review', '--provider', 'cmd', '--scope', 'staged', 'sensitive', 'context'], { command: 'review' }),
    ['review', '--provider', 'cmd', '--scope', 'staged', '<prompt:redacted>', '<prompt:redacted>'],
  );
});

test('redactArgv preserves non-sensitive control flags (provider/model/json/background/run-id)', () => {
  assert.deepEqual(
    redactArgv(
      ['ask', '--provider', 'qwen', '--model', 'qwen-test', '--json', '--background', '--run-id', 'run-keep', 'prompt'],
      { command: 'ask' },
    ),
    [
      'ask',
      '--provider',
      'qwen',
      '--model',
      'qwen-test',
      '--json',
      '--background',
      '--run-id',
      'run-keep',
      '<prompt:redacted>',
    ],
  );
  assert.deepEqual(
    redactArgv(['health', '--provider', 'cmd', '--json', '--run-id=run-keep'], { command: 'health' }),
    ['health', '--provider', 'cmd', '--json', '--run-id=run-keep'],
  );
});

test('createRunLedgerEvent records sessionId and defaults to null without fabrication', () => {
  assert.equal(createRunLedgerEvent({ sessionId: 'abc' }).sessionId, 'abc');
  assert.equal(createRunLedgerEvent({}).sessionId, null);
  const keys = Object.keys(createRunLedgerEvent({ sessionId: 'abc' }));
  assert.equal(keys[keys.indexOf('model') + 1], 'sessionId');
  assert.equal(keys[keys.indexOf('sessionId') + 1], 'sessionArtifactPath');
  assert.equal(keys[keys.indexOf('sessionArtifactPath') + 1], 'defaultModel');
});

test('createRunLedgerEvent records sessionArtifactPath after sessionId and defaults to null', () => {
  assert.equal(createRunLedgerEvent({ sessionArtifactPath: '/abs/path.jsonl' }).sessionArtifactPath, '/abs/path.jsonl');
  assert.equal(createRunLedgerEvent({}).sessionArtifactPath, null);
  const keys = Object.keys(createRunLedgerEvent({ sessionArtifactPath: '/abs/path.jsonl' }));
  assert.equal(keys[keys.indexOf('sessionId') + 1], 'sessionArtifactPath');
});

test('appendRunLedgerEvent round-trips sessionArtifactPath through NDJSON read-back', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-artifact',
      command: 'ask',
      phase: 'attempt_result',
      provider: 'claude',
      status: 'completed',
      sessionId: 'sess-art',
      sessionArtifactPath: '/home/u/.claude/projects/-x/sess-art.jsonl',
      hostSurface: 'terminal',
    });
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-artifact',
      command: 'ask',
      phase: 'attempt_result',
      provider: 'gemini',
      status: 'completed',
      sessionId: 'g1',
      hostSurface: 'terminal',
    });
    const events = await readRunLedgerEvents(workspaceRoot);
    assert.equal(events.length, 2);
    assert.equal(events[0].sessionArtifactPath, '/home/u/.claude/projects/-x/sess-art.jsonl');
    assert.equal(events[1].sessionArtifactPath, null);
  });
});

test('appendRunLedgerEvent writes the run ledger privately', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-private-mode',
      command: 'ask',
      phase: 'attempt_result',
      provider: 'qwen',
      status: 'completed',
      hostSurface: 'terminal',
    });

    assert.equal(await fileMode(resolveRunLedgerFile(workspaceRoot)), 0o600);
  });
});

test('appendRunLedgerEvent hardens the containing state directory to 0700', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    // No prior ensureStateDir: this is the run_started path that fires before any other state write.
    // The directory holding the ledger/timing/model-cache must be created private, not 0o755.
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-dir-mode',
      command: 'ask',
      phase: 'run_started',
      provider: 'qwen',
      status: 'started',
      hostSurface: 'terminal',
    });

    assert.equal(await fileMode(resolveStateDir(workspaceRoot)), 0o700);
  });
});

test('appendRunLedgerEvent round-trips sessionId through NDJSON read-back', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-session',
      command: 'ask',
      phase: 'attempt_result',
      provider: 'qwen',
      status: 'completed',
      sessionId: 'sess-123',
      hostSurface: 'terminal',
    });
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-session',
      command: 'ask',
      phase: 'provider_decision',
      provider: 'qwen',
      status: 'adopted',
      hostSurface: 'terminal',
    });
    const events = await readRunLedgerEvents(workspaceRoot);
    assert.equal(events.length, 2);
    assert.equal(events[0].sessionId, 'sess-123');
    assert.equal(events[1].sessionId, null);
  });
});

test('appendRunLedgerEvent stamps a stable non-null workspaceSlug', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const first = await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-slug',
      command: 'health',
      phase: 'run_started',
      status: 'started',
      hostSurface: 'terminal',
    });
    const second = await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-slug',
      command: 'health',
      phase: 'run_summary',
      status: 'completed',
      hostSurface: 'terminal',
    });
    assert.equal(typeof first.workspaceSlug, 'string');
    assert.notEqual(first.workspaceSlug, '');
    assert.notEqual(first.workspaceSlug, null);
    assert.equal(first.workspaceSlug, second.workspaceSlug);
    const events = await readRunLedgerEvents(workspaceRoot);
    assert.equal(events.length, 2);
    for (const event of events) {
      assert.equal(event.workspaceSlug, first.workspaceSlug);
    }
  });
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
    failureClassCounts: {},
  });
  assert.match(buildRunExplanation(events, 'run-a').text, /qwen adopted/);
  assert.match(buildRunExplanation(events, 'run-a').text, /cmd failed/);
  assert.match(buildRunExplanation(events, 'run-a').text, /pi skipped/);
});

test('summarizeRunLedger classifies attempt failures', () => {
  const events = [
    { runId: 'run-b', at: '2026-05-07T00:00:00.000Z', command: 'ask', commands: ['ask'], phase: 'run_started', status: 'started', hostSurface: 'terminal' },
    { runId: 'run-b', at: '2026-05-07T00:00:01.000Z', command: 'ask', commands: ['ask'], phase: 'attempt_result', provider: 'qwen', status: 'failed', reason: 'worker_exited', error: { message: 'Maximum session turn limit reached' }, hostSurface: 'terminal' },
    { runId: 'run-b', at: '2026-05-07T00:00:02.000Z', command: 'ask', commands: ['ask'], phase: 'attempt_result', provider: 'cmd', status: 'failed', reason: 'worker_exited', error: 'process terminated', hostSurface: 'terminal' },
  ];

  assert.deepEqual(summarizeRunLedger(events)[0].failureClassCounts, {
    qwen_max_session_turns: 1,
    terminated: 1,
  });
  assert.match(buildRunExplanation(events, 'run-b').text, /attempt qwen failed \(qwen_max_session_turns\)/);
  assert.match(buildRunExplanation(events, 'run-b').text, /attempt cmd failed \(terminated\)/);
});
