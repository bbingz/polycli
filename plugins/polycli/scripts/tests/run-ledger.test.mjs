import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendRunLedgerEvent,
  appendRunLedgerEvents,
  buildRunExplanation,
  createRunLedgerEvent,
  createTerminalLedgerDescriptor,
  ensureRunLedgerTerminalPair,
  groupRunLedgerEvents,
  readRunLedgerEvents,
  redactArgv,
  resolveRunId,
  resolveRunLedgerFile,
  selectRunLedgerTail,
  stripRunIdArgs,
  summarizeRunLedger,
  tailRunLedgerEvents,
} from '../lib/run-ledger.mjs';
import { resolveStateDir } from '../lib/state.mjs';
import { readLedgerWithPreGateBReader } from './fixtures/pre-gate-b-readers.mjs';

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

test('stripRunIdArgs never interprets option-looking literals after the delimiter', () => {
  assert.deepEqual(
    stripRunIdArgs(['--run-id', 'real', '--', '--run-id', 'literal']),
    { argv: ['--', '--run-id', 'literal'], runId: 'real' },
  );
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

test('createRunLedgerEvent writes schema v2 with explicit invocation, attempt, and provider session identities', () => {
  const event = createRunLedgerEvent({
    invocationId: 'inv_11111111111111111111',
    attemptId: 'att_22222222222222222222',
    jobId: 'job-identities',
    providerSessionId: 'provider-session',
  });

  assert.equal(event.version, 2);
  assert.equal(event.invocationId, 'inv_11111111111111111111');
  assert.equal(event.attemptId, 'att_22222222222222222222');
  assert.equal(event.jobId, 'job-identities');
  assert.equal(event.providerSessionId, 'provider-session');
  assert.equal(event.sessionId, 'provider-session');
  assert.equal(Object.hasOwn(event, 'hostSessionId'), false);
});

test('readRunLedgerEvents normalizes mixed v1/v2 identities and can preserve raw legacy events', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const file = resolveRunLedgerFile(workspaceRoot);
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-mixed-schema',
      phase: 'attempt_started',
      status: 'started',
      invocationId: 'inv_11111111111111111111',
      attemptId: 'att_22222222222222222222',
    });
    const legacy = {
      version: 1,
      eventId: 'evt_legacy',
      runId: 'run-mixed-schema',
      phase: 'attempt_result',
      status: 'completed',
      sessionId: 'provider-legacy',
    };
    await writeFile(file, `${await readFile(file, 'utf8')}${JSON.stringify(legacy)}\n`, 'utf8');

    const normalized = await readRunLedgerEvents(workspaceRoot);
    assert.equal(normalized[0].version, 2);
    assert.equal(normalized[1].version, 1);
    assert.equal(normalized[1].providerSessionId, 'provider-legacy');
    assert.equal(normalized[1].invocationId, null);
    assert.equal(normalized[1].attemptId, null);

    const raw = await readRunLedgerEvents(workspaceRoot, { raw: true });
    assert.equal(Object.hasOwn(raw[1], 'providerSessionId'), false);
    assert.equal(raw[1].sessionId, 'provider-legacy');
  });
});

test('the pre-Gate-B ledger reader tolerates additive v2 event identity fields', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-v2-additive',
      invocationId: 'inv_11111111111111111111',
      attemptId: 'att_22222222222222222222',
      providerSessionId: 'provider-v2',
      phase: 'attempt_started',
      status: 'started',
    });

    const rolledBack = readLedgerWithPreGateBReader(resolveRunLedgerFile(workspaceRoot));
    assert.equal(rolledBack.length, 1);
    assert.equal(rolledBack[0].version, 2);
    assert.equal(rolledBack[0].attemptId, 'att_22222222222222222222');
    assert.equal(rolledBack[0].providerSessionId, 'provider-v2');
  });
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

test('appendRunLedgerEvents writes a terminal pair together with shared workspace metadata', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const events = await appendRunLedgerEvents(workspaceRoot, [
      {
        runId: 'run-terminal-batch',
        command: 'rescue',
        phase: 'attempt_result',
        provider: 'qwen',
        status: 'completed',
        jobId: 'job-terminal-batch',
        hostSurface: 'terminal',
      },
      {
        runId: 'run-terminal-batch',
        command: 'rescue',
        phase: 'provider_decision',
        provider: 'qwen',
        status: 'adopted',
        jobId: 'job-terminal-batch',
        hostSurface: 'terminal',
      },
    ]);

    assert.equal(events.length, 2);
    assert.equal(events[0].workspaceSlug, events[1].workspaceSlug);
    const persisted = await readRunLedgerEvents(workspaceRoot);
    assert.deepEqual(persisted.map((event) => [event.phase, event.status]), [
      ['attempt_result', 'completed'],
      ['provider_decision', 'adopted'],
    ]);
  });
});

