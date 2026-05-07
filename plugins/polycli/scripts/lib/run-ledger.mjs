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
      const isSecretFlag = SECRET_LONG_OPT_RE.test(arg);
      const isReviewFocus = command === 'review' && arg === '--focus';
      redacted.push(arg);
      if ((isSecretFlag || isReviewFocus) && i + 1 < argv.length) {
        redacted.push(isSecretFlag ? '<secret:redacted>' : '<prompt:redacted>');
        i += 1;
      }
      continue;
    }
    redacted.push(redactInlineValue(arg));
  }
  if (PROMPT_COMMANDS.has(command) && redacted.length > 0) {
    const last = redacted.length - 1;
    const tail = redacted[last];
    if (typeof tail === 'string' && !tail.startsWith('-') && !tail.includes('=')) {
      const wasPlaceholder = tail === '<prompt:redacted>' || tail === '<secret:redacted>';
      if (!wasPlaceholder && tail !== command) {
        redacted[last] = '<prompt:redacted>';
      }
    }
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
    defaultModel: event.defaultModel ?? null,
    timingRef: event.timingRef ?? null,
    error: event.error ?? null,
    preview: event.preview ?? null,
    stdoutBytes: event.stdoutBytes ?? null,
    stderrBytes: event.stderrBytes ?? null,
    logFile: event.logFile ?? null,
    argv: event.argv || [],
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

export function summarizeRunLedger(events) {
  return [...groupRunLedgerEvents(events).values()].map((group) => {
    const decisions = group.events.filter(
      (event) => event.phase === 'provider_decision' && event.provider,
    );
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
  if (!group) {
    return { runId, found: false, text: `Run ${runId} was not found.`, events: [] };
  }
  const decisions = group.events.filter((event) => event.phase === 'provider_decision');
  const lines = decisions.map(
    (event) => `${event.provider || 'run'} ${event.status}${event.reason ? ` (${event.reason})` : ''}`,
  );
  return { runId, found: true, text: lines.join('\n'), events: group.events };
}
