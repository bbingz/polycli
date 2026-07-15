import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { appendNdjson, appendNdjsonBatch, readNdjson } from '@bbingz/polycli-utils/ndjson';
import { computeWorkspaceSlug, ensureStateDir, resolveStateDir } from './state.mjs';

const MAX_LEDGER_BYTES = 2_000_000;
const KEEP_RATIO = 0.5;
const PRIVATE_FILE_MODE = 0o600;
const RUN_ID_RE = /^[A-Za-z0-9_.-]{1,96}$/;
const SECRET_LONG_OPT_RE = /(token|secret|password|api-?key|access-?key|credential)/i;
const SECRET_ENV_KEY_RE = /(TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_KEY|CREDENTIAL)/i;
const PROMPT_COMMANDS = new Set(['ask', 'rescue', 'review', 'adversarial-review']);
const VALUE_OPTIONS = new Set([
  '--provider',
  '--model',
  '--base',
  '--scope',
  '--resume',
  '--effort',
  '--run-id',
  '--timeout-ms',
  '--history',
]);
const SHORT_VALUE_OPTIONS = new Set(['-m']);
const FOCUS_VALUE_OPTIONS = new Set(['--focus']);
const VALID_HOST_SURFACES = new Set([
  'terminal',
  'claude-plugin',
  'codex-skill',
  'copilot-skill',
  'opencode-plugin',
  'unknown',
]);
const TERMINAL_LEDGER_PHASES = new Set(['attempt_result', 'provider_decision']);

function terminalLedgerRetentionGroupKey(event) {
  if (!TERMINAL_LEDGER_PHASES.has(event?.phase) || !event.runId || !event.jobId) {
    return null;
  }
  return JSON.stringify([event.runId, event.jobId]);
}

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
    if (typeof arg === 'string' && arg.startsWith('--run-id=')) {
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
  const isPromptCommand = PROMPT_COMMANDS.has(command);
  let sawSubcommand = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== 'string') {
      redacted.push(arg);
      continue;
    }
    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        redacted.push(redactInlineValue(arg));
        continue;
      }
      redacted.push(arg);
      const hasNext = i + 1 < argv.length;
      if (!hasNext) continue;
      if (SECRET_LONG_OPT_RE.test(arg)) {
        redacted.push('<secret:redacted>');
        i += 1;
        continue;
      }
      if (FOCUS_VALUE_OPTIONS.has(arg) && (command === 'review' || command === 'adversarial-review')) {
        redacted.push('<prompt:redacted>');
        i += 1;
        continue;
      }
      if (VALUE_OPTIONS.has(arg)) {
        redacted.push(argv[i + 1]);
        i += 1;
        continue;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      redacted.push(arg);
      if (SHORT_VALUE_OPTIONS.has(arg) && i + 1 < argv.length) {
        redacted.push(argv[i + 1]);
        i += 1;
      }
      continue;
    }
    if (!sawSubcommand && command && arg === command) {
      sawSubcommand = true;
      redacted.push(arg);
      continue;
    }
    const inlineRedacted = redactInlineValue(arg);
    if (inlineRedacted !== arg) {
      redacted.push(inlineRedacted);
      continue;
    }
    if (isPromptCommand) {
      redacted.push('<prompt:redacted>');
      continue;
    }
    redacted.push(arg);
  }
  return redacted;
}