test('run-ledger compaction retains both sides of an older terminal pair', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const terminalPair = [
      {
        runId: 'run-retention-pair',
        command: 'rescue',
        phase: 'attempt_result',
        provider: 'qwen',
        status: 'completed',
        jobId: 'job-retention-pair',
        preview: 'a'.repeat(700_000),
        hostSurface: 'terminal',
      },
      {
        runId: 'run-retention-pair',
        command: 'rescue',
        phase: 'provider_decision',
        provider: 'qwen',
        status: 'adopted',
        jobId: 'job-retention-pair',
        preview: 'b'.repeat(700_000),
        hostSurface: 'terminal',
      },
    ];
    await appendRunLedgerEvents(workspaceRoot, terminalPair);

    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-newer-event',
      command: 'rescue',
      phase: 'attempt_started',
      provider: 'qwen',
      status: 'started',
      preview: 'c'.repeat(700_000),
      hostSurface: 'terminal',
    });

    const retained = (await readRunLedgerEvents(workspaceRoot))
      .filter((event) => event.runId === 'run-retention-pair' && event.jobId === 'job-retention-pair');
    assert.deepEqual(retained.map((event) => event.phase), ['attempt_result', 'provider_decision']);
  });
});

test('ensureRunLedgerTerminalPair safely completes a matching legacy partial pair', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-partial-pair',
      command: 'rescue',
      phase: 'attempt_result',
      provider: 'qwen',
      status: 'completed',
      jobId: 'job-partial-pair',
      hostSurface: 'terminal',
    });

    const repaired = ensureRunLedgerTerminalPair(workspaceRoot, [
      {
        runId: 'run-partial-pair',
        command: 'rescue',
        phase: 'attempt_result',
        provider: 'qwen',
        status: 'completed',
        jobId: 'job-partial-pair',
        hostSurface: 'terminal',
      },
      {
        runId: 'run-partial-pair',
        command: 'rescue',
        phase: 'provider_decision',
        provider: 'qwen',
        status: 'adopted',
        jobId: 'job-partial-pair',
        hostSurface: 'terminal',
      },
    ]);
    assert.equal(repaired.length, 2);
    const persisted = await readRunLedgerEvents(workspaceRoot);
    assert.deepEqual(persisted.map((event) => event.phase), ['attempt_result', 'provider_decision']);
  });
});

test('ensureRunLedgerTerminalPair refuses to adopt an identity-less partial into a v2 background attempt', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-v2-over-legacy-partial',
      command: 'rescue',
      phase: 'attempt_result',
      provider: 'qwen',
      status: 'completed',
      jobId: 'job-v2-over-legacy-partial',
      hostSurface: 'terminal',
    });

    const identity = {
      invocationId: 'inv_11111111111111111111',
      attemptId: 'att_22222222222222222222',
    };
    assert.throws(
      () => ensureRunLedgerTerminalPair(workspaceRoot, [
        {
          ...identity,
          runId: 'run-v2-over-legacy-partial',
          command: 'rescue',
          phase: 'attempt_result',
          provider: 'qwen',
          status: 'completed',
          jobId: 'job-v2-over-legacy-partial',
          hostSurface: 'terminal',
        },
        {
          ...identity,
          runId: 'run-v2-over-legacy-partial',
          command: 'rescue',
          phase: 'provider_decision',
          provider: 'qwen',
          status: 'adopted',
          jobId: 'job-v2-over-legacy-partial',
          hostSurface: 'terminal',
        },
      ]),
      /Incomplete or conflicting terminal ledger pair/,
    );

    const persisted = await readRunLedgerEvents(workspaceRoot);
    assert.deepEqual(persisted.map((event) => event.phase), ['attempt_result']);
    assert.equal(persisted[0].attemptId, null);
  });
});

test('compaction retains both halves of a fully legacy terminal pair', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-repaired-retention',
      command: 'rescue',
      phase: 'attempt_result',
      provider: 'qwen',
      status: 'completed',
      jobId: 'job-repaired-retention',
      preview: 'a'.repeat(1_400_000),
      hostSurface: 'terminal',
    });
    ensureRunLedgerTerminalPair(workspaceRoot, [
      {
        runId: 'run-repaired-retention',
        command: 'rescue',
        phase: 'attempt_result',
        provider: 'qwen',
        status: 'completed',
        jobId: 'job-repaired-retention',
        hostSurface: 'terminal',
      },
      {
        runId: 'run-repaired-retention',
        command: 'rescue',
        phase: 'provider_decision',
        provider: 'qwen',
        status: 'adopted',
        jobId: 'job-repaired-retention',
        hostSurface: 'terminal',
      },
    ]);

    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-after-repaired-retention',
      phase: 'attempt_started',
      preview: 'b'.repeat(700_000),
    });

    const retained = (await readRunLedgerEvents(workspaceRoot))
      .filter((event) => event.runId === 'run-repaired-retention');
    assert.deepEqual(retained.map((event) => event.phase), ['attempt_result', 'provider_decision']);
    assert.equal(retained.every((event) => event.invocationId == null && event.attemptId == null), true);
  });
});

