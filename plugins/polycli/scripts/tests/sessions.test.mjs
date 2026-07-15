import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';

import {
  collectRecordedArtifacts,
  deriveSessionArtifactCandidate,
  executePurge,
  planPurge,
  recordArtifactPath,
} from '../lib/sessions.mjs';

const HOME = '/home/tester';
const CWD = '/Users/tester/-Code-/polycli';
const SID = '01555281-0f41-48d9-bd9c-775a19ed3cda';

// ---- deriveSessionArtifactCandidate ----

test('deriveSessionArtifactCandidate (claude) → one exact <encoded-cwd>/<sessionId>.jsonl path', () => {
  const candidate = deriveSessionArtifactCandidate({
    provider: 'claude',
    sessionId: SID,
    workspaceRoot: CWD,
    homedir: HOME,
  });
  const expected = path.join(
    HOME,
    '.claude',
    'projects',
    CWD.replaceAll('/', '-'),
    `${SID}.jsonl`,
  );
  assert.equal(candidate.path, expected);
  assert.equal(candidate.kind, 'file');
});

test('deriveSessionArtifactCandidate (kimi) → kimi-code wd_<base>_<sha256[:12]>/<sessionId> dir, basename==sessionId', () => {
  const candidate = deriveSessionArtifactCandidate({
    provider: 'kimi',
    sessionId: SID,
    workspaceRoot: CWD,
    homedir: HOME,
  });
  // CWD does not exist on disk in the test, so the derivation falls back to the given path.
  const slug = `wd_${path.basename(CWD)}_${createHash('sha256').update(CWD).digest('hex').slice(0, 12)}`;
  const expected = path.join(HOME, '.kimi-code', 'sessions', slug, SID);
  assert.equal(candidate.path, expected);
  assert.equal(path.basename(candidate.path), SID);
  assert.equal(candidate.kind, 'dir');
});

test('deriveSessionArtifactCandidate (pi) → null+reason (timestamp-prefixed file cannot be derived without scan, NO glob)', () => {
  const candidate = deriveSessionArtifactCandidate({
    provider: 'pi',
    sessionId: SID,
    workspaceRoot: CWD,
    homedir: HOME,
  });
  assert.equal(candidate.path, null);
  assert.equal(typeof candidate.reason, 'string');
  // never emit a glob/wildcard
  assert.ok(!/[*?]/.test(candidate.reason));
});

test('deriveSessionArtifactCandidate returns null+reason for gemini/codex/minimax/cmd (no glob in output)', () => {
  for (const provider of ['gemini', 'codex', 'minimax', 'cmd']) {
    const candidate = deriveSessionArtifactCandidate({
      provider,
      sessionId: SID,
      workspaceRoot: CWD,
      homedir: HOME,
    });
    assert.equal(candidate.path, null, `${provider} must not derive a path`);
    assert.equal(typeof candidate.reason, 'string', `${provider} must give a reason`);
  }
});

test('deriveSessionArtifactCandidate returns null when sessionId is missing', () => {
  const candidate = deriveSessionArtifactCandidate({
    provider: 'claude',
    sessionId: null,
    workspaceRoot: CWD,
    homedir: HOME,
  });
  assert.equal(candidate.path, null);
  assert.equal(typeof candidate.reason, 'string');
});

// ---- recordArtifactPath ----

function fsStubs({ files = {}, links = new Set(), realpaths = {} } = {}) {
  return {
    existsFn: (p) => Object.prototype.hasOwnProperty.call(files, p) || links.has(p),
    lstatFn: (p) => ({ isSymbolicLink: () => links.has(p) }),
    realpathFn: (p) => realpaths[p] ?? p,
  };
}

test('recordArtifactPath returns the realpath for a real file under the store root', () => {
  const candidate = deriveSessionArtifactCandidate({
    provider: 'claude',
    sessionId: SID,
    workspaceRoot: CWD,
    homedir: HOME,
  });
  const verified = recordArtifactPath(candidate, {
    homedir: HOME,
    ...fsStubs({ files: { [candidate.path]: true } }),
  });
  assert.equal(verified, candidate.path);
});

test('recordArtifactPath returns null for a symlink (lstat reject)', () => {
  const candidate = deriveSessionArtifactCandidate({
    provider: 'claude',
    sessionId: SID,
    workspaceRoot: CWD,
    homedir: HOME,
  });
  const verified = recordArtifactPath(candidate, {
    homedir: HOME,
    ...fsStubs({ files: { [candidate.path]: true }, links: new Set([candidate.path]) }),
  });
  assert.equal(verified, null);
});