export function createRunLedgerEvent(event = {}) {
  const at = event.at || new Date().toISOString();
  const command = event.command || null;
  const commands = [...new Set(event.commands || (command ? [command] : []))]
    .filter(Boolean)
    .sort();
  return {
    version: 1,
    eventId: event.eventId || `evt_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    at,
    runId: event.runId || null,
    workspaceRoot: event.workspaceRoot || null,
    workspaceSlug: event.workspaceSlug || null,
    kind: event.kind || event.command || null,
    provider: event.provider ?? null,
    reason: event.reason ?? null,
    attempt: event.attempt ?? null,
    jobId: event.jobId ?? null,
    model: event.model ?? null,
    sessionId: event.sessionId ?? null,
    sessionArtifactPath: event.sessionArtifactPath ?? null,
    defaultModel: event.defaultModel ?? null,
    timingRef: event.timingRef ?? null,
    error: event.error ?? null,
    preview: event.preview ?? null,
    stdoutBytes: event.stdoutBytes ?? null,
    stderrBytes: event.stderrBytes ?? null,
    durationMs: event.durationMs ?? null,
    errorCode: event.errorCode ?? null,
    failureClass: event.failureClass ?? null,
    terminalDescriptor: event.terminalDescriptor ?? null,
    pid: event.pid ?? null,
    logFile: event.logFile ?? null,
    argv: event.argv || [],
    command,
    commands,
    status: event.status,
    phase: event.phase,
    hostSurface: event.hostSurface || 'unknown',
  };
}

export function appendRunLedgerEvent(workspaceRoot, event) {
  // Create the state dir privately (0o700) BEFORE the ndjson append lands. appendNdjson reaches the
  // directory via the mode-less ensureParentDir, which would otherwise create ~/.polycli/state/<slug>
  // world-traversable (0o755) on the run_started event that main() fires before any other state write.
  if (workspaceRoot) ensureStateDir(workspaceRoot);
  const file = resolveRunLedgerFile(workspaceRoot);
  const workspaceSlug = workspaceRoot ? computeWorkspaceSlug(workspaceRoot) : null;
  const full = createRunLedgerEvent({
    ...event,
    workspaceRoot: workspaceRoot ?? event.workspaceRoot ?? null,
    workspaceSlug: event.workspaceSlug ?? workspaceSlug,
  });
  appendNdjson(file, full, {
    maxBytes: MAX_LEDGER_BYTES,
    keepRatio: KEEP_RATIO,
    retentionGroupKey: terminalLedgerRetentionGroupKey,
    mode: PRIVATE_FILE_MODE,
  });
  return full;
}

export function appendRunLedgerEvents(workspaceRoot, events) {
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }
  if (events.length === 0) return [];

  // As with the single-event path, establish the private state directory before the NDJSON
  // primitive creates its parent. The underlying batch write publishes every event together.
  if (workspaceRoot) ensureStateDir(workspaceRoot);
  const file = resolveRunLedgerFile(workspaceRoot);
  const workspaceSlug = workspaceRoot ? computeWorkspaceSlug(workspaceRoot) : null;
  const full = events.map((event) => createRunLedgerEvent({
    ...event,
    workspaceRoot: workspaceRoot ?? event.workspaceRoot ?? null,
    workspaceSlug: event.workspaceSlug ?? workspaceSlug,
  }));
  appendNdjsonBatch(file, full, {
    maxBytes: MAX_LEDGER_BYTES,
    keepRatio: KEEP_RATIO,
    retentionGroupKey: terminalLedgerRetentionGroupKey,
    mode: PRIVATE_FILE_MODE,
  });
  return full;
}

function canonicalTerminalValue(value) {
  if (value == null || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => canonicalTerminalValue(entry));
  return Object.fromEntries(Object.keys(value)
    .sort()
    .map((key) => [key, canonicalTerminalValue(value[key])]));
}

function terminalEventMaterial(event) {
  return {
    phase: event.phase ?? null,
    status: event.status ?? null,
    reason: event.reason ?? null,
    provider: event.provider ?? null,
    command: event.command ?? null,
    kind: event.kind ?? null,
    hostSurface: event.hostSurface || 'unknown',
    attempt: canonicalTerminalValue(event.attempt),
    sessionId: event.sessionId ?? null,
    model: event.model ?? null,
    defaultModel: event.defaultModel ?? null,
    timingRef: canonicalTerminalValue(event.timingRef),
    error: canonicalTerminalValue(event.error),
    errorCode: event.errorCode ?? null,
    failureClass: event.failureClass ?? null,
  };
}

function stableTerminalJson(value) {
  return JSON.stringify(canonicalTerminalValue(value));
}

function validateTerminalPair(events) {
  if (!Array.isArray(events) || events.length !== 2) {
    throw new TypeError('terminal ledger pair must contain exactly two events');
  }
  const [first] = events;
  const runId = first?.runId;
  const jobId = first?.jobId;
  if (!runId || !jobId
    || events.some((event) => event?.runId !== runId || event?.jobId !== jobId || !TERMINAL_LEDGER_PHASES.has(event?.phase))
    || new Set(events.map((event) => event.phase)).size !== TERMINAL_LEDGER_PHASES.size) {
    throw new TypeError('terminal ledger pair must share runId/jobId and contain attempt_result plus provider_decision');
  }
  return { runId, jobId };
}

// A terminal descriptor is the immutable identity of the terminal intent. It deliberately
// excludes publication-specific fields (eventId, timestamp, workspace location, preview bytes,
// log path, and artifact realpath), while retaining the result attribution that recovery must not
// silently rewrite.
export function createTerminalLedgerDescriptor(events) {
  const { runId, jobId } = validateTerminalPair(events);
  return {
    version: 1,
    runId,
    jobId,
    events: events
      .map((event) => terminalEventMaterial(event))
      .sort((left, right) => left.phase.localeCompare(right.phase)),
  };
}

function descriptorsMatch(left, right) {
  return stableTerminalJson(left) === stableTerminalJson(right);
}

function legacyTerminalEventMatches(existing, expected) {
  const actual = terminalEventMaterial(existing);
  const wanted = terminalEventMaterial(expected);
  for (const key of ['phase', 'status', 'reason', 'provider', 'command', 'kind', 'hostSurface']) {
    if (actual[key] !== wanted[key]) return false;
  }
  // Before descriptors existed, a null attribution field meant "not recorded", not a claim that
  // the value was null. Preserve compatibility with those old records while still refusing any
  // concrete, contradictory session/model/attempt/timing/error value.
  for (const key of ['attempt', 'sessionId', 'model', 'defaultModel', 'timingRef', 'error', 'errorCode', 'failureClass']) {
    if (actual[key] != null && stableTerminalJson(actual[key]) !== stableTerminalJson(wanted[key])) {
      return false;
    }
  }
  return true;
}

function terminalEventMatches(existing, expected) {
  if (existing.phase !== expected.phase) return false;
  if (existing.terminalDescriptor != null) {
    return descriptorsMatch(existing.terminalDescriptor, expected.terminalDescriptor);
  }
  return legacyTerminalEventMatches(existing, expected);
}

function terminalPairMatches(existing, expected) {
  if (existing.length !== expected.length
    || new Set(existing.map((event) => event.phase)).size !== TERMINAL_LEDGER_PHASES.size) {
    return false;
  }
  const descriptorCount = existing.filter((event) => event.terminalDescriptor != null).length;
  if (descriptorCount !== 0 && descriptorCount !== existing.length) return false;
  return expected.every((expectedEvent) => existing.some((event) => terminalEventMatches(event, expectedEvent)));
}

function buildExpectedTerminalPair(events) {
  const rawExpected = events.map((event) => createRunLedgerEvent(event));
  const descriptor = createTerminalLedgerDescriptor(rawExpected);
  const supplied = rawExpected
    .map((event) => event.terminalDescriptor)
    .filter((value) => value != null);
  if (supplied.length > 0
    && (supplied.length !== rawExpected.length
      || supplied.some((value) => !descriptorsMatch(value, descriptor)))) {
    throw new Error('Terminal ledger descriptor does not match the terminal event pair');
  }
  return {
    descriptor,
    expected: rawExpected.map((event) => ({ ...event, terminalDescriptor: descriptor })),
  };
}

export function ensureRunLedgerTerminalPair(workspaceRoot, events) {
  if (!Array.isArray(events) || events.length !== 2) {
    throw new TypeError('terminal ledger pair must contain exactly two events');
  }
  const { expected, descriptor } = buildExpectedTerminalPair(events);
  const { runId, jobId } = validateTerminalPair(expected);

  const existing = readRunLedgerEvents(workspaceRoot)
    .filter((event) => event.runId === runId
      && event.jobId === jobId
      && TERMINAL_LEDGER_PHASES.has(event.phase));
  if (existing.length === 0) {
    return appendRunLedgerEvents(workspaceRoot, expected);
  }
  if (existing.length === 1) {
    const [partial] = existing;
    const matchingExpected = expected.find((event) => event.phase === partial.phase);
    if (!matchingExpected || !terminalEventMatches(partial, matchingExpected)) {
      throw new Error(`Incomplete or conflicting terminal ledger pair for job ${jobId}`);
    }
    const missing = expected.find((event) => event.phase !== partial.phase);
    // A legacy partial record has no descriptor to attest. It can still be safely completed only
    // when its full material matches; preserve its legacy shape so future retries use the same
    // compatibility matcher. Descriptor-bearing partials retain the exact descriptor.
    const repair = partial.terminalDescriptor == null
      ? { ...missing, terminalDescriptor: null }
      : { ...missing, terminalDescriptor: descriptor };
    return [...existing, ...appendRunLedgerEvents(workspaceRoot, [repair])];
  }
  if (!terminalPairMatches(existing, expected)) {
    throw new Error(`Incomplete or conflicting terminal ledger pair for job ${jobId}`);
  }
  return existing;
}

export function readRunLedgerEvents(workspaceRoot) {
  const file = resolveRunLedgerFile(workspaceRoot);
  return readNdjson(file);
}

export function groupRunLedgerEvents(events) {
  const groups = new Map();
  for (const event of events) {
    if (!event?.runId) continue;
    const group = groups.get(event.runId) || { runId: event.runId, commands: [], events: [] };
    group.events.push(event);
    group.commands = [
      ...new Set([...group.commands, ...(event.commands || []), event.command].filter(Boolean)),
    ].sort();
    groups.set(event.runId, group);
  }
  for (const group of groups.values()) {
    group.events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return groups;
}

function incrementCount(counts, key) {
  if (!key) return;
  counts[key] = (counts[key] || 0) + 1;
}

export function classifyRunFailure(event = {}) {
  if (event.failureClass) return event.failureClass;
  if (event.errorCode) return event.errorCode;
  if (event.status !== 'failed' && event.status !== 'cancelled' && !event.error) return null;
  const error = typeof event.error === 'string'
    ? event.error
    : String(event.error?.message ?? event.error ?? '');
  const text = [
    event.provider,
    event.reason,
    error,
    event.preview,
  ]
    .filter(Boolean)
    .join('\n');

  if (/\bmaximum session turn\b|\bmax(?:imum)? session turns?\b/i.test(text)) {
    return 'qwen_max_session_turns';
  }
  if (/\bspawn\b.*\bENOENT\b|\bENOENT\b|\bnot found\b/i.test(text)) {
    return 'binary_missing';
  }
  if (/\b(timed out|timeout)\b/i.test(text)) {
    return 'timeout';
  }
  if (/\b(terminated|SIGTERM|exit(?:ed)? with code 143)\b/i.test(text)) {
    return 'terminated';
  }
  if (/\b(interrupted|SIGINT|aborted|cancelled|canceled|exit(?:ed)? with code 130)\b/i.test(text)) {
    return 'cancelled';
  }
  if (/\b(no visible text|produced no visible text)\b/i.test(text)) {
    return 'no_visible_text';
  }
  if (/\b(auth|authenticated|login|credential)\b/i.test(text)) {
    return 'auth';
  }
  const exitCodeMatch = text.match(/\bexit(?:ed)? with code (\d+)\b/i);
  if (exitCodeMatch) {
    return `exit_code_${exitCodeMatch[1]}`;
  }
  return event.reason || 'unclassified_failure';
}

export function summarizeRunLedger(events) {
  return [...groupRunLedgerEvents(events).values()].map((group) => {
    const decisions = group.events.filter(
      (event) => event.phase === 'provider_decision' && event.provider,
    );
    const failureClassCounts = {};
    for (const event of group.events) {
      if (event.phase !== 'attempt_result') continue;
      incrementCount(failureClassCounts, classifyRunFailure(event));
    }
    return {
      runId: group.runId,
      commands: group.commands,
      startedAt: group.events[0]?.at || null,
      updatedAt: group.events.at(-1)?.at || null,
      providerCount: new Set(decisions.map((event) => event.provider)).size,
      adoptedCount: decisions.filter((event) => event.status === 'adopted').length,
      skippedCount: decisions.filter((event) => event.status === 'skipped').length,
      failedCount: decisions.filter((event) => event.status === 'failed').length,
      failureClassCounts,
    };
  });
}

export function buildRunExplanation(events, runId) {
  const group = groupRunLedgerEvents(events).get(runId);
  if (!group) {
    return { runId, found: false, text: `Run ${runId} was not found.`, events: [] };
  }
  const decisions = group.events.filter((event) => event.phase === 'provider_decision');
  const lines = decisions.map(
    (event) => `${event.provider || 'run'} ${event.status}${event.reason ? ` (${event.reason})` : ''}`,
  );
  for (const event of group.events.filter((item) => item.phase === 'attempt_result' && item.status === 'failed')) {
    const subject = event.provider || event.jobId || 'run';
    lines.push(`attempt ${subject} failed (${classifyRunFailure(event)})`);
  }
  return { runId, found: true, text: lines.join('\n'), events: group.events };
}