test('ensureRunLedgerTerminalPair rejects a conflicting legacy partial for a v2 background attempt', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-v2-over-conflict',
      command: 'rescue',
      phase: 'attempt_result',
      provider: 'qwen',
      status: 'failed',
      jobId: 'job-v2-over-conflict',
      hostSurface: 'terminal',
    });

    assert.throws(
      () => ensureRunLedgerTerminalPair(workspaceRoot, [
        {
          runId: 'run-v2-over-conflict',
          invocationId: 'inv_11111111111111111111',
          attemptId: 'att_22222222222222222222',
          command: 'rescue',
          phase: 'attempt_result',
          provider: 'qwen',
          status: 'completed',
          jobId: 'job-v2-over-conflict',
          hostSurface: 'terminal',
        },
        {
          runId: 'run-v2-over-conflict',
          invocationId: 'inv_11111111111111111111',
          attemptId: 'att_22222222222222222222',
          command: 'rescue',
          phase: 'provider_decision',
          provider: 'qwen',
          status: 'adopted',
          jobId: 'job-v2-over-conflict',
          hostSurface: 'terminal',
        },
      ]),
      /Incomplete or conflicting terminal ledger pair/,
    );
    assert.equal((await readRunLedgerEvents(workspaceRoot)).length, 1);
  });
});

test('ensureRunLedgerTerminalPair rejects a partial pair whose material attribution conflicts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-conflicting-partial-pair',
      command: 'rescue',
      phase: 'attempt_result',
      provider: 'qwen',
      status: 'completed',
      jobId: 'job-conflicting-partial-pair',
      sessionId: 'session-a',
      hostSurface: 'terminal',
    });

    assert.throws(
      () => ensureRunLedgerTerminalPair(workspaceRoot, [
        {
          runId: 'run-conflicting-partial-pair',
          command: 'rescue',
          phase: 'attempt_result',
          provider: 'qwen',
          status: 'completed',
          jobId: 'job-conflicting-partial-pair',
          sessionId: 'session-b',
          hostSurface: 'terminal',
        },
        {
          runId: 'run-conflicting-partial-pair',
          command: 'rescue',
          phase: 'provider_decision',
          provider: 'qwen',
          status: 'adopted',
          jobId: 'job-conflicting-partial-pair',
          sessionId: 'session-b',
          hostSurface: 'terminal',
        },
      ]),
      /Incomplete or conflicting terminal ledger pair/,
    );
  });
});

test('ensureRunLedgerTerminalPair rejects a complete pair with conflicting provider identity', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const existing = [
      {
        runId: 'run-conflicting-pair',
        command: 'rescue',
        kind: 'rescue',
        phase: 'attempt_result',
        provider: 'wrong-provider',
        status: 'completed',
        jobId: 'job-conflicting-pair',
        hostSurface: 'terminal',
      },
      {
        runId: 'run-conflicting-pair',
        command: 'rescue',
        kind: 'rescue',
        phase: 'provider_decision',
        provider: 'wrong-provider',
        status: 'adopted',
        jobId: 'job-conflicting-pair',
        hostSurface: 'terminal',
      },
    ];
    await appendRunLedgerEvents(workspaceRoot, existing);

    assert.throws(
      () => ensureRunLedgerTerminalPair(workspaceRoot, existing.map((event) => ({ ...event, provider: 'qwen' }))),
      /Incomplete or conflicting terminal ledger pair/,
    );
  });
});

test('ensureRunLedgerTerminalPair rejects a descriptor mismatch in session/model attribution', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const original = [
      {
        runId: 'run-descriptor-conflict',
        command: 'rescue',
        kind: 'rescue',
        phase: 'attempt_result',
        provider: 'qwen',
        status: 'completed',
        jobId: 'job-descriptor-conflict',
        sessionId: 'session-a',
        model: 'model-a',
        attempt: { ordinal: 1 },
        hostSurface: 'terminal',
      },
      {
        runId: 'run-descriptor-conflict',
        command: 'rescue',
        kind: 'rescue',
        phase: 'provider_decision',
        provider: 'qwen',
        status: 'adopted',
        jobId: 'job-descriptor-conflict',
        sessionId: 'session-a',
        hostSurface: 'terminal',
      },
    ];
    ensureRunLedgerTerminalPair(workspaceRoot, original);
    const persisted = await readRunLedgerEvents(workspaceRoot);
    assert.ok(persisted.every((event) => event.terminalDescriptor), 'new terminal pairs persist a descriptor');

    assert.throws(
      () => ensureRunLedgerTerminalPair(workspaceRoot, original.map((event) => ({
        ...event,
        sessionId: 'session-b',
        model: event.phase === 'attempt_result' ? 'model-b' : null,
      }))),
      /Incomplete or conflicting terminal ledger pair/,
    );
  });
});