test('recordArtifactPath returns null when realpath escapes the store root', () => {
  const candidate = deriveSessionArtifactCandidate({
    provider: 'claude',
    sessionId: SID,
    workspaceRoot: CWD,
    homedir: HOME,
  });
  const escaped = '/tmp/evil/loot.jsonl';
  const verified = recordArtifactPath(candidate, {
    homedir: HOME,
    ...fsStubs({
      files: { [candidate.path]: true },
      realpaths: { [candidate.path]: escaped },
    }),
  });
  assert.equal(verified, null);
});

test('recordArtifactPath returns null for a missing file', () => {
  const candidate = deriveSessionArtifactCandidate({
    provider: 'claude',
    sessionId: SID,
    workspaceRoot: CWD,
    homedir: HOME,
  });
  const verified = recordArtifactPath(candidate, {
    homedir: HOME,
    ...fsStubs({ files: {} }),
  });
  assert.equal(verified, null);
});

test('recordArtifactPath returns null for a null candidate', () => {
  const verified = recordArtifactPath(
    { path: null, reason: 'unsupported' },
    { homedir: HOME, ...fsStubs() },
  );
  assert.equal(verified, null);
});

// ---- collectRecordedArtifacts ----

test('collectRecordedArtifacts keeps distinct non-null sessionArtifactPath rows', () => {
  const claudePath = path.join(HOME, '.claude', 'projects', CWD.replaceAll('/', '-'), `${SID}.jsonl`);
  const events = [
    { provider: 'claude', sessionId: SID, sessionArtifactPath: claudePath, workspaceRoot: CWD },
    { provider: 'claude', sessionId: SID, sessionArtifactPath: claudePath, workspaceRoot: CWD },
    { provider: 'gemini', sessionId: 'g1', sessionArtifactPath: null, workspaceRoot: CWD },
    { provider: 'claude', sessionId: null, sessionArtifactPath: null, workspaceRoot: CWD },
  ];
  const recorded = collectRecordedArtifacts(events);
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    provider: 'claude',
    providerSessionId: SID,
    sessionId: SID,
    sessionArtifactPath: claudePath,
    workspaceRoot: CWD,
  });
});

test('session collection uses explicit providerSessionId and only falls back for legacy events', () => {
  const recorded = collectRecordedArtifacts([
    {
      version: 2,
      provider: 'claude',
      providerSessionId: 'provider-v2',
      sessionId: 'ambiguous-legacy-alias',
      sessionArtifactPath: '/tmp/provider-v2.jsonl',
      workspaceRoot: CWD,
    },
    {
      version: 2,
      provider: 'claude',
      providerSessionId: null,
      sessionId: 'must-not-fallback',
      sessionArtifactPath: '/tmp/must-not-fallback.jsonl',
      workspaceRoot: CWD,
    },
    {
      version: 1,
      provider: 'claude',
      sessionId: 'provider-v1',
      sessionArtifactPath: '/tmp/provider-v1.jsonl',
      workspaceRoot: CWD,
    },
  ]);

  assert.deepEqual(recorded.map((entry) => entry.providerSessionId), ['provider-v2', 'provider-v1']);
  assert.deepEqual(recorded.map((entry) => entry.sessionId), ['provider-v2', 'provider-v1']);
});

test('planPurge validates basename against providerSessionId instead of a conflicting legacy alias', () => {
  const providerSessionId = 'provider-explicit';
  const artifact = path.join(HOME, '.claude', 'projects', '-work-repo', `${providerSessionId}.jsonl`);
  const plan = planPurge({
    recorded: [{
      provider: 'claude',
      providerSessionId,
      sessionId: 'host-or-stale-alias',
      sessionArtifactPath: artifact,
      workspaceRoot: CWD,
    }],
    homedir: HOME,
    ...fsStubs({ files: { [artifact]: true } }),
  });

  assert.equal(plan.deletable.length, 1);
  assert.equal(plan.deletable[0].providerSessionId, providerSessionId);
});

// ---- planPurge ----

function claudeRecorded(sessionId = SID) {
  return {
    provider: 'claude',
    sessionId,
    sessionArtifactPath: path.join(
      HOME,
      '.claude',
      'projects',
      CWD.replaceAll('/', '-'),
      `${sessionId}.jsonl`,
    ),
    workspaceRoot: CWD,
  };
}

