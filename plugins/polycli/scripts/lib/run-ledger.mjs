import { randomUUID } from 'node:crypto';
import { stat as fsStat } from 'node:fs/promises';
import path from 'node:path';

import { appendNdjson, appendNdjsonBatch, readNdjson } from '@bbingz/polycli-utils/ndjson';
import { sanitizePublicErrorMessage } from './cli-contract.mjs';
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
const DEFAULT_LEDGER_TAIL_LIMIT = 100;
const MAX_LEDGER_TAIL_LIMIT = 500;
const DEFAULT_LEDGER_WAIT_TIMEOUT_MS = 30_000;
const LEDGER_WAIT_POLL_INTERVAL_MS = 500;

function terminalLedgerRetentionGroupKey(event) {
  if (!TERMINAL_LEDGER_PHASES.has(event?.phase)) return null;
  const identity = terminalPairIdentity(event);
  return identity ? JSON.stringify(identity.key) : null;
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
  let passthrough = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (passthrough) {
      next.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      next.push(arg);
      continue;
    }
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

function redactLedgerError(error) {
  if (error == null) return null;
  const message = typeof error === 'string' ? error : error.message;
  if (message == null || message === '') return null;
  return { message: sanitizePublicErrorMessage(message, 300) };
}

function sanitizeLedgerPreview(preview) {
  if (preview == null) return null;
  const text = String(preview);
  return sanitizePublicErrorMessage(text, text.length);
}

function redactTerminalDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return descriptor ?? null;
  return {
    ...descriptor,
    events: Array.isArray(descriptor.events)
      ? descriptor.events.map((event) => ({
        ...event,
        error: redactLedgerError(event.error),
        ...(Object.prototype.hasOwnProperty.call(event, 'preview')
          ? { preview: sanitizeLedgerPreview(event.preview) }
          : {}),
      }))
      : descriptor.events,
  };
}