test('ensureRunLedgerTerminalPair keys background pairs by attempt identity', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const base = {
      runId: 'run-two-attempts',
      invocationId: 'inv_11111111111111111111',
      jobId: 'job-two-attempts',
      command: 'ask',
      provider: 'qwen',
      hostSurface: 'terminal',
    };
    for (const [attemptId, status, decision] of [
      ['att_11111111111111111111', 'failed', 'failed'],
      ['att_22222222222222222222', 'completed', 'adopted'],
    ]) {
      ensureRunLedgerTerminalPair(workspaceRoot, [
        { ...base, attemptId, phase: 'attempt_result', status },
        { ...base, attemptId, phase: 'provider_decision', status: decision },
      ]);
    }

    const events = await readRunLedgerEvents(workspaceRoot);
    assert.equal(events.length, 4);
    assert.deepEqual(new Set(events.map((event) => event.attemptId)), new Set([
      'att_11111111111111111111',
      'att_22222222222222222222',
    ]));
  });
});

test('background terminal descriptors keep the pre-Gate-B v1 shape while events retain attempt identity', async () => {
  const base = {
    runId: 'run-rollback-compatible',
    invocationId: 'inv_11111111111111111111',
    attemptId: 'att_22222222222222222222',
    jobId: 'job-rollback-compatible',
    command: 'ask',
    kind: 'ask',
    provider: 'qwen',
    hostSurface: 'terminal',
  };
  const pair = [
    { ...base, phase: 'attempt_result', status: 'completed' },
    { ...base, phase: 'provider_decision', status: 'adopted' },
  ];

  const descriptor = createTerminalLedgerDescriptor(pair);

  assert.deepEqual(descriptor, {
    version: 1,
    runId: 'run-rollback-compatible',
    jobId: 'job-rollback-compatible',
    events: [
      {
        phase: 'attempt_result',
        status: 'completed',
        reason: null,
        provider: 'qwen',
        command: 'ask',
        kind: 'ask',
        hostSurface: 'terminal',
        attempt: null,
        sessionId: null,
        model: null,
        defaultModel: null,
        timingRef: null,
        error: null,
        errorCode: null,
        failureClass: null,
      },
      {
        phase: 'provider_decision',
        status: 'adopted',
        reason: null,
        provider: 'qwen',
        command: 'ask',
        kind: 'ask',
        hostSurface: 'terminal',
        attempt: null,
        sessionId: null,
        model: null,
        defaultModel: null,
        timingRef: null,
        error: null,
        errorCode: null,
        failureClass: null,
      },
    ],
  });
  assert.equal(pair.every((event) => event.attemptId === 'att_22222222222222222222'), true);
});

test('ensureRunLedgerTerminalPair supports foreground invocation/attempt identity without a job', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const pair = [
      {
        runId: 'run-foreground-pair',
        invocationId: 'inv_11111111111111111111',
        attemptId: 'att_22222222222222222222',
        jobId: null,
        command: 'ask',
        provider: 'qwen',
        phase: 'attempt_result',
        status: 'completed',
      },
      {
        runId: 'run-foreground-pair',
        invocationId: 'inv_11111111111111111111',
        attemptId: 'att_22222222222222222222',
        jobId: null,
        command: 'ask',
        provider: 'qwen',
        phase: 'provider_decision',
        status: 'adopted',
      },
    ];

    const first = ensureRunLedgerTerminalPair(workspaceRoot, pair);
    const second = ensureRunLedgerTerminalPair(workspaceRoot, pair);
    assert.equal(first.length, 2);
    assert.equal(second.length, 2);
    assert.equal((await readRunLedgerEvents(workspaceRoot)).length, 2);
  });
});

test('ensureRunLedgerTerminalPair refuses conflicting foreground pair keys', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    assert.throws(() => ensureRunLedgerTerminalPair(workspaceRoot, [
      {
        runId: 'run-bad-foreground-pair',
        invocationId: 'inv_11111111111111111111',
        attemptId: 'att_11111111111111111111',
        phase: 'attempt_result',
        status: 'failed',
      },
      {
        runId: 'run-bad-foreground-pair',
        invocationId: 'inv_11111111111111111111',
        attemptId: 'att_22222222222222222222',
        phase: 'provider_decision',
        status: 'failed',
      },
    ]), /share.*identity|terminal ledger pair/i);
    assert.equal((await readRunLedgerEvents(workspaceRoot)).length, 0);
  });
});

