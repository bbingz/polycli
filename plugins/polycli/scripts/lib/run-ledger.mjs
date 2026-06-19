import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { appendNdjson, readNdjson } from '@bbingz/polycli-utils/ndjson';
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
  appendNdjson(file, full, { maxBytes: MAX_LEDGER_BYTES, keepRatio: KEEP_RATIO, mode: PRIVATE_FILE_MODE });
  return full;
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