export function createRunLedgerEvent(event = {}) {
  const at = event.at || new Date().toISOString();
  const command = event.command || null;
  const commands = [...new Set(event.commands || (command ? [command] : []))]
    .filter(Boolean)
    .sort();
  const providerSessionId = Object.prototype.hasOwnProperty.call(event, 'providerSessionId')
    ? (event.providerSessionId ?? null)
    : (event.sessionId ?? null);
  return {
    version: 2,
    eventId: event.eventId || `evt_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    at,
    runId: event.runId || null,
    workspaceRoot: event.workspaceRoot || null,
    workspaceSlug: event.workspaceSlug || null,
    kind: event.kind || event.command || null,
    provider: event.provider ?? null,
    reason: event.reason ?? null,
    attempt: event.attempt ?? null,
    invocationId: event.invocationId ?? null,
    jobId: event.jobId ?? null,
    attemptId: event.attemptId ?? null,
    model: event.model ?? null,
    sessionId: providerSessionId,
    sessionArtifactPath: event.sessionArtifactPath ?? null,
    defaultModel: event.defaultModel ?? null,
    providerSessionId,
    timingRef: event.timingRef ?? null,
    error: redactLedgerError(event.error),
    preview: sanitizeLedgerPreview(event.preview),
    stdoutBytes: event.stdoutBytes ?? null,
    stderrBytes: event.stderrBytes ?? null,
    durationMs: event.durationMs ?? null,
    errorCode: event.errorCode ?? null,
    failureClass: event.failureClass ?? null,
    terminalDescriptor: redactTerminalDescriptor(event.terminalDescriptor),
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

export function appendRunLedgerEvents(workspaceRoot, events, lockOptions = {}) {
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
    ...lockOptions,
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
  const providerSessionId = event.providerSessionId ?? event.sessionId ?? null;
  return {
    phase: event.phase ?? null,
    status: event.status ?? null,
    reason: event.reason ?? null,
    provider: event.provider ?? null,
    command: event.command ?? null,
    kind: event.kind ?? null,
    hostSurface: event.hostSurface || 'unknown',
    attempt: canonicalTerminalValue(event.attempt),
    invocationId: event.invocationId ?? null,
    attemptId: event.attemptId ?? null,
    providerSessionId,
    sessionId: providerSessionId,
    model: event.model ?? null,
    defaultModel: event.defaultModel ?? null,
    timingRef: canonicalTerminalValue(event.timingRef),
    error: canonicalTerminalValue(redactLedgerError(event.error)),
    errorCode: event.errorCode ?? null,
    failureClass: event.failureClass ?? null,
  };
}

function legacyTerminalEventMaterial(event) {
  const material = terminalEventMaterial(event);
  return {
    phase: material.phase,
    status: material.status,
    reason: material.reason,
    provider: material.provider,
    command: material.command,
    kind: material.kind,
    hostSurface: material.hostSurface,
    attempt: material.attempt,
    sessionId: material.sessionId,
    model: material.model,
    defaultModel: material.defaultModel,
    timingRef: material.timingRef,
    error: material.error,
    errorCode: material.errorCode,
    failureClass: material.failureClass,
  };
}

function stableTerminalJson(value) {
  return JSON.stringify(canonicalTerminalValue(value));
}

function terminalPairIdentity(event) {
  if (!event?.runId) return null;
  if (event.jobId) {
    const hasInvocationId = Boolean(event.invocationId);
    const hasAttemptId = Boolean(event.attemptId);
    if (hasInvocationId !== hasAttemptId) return null;
    return {
      kind: 'job',
      runId: event.runId,
      jobId: event.jobId,
      invocationId: event.invocationId ?? null,
      attemptId: event.attemptId ?? null,
      key: ['job', event.runId, event.jobId, event.attemptId ?? null],
    };
  }
  if (event.invocationId && event.attemptId) {
    return {
      kind: 'attempt',
      runId: event.runId,
      jobId: null,
      invocationId: event.invocationId,
      attemptId: event.attemptId,
      key: ['attempt', event.runId, event.invocationId, event.attemptId],
    };
  }
  return null;
}

function validateTerminalPair(events) {
  if (!Array.isArray(events) || events.length !== 2) {
    throw new TypeError('terminal ledger pair must contain exactly two events');
  }
  const identity = terminalPairIdentity(events[0]);
  const identityJson = identity ? JSON.stringify(identity.key) : null;
  if (!identity
    || events.some((event) => JSON.stringify(terminalPairIdentity(event)?.key ?? null) !== identityJson
      || !TERMINAL_LEDGER_PHASES.has(event?.phase))
    || new Set(events.map((event) => event.phase)).size !== TERMINAL_LEDGER_PHASES.size) {
    throw new TypeError('terminal ledger pair must share its run/job/attempt identity and contain attempt_result plus provider_decision');
  }
  return identity;
}

// A terminal descriptor is the immutable identity of the terminal intent. It deliberately
// excludes publication-specific fields (eventId, timestamp, workspace location, preview bytes,
// log path, and artifact realpath), while retaining the result attribution that recovery must not
// silently rewrite.
function createV2TerminalLedgerDescriptor(events, identity = validateTerminalPair(events)) {
  return {
    version: 2,
    identityKey: identity.key,
    runId: identity.runId,
    jobId: identity.jobId,
    invocationId: identity.invocationId,
    attemptId: identity.attemptId,
    events: events
      .map((event) => terminalEventMaterial(event))
      .sort((left, right) => left.phase.localeCompare(right.phase)),
  };
}

export function createTerminalLedgerDescriptor(events) {
  const identity = validateTerminalPair(events);
  return identity.kind === 'job'
    ? createLegacyTerminalLedgerDescriptor(events)
    : createV2TerminalLedgerDescriptor(events, identity);
}

function createLegacyTerminalLedgerDescriptor(events) {
  const identity = validateTerminalPair(events);
  if (identity.kind !== 'job') return null;
  return {
    version: 1,
    runId: identity.runId,
    jobId: identity.jobId,
    events: events
      .map((event) => legacyTerminalEventMaterial(event))
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
  for (const key of ['attempt', 'invocationId', 'attemptId', 'providerSessionId', 'sessionId', 'model', 'defaultModel', 'timingRef', 'error', 'errorCode', 'failureClass']) {
    if (actual[key] != null && stableTerminalJson(actual[key]) !== stableTerminalJson(wanted[key])) {
      return false;
    }
  }
  return true;
}

function terminalEventMatches(existing, expected) {
  if (existing.phase !== expected.phase) return false;
  if (existing.terminalDescriptor != null) {
    if (existing.terminalDescriptor.version === 1) {
      return legacyTerminalEventMatches(existing, expected);
    }
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
  if (descriptorCount === existing.length && existing[0].terminalDescriptor?.version === 1) {
    const legacyDescriptor = createLegacyTerminalLedgerDescriptor(expected);
    if (!legacyDescriptor || existing.some((event) => !descriptorsMatch(event.terminalDescriptor, legacyDescriptor))) {
      return false;
    }
  }
  return expected.every((expectedEvent) => existing.some((event) => terminalEventMatches(event, expectedEvent)));
}

function buildExpectedTerminalPair(events) {
  const rawExpected = events.map((event) => createRunLedgerEvent(event));
  const currentDescriptor = createTerminalLedgerDescriptor(rawExpected);
  const supplied = rawExpected
    .map((event) => event.terminalDescriptor)
    .filter((value) => value != null);
  let descriptor = currentDescriptor;
  if (supplied.length > 0) {
    if (supplied.length !== rawExpected.length) {
      throw new Error('Terminal ledger descriptor does not match the terminal event pair');
    }
    if (supplied.every((value) => value?.version === 1)) {
      const legacyDescriptor = createLegacyTerminalLedgerDescriptor(rawExpected);
      if (!legacyDescriptor || supplied.some((value) => !descriptorsMatch(value, legacyDescriptor))) {
        throw new Error('Terminal ledger descriptor does not match the terminal event pair');
      }
      descriptor = supplied[0];
    } else {
      const v2Descriptor = createV2TerminalLedgerDescriptor(rawExpected);
      if (supplied.some((value) => !descriptorsMatch(value, v2Descriptor))) {
        throw new Error('Terminal ledger descriptor does not match the terminal event pair');
      }
      descriptor = supplied[0];
    }
  }
  return {
    descriptor,
    expected: rawExpected.map((event) => ({ ...event, terminalDescriptor: descriptor })),
  };
}

export function ensureRunLedgerTerminalPair(workspaceRoot, events, { lockOptions = {} } = {}) {
  if (!Array.isArray(events) || events.length !== 2) {
    throw new TypeError('terminal ledger pair must contain exactly two events');
  }
  const { expected, descriptor } = buildExpectedTerminalPair(events);
  const identity = validateTerminalPair(expected);
  const identityJson = JSON.stringify(identity.key);
  const identityLabel = identity.kind === 'job' ? `job ${identity.jobId}` : `attempt ${identity.attemptId}`;

  const terminalEvents = readRunLedgerEvents(workspaceRoot)
    .filter((event) => TERMINAL_LEDGER_PHASES.has(event.phase));
  const existing = terminalEvents
    .filter((event) => {
      return JSON.stringify(terminalPairIdentity(event)?.key ?? null) === identityJson;
    });
  const ambiguousLegacy = identity.kind === 'job' && identity.attemptId != null
    ? terminalEvents.filter((event) => event.runId === identity.runId
      && event.jobId === identity.jobId
      && event.invocationId == null
      && event.attemptId == null)
    : [];
  if (existing.length === 0) {
    if (ambiguousLegacy.length > 0) {
      throw new Error(`Incomplete or conflicting terminal ledger pair for ${identityLabel}`);
    }
    return appendRunLedgerEvents(workspaceRoot, expected, lockOptions);
  }
  if (existing.length === 1) {
    const [partial] = existing;
    const matchingExpected = expected.find((event) => event.phase === partial.phase);
    if (!matchingExpected || !terminalEventMatches(partial, matchingExpected)) {
      throw new Error(`Incomplete or conflicting terminal ledger pair for ${identityLabel}`);
    }
    const missing = expected.find((event) => event.phase !== partial.phase);
    // A legacy partial record has no descriptor to attest. It can still be safely completed only
    // when its full material matches; preserve its legacy shape so future retries use the same
    // compatibility matcher. Descriptor-bearing partials retain the exact descriptor.
    let repairDescriptor = descriptor;
    if (partial.terminalDescriptor == null) {
      repairDescriptor = null;
    } else if (partial.terminalDescriptor.version === 1) {
      const legacyDescriptor = createLegacyTerminalLedgerDescriptor(expected);
      if (!legacyDescriptor || !descriptorsMatch(partial.terminalDescriptor, legacyDescriptor)) {
        throw new Error(`Incomplete or conflicting terminal ledger pair for ${identityLabel}`);
      }
      repairDescriptor = partial.terminalDescriptor;
    }
    const repair = {
      ...missing,
      terminalDescriptor: repairDescriptor,
    };
    return [...existing, ...appendRunLedgerEvents(workspaceRoot, [repair], lockOptions)];
  }
  if (!terminalPairMatches(existing, expected)) {
    throw new Error(`Incomplete or conflicting terminal ledger pair for ${identityLabel}`);
  }
  return existing;
}

function normalizeRunLedgerEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
  const legacy = event.version !== 2;
  const providerSessionId = Object.prototype.hasOwnProperty.call(event, 'providerSessionId')
    ? (event.providerSessionId ?? null)
    : (legacy ? (event.sessionId ?? null) : null);
  return {
    ...event,
    invocationId: event.invocationId ?? null,
    attemptId: event.attemptId ?? null,
    providerSessionId,
    sessionId: providerSessionId,
  };
}

export function readRunLedgerEvents(workspaceRoot, { raw = false } = {}) {
  const file = resolveRunLedgerFile(workspaceRoot);
  const events = readNdjson(file);
  return raw ? events : events.map((event) => normalizeRunLedgerEvent(event));
}

function createRunLedgerTailError(code, message, data) {
  const error = new Error(message);
  error.code = code;
  error.data = data;
  return error;
}

function validateRunLedgerTailOptions(options) {
  const limit = options.limit ?? DEFAULT_LEDGER_TAIL_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LEDGER_TAIL_LIMIT) {
    throw createRunLedgerTailError(
      'invalid_argument',
      `--limit must be an integer between 1 and ${MAX_LEDGER_TAIL_LIMIT}`,
      { argument: '--limit', value: limit, minimum: 1, maximum: MAX_LEDGER_TAIL_LIMIT },
    );
  }

  const wait = options.wait === true;
  const after = options.after ?? null;
  if (wait && !after) {
    throw createRunLedgerTailError(
      'invalid_argument',
      '--wait requires --after',
      { argument: '--wait', requires: ['--after'] },
    );
  }
  if (options.timeoutMs != null && !wait) {
    throw createRunLedgerTailError(
      'invalid_argument',
      '--timeout-ms requires --wait',
      { argument: '--timeout-ms', requires: ['--wait'] },
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_LEDGER_WAIT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw createRunLedgerTailError(
      'invalid_argument',
      '--timeout-ms must be a positive integer',
      { argument: '--timeout-ms', value: timeoutMs, minimum: 1 },
    );
  }

  const pollIntervalMs = options.pollIntervalMs ?? LEDGER_WAIT_POLL_INTERVAL_MS;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new TypeError('pollIntervalMs must be a positive number');
  }

  return {
    runId: options.runId ?? null,
    after,
    limit,
    wait,
    timeoutMs,
    pollIntervalMs,
  };
}

function isCursorLedgerEvent(event) {
  return event != null
    && typeof event === 'object'
    && !Array.isArray(event)
    && typeof event.eventId === 'string'
    && event.eventId.length > 0
    && typeof event.runId === 'string'
    && event.runId.length > 0;
}

function cursorExpiredError(events, { runId, after }) {
  const anchors = runId == null ? events : events.filter((event) => event.runId === runId);
  throw createRunLedgerTailError(
    'cursor_expired',
    `Ledger cursor ${after} is not retained`,
    {
      reason: 'not_retained',
      runId,
      requested: after,
      oldest: anchors[0]?.eventId ?? null,
      latest: anchors.at(-1)?.eventId ?? null,
    },
  );
}

/**
 * Select one bounded page from already-redacted, valid run-ledger events.
 * Input order is authoritative append order; eventId is treated only as an opaque equality token.
 */
export function selectRunLedgerTail(events, options = {}) {
  const { runId: requestedRunId, after, limit } = validateRunLedgerTailOptions(options);
  const validEvents = Array.isArray(events) ? events.filter(isCursorLedgerEvent) : [];
  let runId = requestedRunId;

  if (runId == null && after != null) {
    const cursorEvent = validEvents.find((event) => event.eventId === after);
    if (!cursorEvent) cursorExpiredError(validEvents, { runId: null, after });
    runId = cursorEvent.runId;
  } else if (runId == null) {
    runId = validEvents.at(-1)?.runId ?? null;
  }

  const matching = runId == null ? [] : validEvents.filter((event) => event.runId === runId);
  const oldest = matching[0]?.eventId ?? null;
  const latest = matching.at(-1)?.eventId ?? null;
  let selected;
  let limited = false;

  if (after != null) {
    const cursorIndex = matching.findIndex((event) => event.eventId === after);
    if (cursorIndex === -1) cursorExpiredError(validEvents, { runId, after });
    const newer = matching.slice(cursorIndex + 1);
    limited = newer.length > limit;
    selected = newer.slice(0, limit);
  } else {
    limited = matching.length > limit;
    selected = matching.slice(-limit);
  }

  return {
    type: 'ledger.tail',
    runId,
    events: selected,
    cursor: {
      requested: after,
      oldest,
      latest,
      next: selected.at(-1)?.eventId ?? after ?? null,
    },
    limited,
    cursorExpired: false,
    waitTimedOut: false,
  };
}

async function readRunLedgerFileState(file) {
  try {
    const current = await fsStat(file);
    return { size: current.size, mtimeMs: current.mtimeMs };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function sameRunLedgerFileState(left, right) {
  if (left == null || right == null) return left === right;
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Read a bounded page from the redacted run ledger, optionally following a valid cursor.
 * This function never opens event.logFile or any other raw provider/job artifact.
 */
export async function tailRunLedgerEvents(workspaceRoot, options = {}, dependencies = {}) {
  const validated = validateRunLedgerTailOptions(options);
  const selection = {
    runId: validated.runId,
    after: validated.after,
    limit: validated.limit,
  };
  const readEvents = dependencies.readEvents ?? readRunLedgerEvents;
  const readFileState = dependencies.readFileState ?? readRunLedgerFileState;
  const sleep = dependencies.sleep ?? defaultSleep;
  const now = dependencies.now ?? Date.now;
  const file = resolveRunLedgerFile(workspaceRoot);
  let fileState = await readFileState(file);
  let result = selectRunLedgerTail(await readEvents(workspaceRoot), selection);
  if (selection.runId == null && result.runId != null) selection.runId = result.runId;

  if (!validated.wait || result.events.length > 0) return result;

  const deadline = now() + validated.timeoutMs;
  while (now() < deadline) {
    const remainingMs = Math.max(0, deadline - now());
    await sleep(Math.min(validated.pollIntervalMs, remainingMs));
    const nextFileState = await readFileState(file);
    if (!sameRunLedgerFileState(fileState, nextFileState)) {
      fileState = nextFileState;
      result = selectRunLedgerTail(await readEvents(workspaceRoot), selection);
      if (result.events.length > 0) return result;
    }
  }

  const finalFileState = await readFileState(file);
  if (!sameRunLedgerFileState(fileState, finalFileState)) {
    result = selectRunLedgerTail(await readEvents(workspaceRoot), selection);
    if (result.events.length > 0) return result;
  }

  return { ...result, waitTimedOut: true };
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
    group.projectedEvents = projectNewestAttemptEvents(group.events);
    group.events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return groups;
}

function projectNewestAttemptEvents(events) {
  const providers = new Map();
  const passthrough = [];

  function createAttempt(index) {
    return {
      entries: [],
      createdIndex: index,
      startIndex: null,
      started: false,
      terminal: false,
    };
  }

  for (const [index, event] of events.entries()) {
    if (!event?.provider) {
      passthrough.push({ index, event });
      continue;
    }
    const projection = providers.get(event.provider) || {
      attempts: new Map(),
      legacyJobAttempts: new Map(),
      legacyAttempt: null,
    };
    providers.set(event.provider, projection);

    const isStarted = event.phase === 'attempt_started' || event.phase === 'job_started';
    let key = event.attemptId ? `attempt:${event.attemptId}` : null;
    let attempt;
    if (event.attemptId) {
      attempt = projection.attempts.get(key);
      if (!attempt) {
        attempt = createAttempt(index);
        projection.attempts.set(key, attempt);
      }
    } else if (event.jobId) {
      attempt = projection.legacyJobAttempts.get(event.jobId);
      if (isStarted && attempt?.terminal) attempt = null;
      if (!attempt) {
        key = `job:${event.jobId}:epoch:${index}`;
        attempt = createAttempt(index);
        projection.attempts.set(key, attempt);
        projection.legacyJobAttempts.set(event.jobId, attempt);
      }
    } else {
      if (isStarted && projection.legacyAttempt?.terminal) {
        projection.legacyAttempt = null;
      }
      attempt = projection.legacyAttempt;
      if (!attempt) {
        key = `legacy:${projection.attempts.size}`;
        attempt = createAttempt(index);
        projection.attempts.set(key, attempt);
        projection.legacyAttempt = attempt;
      }
    }

    attempt.entries.push({ index, event });
    if (isStarted && !attempt.started) {
      attempt.started = true;
      attempt.startIndex = index;
    }
    if (TERMINAL_LEDGER_PHASES.has(event.phase)) {
      attempt.terminal = true;
    }
  }

  const projected = [...passthrough];
  for (const projection of providers.values()) {
    const attempts = [...projection.attempts.values()];
    const startedAttempts = attempts.filter((attempt) => attempt.started);
    const candidates = startedAttempts.length > 0 ? startedAttempts : attempts;
    const newest = candidates.reduce((latest, attempt) => {
      if (!latest) return attempt;
      const latestIndex = latest.startIndex ?? latest.createdIndex;
      const attemptIndex = attempt.startIndex ?? attempt.createdIndex;
      return attemptIndex > latestIndex ? attempt : latest;
    }, null);
    if (newest) projected.push(...newest.entries);
  }

  return projected
    .sort((left, right) => left.index - right.index)
    .map(({ event }) => event);
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
    const decisions = group.projectedEvents.filter(
      (event) => event.phase === 'provider_decision' && event.provider,
    );
    const failureClassCounts = {};
    for (const event of group.projectedEvents) {
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
  const decisions = group.projectedEvents.filter((event) => event.phase === 'provider_decision');
  const lines = decisions.map(
    (event) => `${event.provider || 'run'} ${event.status}${event.reason ? ` (${event.reason})` : ''}`,
  );
  for (const event of group.projectedEvents.filter((item) => item.phase === 'attempt_result' && item.status === 'failed')) {
    const subject = event.provider || event.jobId || 'run';
    lines.push(`attempt ${subject} failed (${classifyRunFailure(event)})`);
  }
  const terminalProviders = new Set(group.projectedEvents
    .filter((event) => TERMINAL_LEDGER_PHASES.has(event.phase) && event.provider)
    .map((event) => event.provider));
  for (const provider of new Set(group.projectedEvents
    .filter((event) => (event.phase === 'attempt_started' || event.phase === 'job_started') && event.provider)
    .map((event) => event.provider))) {
    if (!terminalProviders.has(provider)) lines.push(`${provider} unfinished`);
  }
  return { runId, found: true, text: lines.join('\n'), events: group.events };
}