test('ensureRunLedgerTerminalPair accepts fully legacy background identity but rejects partial v2 identity', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const partial = [
      {
        runId: 'run-partial-v2-background',
        invocationId: 'inv_11111111111111111111',
        attemptId: null,
        jobId: 'job-partial-v2-background',
        phase: 'attempt_result',
        status: 'failed',
      },
      {
        runId: 'run-partial-v2-background',
        invocationId: 'inv_11111111111111111111',
        attemptId: null,
        jobId: 'job-partial-v2-background',
        phase: 'provider_decision',
        status: 'failed',
      },
    ];

    assert.throws(
      () => ensureRunLedgerTerminalPair(workspaceRoot, partial),
      /identity|terminal ledger pair/i,
    );
    assert.equal((await readRunLedgerEvents(workspaceRoot)).length, 0);
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

test('run grouping projects only the newest explicit attempt for each provider', () => {
  const events = [
    { runId: 'run-projected', at: '2026-05-07T00:00:00.000Z', provider: 'qwen', phase: 'attempt_started', attemptId: 'att_old', status: 'started' },
    { runId: 'run-projected', at: '2026-05-07T00:00:01.000Z', provider: 'qwen', phase: 'attempt_result', attemptId: 'att_old', status: 'failed', reason: 'timeout' },
    { runId: 'run-projected', at: '2026-05-07T00:00:02.000Z', provider: 'qwen', phase: 'provider_decision', attemptId: 'att_old', status: 'failed', reason: 'timeout' },
    { runId: 'run-projected', at: '2026-05-07T00:00:03.000Z', provider: 'qwen', phase: 'attempt_started', attemptId: 'att_new', status: 'started' },
  ];

  const group = groupRunLedgerEvents(events).get('run-projected');
  assert.equal(group.events.length, 4, 'raw evidence remains available');
  assert.deepEqual(group.projectedEvents.map((event) => event.attemptId), ['att_new']);
  assert.deepEqual(summarizeRunLedger(events)[0].failureClassCounts, {});
  const explanation = buildRunExplanation(events, 'run-projected').text;
  assert.doesNotMatch(explanation, /failed|timeout/);
  assert.match(explanation, /qwen unfinished/);
});

test('run grouping selects the newest attempt by ledger order despite clock skew', () => {
  const events = [
    { runId: 'run-clock-skew', at: '2026-05-07T00:00:03.000Z', provider: 'qwen', phase: 'attempt_started', attemptId: 'att_old', status: 'started' },
    { runId: 'run-clock-skew', at: '2026-05-07T00:00:04.000Z', provider: 'qwen', phase: 'attempt_result', attemptId: 'att_old', status: 'failed' },
    { runId: 'run-clock-skew', at: '2026-05-07T00:00:01.000Z', provider: 'qwen', phase: 'attempt_started', attemptId: 'att_new', status: 'started' },
  ];

  const group = groupRunLedgerEvents(events).get('run-clock-skew');
  assert.deepEqual(group.projectedEvents.map((event) => event.attemptId), ['att_new']);
  assert.doesNotMatch(buildRunExplanation(events, 'run-clock-skew').text, /failed/);
});

test('run grouping uses jobId fallback and conservative legacy epochs', () => {
  const events = [
    { runId: 'run-fallbacks', at: '2026-05-07T00:00:00.000Z', provider: 'cmd', jobId: 'job-old', phase: 'attempt_result', status: 'failed' },
    { runId: 'run-fallbacks', at: '2026-05-07T00:00:01.000Z', provider: 'cmd', jobId: 'job-new', phase: 'attempt_started', status: 'started' },
    { runId: 'run-fallbacks', at: '2026-05-07T00:00:02.000Z', provider: 'qwen', phase: 'attempt_result', status: 'failed' },
    { runId: 'run-fallbacks', at: '2026-05-07T00:00:03.000Z', provider: 'qwen', phase: 'attempt_started', status: 'started' },
  ];

  const projected = groupRunLedgerEvents(events).get('run-fallbacks').projectedEvents;
  assert.deepEqual(projected.map((event) => [event.provider, event.jobId ?? null, event.phase]), [
    ['cmd', 'job-new', 'attempt_started'],
    ['qwen', null, 'attempt_started'],
  ]);
  const explanation = buildRunExplanation(events, 'run-fallbacks').text;
  assert.doesNotMatch(explanation, /failed/);
  assert.match(explanation, /cmd unfinished/);
  assert.match(explanation, /qwen unfinished/);
});

test('run grouping starts a new conservative epoch when the same legacy job starts after terminal evidence', () => {
  const events = [
    { runId: 'run-same-legacy-job', provider: 'qwen', jobId: 'job-reused', phase: 'attempt_started', status: 'started' },
    { runId: 'run-same-legacy-job', provider: 'qwen', jobId: 'job-reused', phase: 'attempt_result', status: 'failed', reason: 'old_failure' },
    { runId: 'run-same-legacy-job', provider: 'qwen', jobId: 'job-reused', phase: 'provider_decision', status: 'failed', reason: 'old_failure' },
    { runId: 'run-same-legacy-job', provider: 'qwen', jobId: 'job-reused', phase: 'attempt_started', status: 'started' },
  ];

  const projected = groupRunLedgerEvents(events).get('run-same-legacy-job').projectedEvents;
  assert.deepEqual(projected.map((event) => event.phase), ['attempt_started']);
  const explanation = buildRunExplanation(events, 'run-same-legacy-job').text;
  assert.match(explanation, /qwen unfinished/);
  assert.doesNotMatch(explanation, /old_failure|failed/);
});

test('run ledger redacts private absolute paths from terminal error material and descriptors', () => {
  const event = createRunLedgerEvent({
    runId: 'run-private-error',
    invocationId: 'inv_11111111111111111111',
    attemptId: 'att_22222222222222222222',
    provider: 'qwen',
    command: 'ask',
    phase: 'attempt_result',
    status: 'failed',
    error: { message: 'spawn /tmp/private-config/secret-qwen-bin ENOENT' },
  });
  assert.doesNotMatch(JSON.stringify(event), /private-config|secret-qwen-bin/);
  assert.match(event.error.message, /<path:redacted>/);
});

test('run ledger sanitizes every preview at the persistence boundary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const rawPreviews = [
      'TOKEN=foreground-preview-secret /private/foreground-preview-path',
      'PASSWORD=background-preview-secret /private/background-preview-path',
      'API_KEY=recovery-preview-secret /private/recovery-preview-path',
    ];
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-preview-foreground',
      phase: 'attempt_result',
      preview: rawPreviews[0],
    });
    await appendRunLedgerEvents(workspaceRoot, [
      {
        runId: 'run-preview-background',
        jobId: 'job-preview-background',
        phase: 'attempt_result',
        preview: rawPreviews[1],
      },
      {
        runId: 'run-preview-recovery',
        jobId: 'job-preview-recovery',
        phase: 'provider_decision',
        preview: rawPreviews[2],
      },
    ]);

    const persisted = await readFile(resolveRunLedgerFile(workspaceRoot), 'utf8');
    for (const marker of ['foreground-preview-secret', 'background-preview-secret', 'recovery-preview-secret']) {
      assert.doesNotMatch(persisted, new RegExp(marker));
    }
    assert.doesNotMatch(persisted, /private\/(?:foreground|background|recovery)-preview-path/);

    const events = await readRunLedgerEvents(workspaceRoot);
    assert.equal(events.length, 3);
    for (const event of events) {
      assert.match(event.preview, /<secret:redacted>/);
      assert.match(event.preview, /<path:redacted>/);
    }
  });
});