test('planPurge includes a recorded path passing all rails', () => {
  const rec = claudeRecorded();
  const plan = planPurge({
    recorded: [rec],
    homedir: HOME,
    ...fsStubs({ files: { [rec.sessionArtifactPath]: true } }),
    sizeFn: () => 42,
  });
  assert.equal(plan.deletable.length, 1);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.deletable[0].path, rec.sessionArtifactPath);
  assert.equal(plan.deletable[0].provider, 'claude');
  assert.equal(plan.deletable[0].sessionId, SID);
  assert.equal(plan.deletable[0].bytes, 42);
});

test('planPurge EXCLUDES a symlinked path', () => {
  const rec = claudeRecorded();
  const plan = planPurge({
    recorded: [rec],
    homedir: HOME,
    ...fsStubs({ files: { [rec.sessionArtifactPath]: true }, links: new Set([rec.sessionArtifactPath]) }),
  });
  assert.equal(plan.deletable.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /symlink/i);
});

test('planPurge EXCLUDES a path whose realpath escaped the store root', () => {
  const rec = claudeRecorded();
  const plan = planPurge({
    recorded: [rec],
    homedir: HOME,
    ...fsStubs({
      files: { [rec.sessionArtifactPath]: true },
      realpaths: { [rec.sessionArtifactPath]: '/tmp/evil/loot.jsonl' },
    }),
  });
  assert.equal(plan.deletable.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /store root|escape/i);
});

test('planPurge EXCLUDES a basename that no longer matches the sessionId', () => {
  const rec = claudeRecorded();
  // record path on disk now resolves to a file whose basename differs from sessionId
  const mismatched = path.join(path.dirname(rec.sessionArtifactPath), 'other-session.jsonl');
  const plan = planPurge({
    recorded: [{ ...rec, sessionArtifactPath: mismatched }],
    homedir: HOME,
    ...fsStubs({ files: { [mismatched]: true } }),
  });
  assert.equal(plan.deletable.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /basename|sessionId|match/i);
});

test('planPurge EXCLUDES an event with sessionArtifactPath:null', () => {
  const plan = planPurge({
    recorded: [{ provider: 'gemini', sessionId: 'g1', sessionArtifactPath: null, workspaceRoot: CWD }],
    homedir: HOME,
    ...fsStubs(),
  });
  assert.equal(plan.deletable.length, 0);
  assert.equal(plan.skipped.length, 1);
});

test('planPurge EXCLUDES a missing path', () => {
  const rec = claudeRecorded();
  const plan = planPurge({
    recorded: [rec],
    homedir: HOME,
    ...fsStubs({ files: {} }),
  });
  assert.equal(plan.deletable.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /exist|missing|gone/i);
});

test('planPurge validates kimi dir basename equals sessionId', () => {
  const rec = {
    provider: 'kimi',
    sessionId: SID,
    sessionArtifactPath: path.join(
      HOME,
      '.kimi-code',
      'sessions',
      `wd_${path.basename(CWD)}_${createHash('sha256').update(CWD).digest('hex').slice(0, 12)}`,
      SID,
    ),
    workspaceRoot: CWD,
  };
  const plan = planPurge({
    recorded: [rec],
    homedir: HOME,
    ...fsStubs({ files: { [rec.sessionArtifactPath]: true } }),
    sizeFn: () => 7,
  });
  assert.equal(plan.deletable.length, 1);
  assert.equal(plan.deletable[0].provider, 'kimi');
});

// ---- executePurge ----

test('executePurge confirm:false → rmFn NEVER called (dry-run)', () => {
  const rec = claudeRecorded();
  const plan = planPurge({
    recorded: [rec],
    homedir: HOME,
    ...fsStubs({ files: { [rec.sessionArtifactPath]: true } }),
  });
  const calls = [];
  const summary = executePurge(plan, { confirm: false, rmFn: (p) => calls.push(p) });
  assert.equal(calls.length, 0);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.wouldDelete, 1);
  assert.equal(summary.confirmed, false);
});

test('executePurge confirm:true → rmFn called exactly for the deletable set', () => {
  const recs = [claudeRecorded('11111111-1111-4111-8111-111111111111'), claudeRecorded('22222222-2222-4222-8222-222222222222')];
  const files = {};
  for (const r of recs) files[r.sessionArtifactPath] = true;
  const plan = planPurge({ recorded: recs, homedir: HOME, ...fsStubs({ files }) });
  const calls = [];
  const summary = executePurge(plan, { confirm: true, rmFn: (p) => calls.push(p) });
  assert.equal(plan.deletable.length, 2);
  assert.deepEqual(calls.sort(), plan.deletable.map((d) => d.path).sort());
  assert.equal(summary.deleted, 2);
  assert.equal(summary.confirmed, true);
});
