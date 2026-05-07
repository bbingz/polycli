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
  });
  assert.match(buildRunExplanation(events, 'run-a').text, /qwen adopted/);
  assert.match(buildRunExplanation(events, 'run-a').text, /cmd failed/);
  assert.match(buildRunExplanation(events, 'run-a').text, /pi skipped/);
});