test('tailRunLedgerEvents returns the latest run last-N events in chronological ledger order', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await appendRunLedgerEvent(workspaceRoot, { runId: 'run-old', phase: 'run_started' });
    const latest = [];
    for (const phase of ['run_started', 'attempt_started', 'attempt_result']) {
      latest.push(await appendRunLedgerEvent(workspaceRoot, { runId: 'run-latest', phase }));
    }

    const result = await tailRunLedgerEvents(workspaceRoot, { limit: 2 });

    assert.equal(result.type, 'ledger.tail');
    assert.equal(result.runId, 'run-latest');
    assert.deepEqual(result.events.map((event) => event.eventId), latest.slice(1).map((event) => event.eventId));
    assert.deepEqual(result.cursor, {
      requested: null,
      oldest: latest[0].eventId,
      latest: latest[2].eventId,
      next: latest[2].eventId,
    });
    assert.equal(result.limited, true);
    assert.equal(result.cursorExpired, false);
    assert.equal(result.waitTimedOut, false);
  });
});

test('selectRunLedgerTail enforces the default 100 and accepted maximum 500 page sizes', () => {
  const events = Array.from({ length: 501 }, (_, index) => ({
    eventId: `evt_${String(index).padStart(3, '0')}`,
    runId: 'run-bounds',
  }));

  const defaultPage = selectRunLedgerTail(events, { runId: 'run-bounds' });
  assert.equal(defaultPage.events.length, 100);
  assert.equal(defaultPage.events[0].eventId, 'evt_401');
  assert.equal(defaultPage.limited, true);

  const maximumPage = selectRunLedgerTail(events, { runId: 'run-bounds', limit: 500 });
  assert.equal(maximumPage.events.length, 500);
  assert.equal(maximumPage.events[0].eventId, 'evt_001');
  assert.equal(maximumPage.limited, true);
});

test('tailRunLedgerEvents returns the first limited page after a valid opaque cursor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const events = [];
    for (const phase of ['run_started', 'attempt_started', 'attempt_result', 'provider_decision']) {
      events.push(await appendRunLedgerEvent(workspaceRoot, { runId: 'run-page', phase }));
    }

    const result = await tailRunLedgerEvents(workspaceRoot, {
      runId: 'run-page',
      after: events[0].eventId,
      limit: 2,
    });

    assert.deepEqual(result.events.map((event) => event.eventId), [events[1].eventId, events[2].eventId]);
    assert.equal(result.cursor.requested, events[0].eventId);
    assert.equal(result.cursor.next, events[2].eventId);
    assert.equal(result.limited, true);
  });
});

test('tailRunLedgerEvents locates an unscoped cursor before pinning its run', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const anchor = await appendRunLedgerEvent(workspaceRoot, { runId: 'run-pinned', phase: 'run_started' });
    const newer = await appendRunLedgerEvent(workspaceRoot, { runId: 'run-pinned', phase: 'run_summary' });
    await appendRunLedgerEvent(workspaceRoot, { runId: 'run-unrelated-latest', phase: 'run_started' });

    const result = await tailRunLedgerEvents(workspaceRoot, { after: anchor.eventId });

    assert.equal(result.runId, 'run-pinned');
    assert.deepEqual(result.events.map((event) => event.eventId), [newer.eventId]);
  });
});

test('tailRunLedgerEvents validates limit and wait option relationships', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await assert.rejects(
      tailRunLedgerEvents(workspaceRoot, { limit: 501 }),
      (error) => error.code === 'invalid_argument' && error.data?.argument === '--limit',
    );
    await assert.rejects(
      tailRunLedgerEvents(workspaceRoot, { limit: 0 }),
      (error) => error.code === 'invalid_argument' && error.data?.argument === '--limit',
    );
    await assert.rejects(
      tailRunLedgerEvents(workspaceRoot, { wait: true }),
      (error) => error.code === 'invalid_argument' && error.data?.argument === '--wait',
    );
    await assert.rejects(
      tailRunLedgerEvents(workspaceRoot, { timeoutMs: 10 }),
      (error) => error.code === 'invalid_argument' && error.data?.argument === '--timeout-ms',
    );
  });
});

test('tailRunLedgerEvents reports an absent selected-run cursor as cursor_expired', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const oldest = await appendRunLedgerEvent(workspaceRoot, { runId: 'run-expired', phase: 'run_started' });
    const latest = await appendRunLedgerEvent(workspaceRoot, { runId: 'run-expired', phase: 'run_summary' });
    const file = resolveRunLedgerFile(workspaceRoot);
    await writeFile(file, `{bad json}\n${await readFile(file, 'utf8')}`, 'utf8');

    await assert.rejects(
      tailRunLedgerEvents(workspaceRoot, { runId: 'run-expired', after: 'evt_not_retained' }),
      (error) => {
        assert.equal(error.code, 'cursor_expired');
        assert.deepEqual(error.data, {
          reason: 'not_retained',
          runId: 'run-expired',
          requested: 'evt_not_retained',
          oldest: oldest.eventId,
          latest: latest.eventId,
        });
        return true;
      },
    );
  });
});

test('tailRunLedgerEvents has explicit null anchors for an empty ledger', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await tailRunLedgerEvents(workspaceRoot);
    assert.deepEqual(result, {
      type: 'ledger.tail',
      runId: null,
      events: [],
      cursor: { requested: null, oldest: null, latest: null, next: null },
      limited: false,
      cursorExpired: false,
      waitTimedOut: false,
    });
  });
});

test('tailRunLedgerEvents wait wakes when a newer ledger event is appended', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const anchor = await appendRunLedgerEvent(workspaceRoot, { runId: 'run-wait', phase: 'run_started' });
    const pending = tailRunLedgerEvents(workspaceRoot, {
      runId: 'run-wait',
      after: anchor.eventId,
      wait: true,
      timeoutMs: 500,
      pollIntervalMs: 10,
    });
    const appended = new Promise((resolve) => {
      setTimeout(() => resolve(appendRunLedgerEvent(workspaceRoot, {
        runId: 'run-wait',
        phase: 'attempt_started',
      })), 25);
    });

    const [result, newer] = await Promise.all([pending, appended]);
    assert.deepEqual(result.events.map((event) => event.eventId), [newer.eventId]);
    assert.equal(result.waitTimedOut, false);
  });
});

test('tailRunLedgerEvents wait timeout is an authoritative empty page anchored at the valid cursor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const anchor = await appendRunLedgerEvent(workspaceRoot, { runId: 'run-timeout', phase: 'run_started' });

    const result = await tailRunLedgerEvents(workspaceRoot, {
      runId: 'run-timeout',
      after: anchor.eventId,
      wait: true,
      timeoutMs: 20,
      pollIntervalMs: 5,
    });

    assert.deepEqual(result.events, []);
    assert.equal(result.cursor.next, anchor.eventId);
    assert.equal(result.cursor.oldest, anchor.eventId);
    assert.equal(result.cursor.latest, anchor.eventId);
    assert.equal(result.waitTimedOut, true);
  });
});

test('tailRunLedgerEvents keeps an inferred run pinned and rejects a cursor rotated away while waiting', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const anchor = await appendRunLedgerEvent(workspaceRoot, { runId: 'run-rotated', phase: 'run_started' });
    const file = resolveRunLedgerFile(workspaceRoot);
    const pending = tailRunLedgerEvents(workspaceRoot, {
      after: anchor.eventId,
      wait: true,
      timeoutMs: 500,
      pollIntervalMs: 10,
    });
    const retained = createRunLedgerEvent({ runId: 'run-rotated', phase: 'attempt_started' });
    const unrelated = createRunLedgerEvent({ runId: 'run-new-latest', phase: 'run_started' });
    setTimeout(() => {
      const replacement = `${file}.rotation-${retained.eventId}`;
      void writeFile(replacement, `${JSON.stringify(retained)}\n${JSON.stringify(unrelated)}\n`, 'utf8')
        .then(() => rename(replacement, file));
    }, 25);

    await assert.rejects(pending, (error) => {
      assert.equal(error.code, 'cursor_expired');
      assert.deepEqual(error.data, {
        reason: 'not_retained',
        runId: 'run-rotated',
        requested: anchor.eventId,
        oldest: retained.eventId,
        latest: retained.eventId,
      });
      return true;
    });
  });
});

test('tailRunLedgerEvents never reads a raw job log referenced by a ledger event', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const rawLog = path.join(workspaceRoot, 'raw-job.log');
    await writeFile(rawLog, 'RAW_JOB_SECRET_MUST_NOT_APPEAR', 'utf8');
    await appendRunLedgerEvent(workspaceRoot, {
      runId: 'run-redacted-only',
      phase: 'attempt_result',
      preview: '<prompt:redacted>',
      logFile: rawLog,
    });

    const result = await tailRunLedgerEvents(workspaceRoot, { runId: 'run-redacted-only' });
    assert.equal(JSON.stringify(result).includes('RAW_JOB_SECRET_MUST_NOT_APPEAR'), false);
    assert.equal(result.events[0].preview, '<prompt:redacted>');
  });
});

test('tailRunLedgerEvents wait rereads events only after ledger size or mtime changes', async () => {
  const anchor = createRunLedgerEvent({ runId: 'run-observed', phase: 'run_started' });
  let reads = 0;
  let polls = 0;
  const result = await tailRunLedgerEvents('/unused', {
    runId: 'run-observed',
    after: anchor.eventId,
    wait: true,
    timeoutMs: 20,
    pollIntervalMs: 5,
  }, {
    readEvents: () => {
      reads += 1;
      return [anchor];
    },
    readFileState: async () => ({ size: 100, mtimeMs: 123 }),
    sleep: async () => {
      polls += 1;
    },
    now: (() => {
      let value = 0;
      return () => {
        value += 5;
        return value;
      };
    })(),
  });

  assert.equal(result.waitTimedOut, true);
  assert.equal(reads, 1);
  assert.ok(polls >= 1);
});

test('tailRunLedgerEvents wait defaults to a 30 second timeout with 500 millisecond polls', async () => {
  const anchor = createRunLedgerEvent({ runId: 'run-default-wait', phase: 'run_started' });
  const delays = [];
  let time = 0;

  const result = await tailRunLedgerEvents('/unused', {
    runId: 'run-default-wait',
    after: anchor.eventId,
    wait: true,
  }, {
    readEvents: () => [anchor],
    readFileState: async () => ({ size: 100, mtimeMs: 123 }),
    sleep: async (delayMs) => {
      delays.push(delayMs);
      time += delayMs;
    },
    now: () => time,
  });

  assert.equal(result.waitTimedOut, true);
  assert.equal(delays.reduce((total, delayMs) => total + delayMs, 0), 30_000);
  assert.ok(delays.every((delayMs) => delayMs === 500));
});
