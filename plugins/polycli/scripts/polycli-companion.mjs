#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "@bbingz/polycli-utils/args";
import { getProviderRuntime, listProviderRuntimes, runProviderPromptStreaming } from "@bbingz/polycli-runtime";

import {
  buildStatusSnapshot,
  cancelJob,
  refreshJob,
  resolveJobReference,
  resolveLatestActiveJob,
  resolveLatestTerminalJob,
  waitForJob,
} from "./lib/job-control.mjs";
import { buildPromptRuntimeOptions } from "./lib/prompt-runtime.mjs";
import { resolveProvider } from "./lib/providers.mjs";
import { buildReviewPrompt, buildReviewRuntimeOptions, collectReviewContext } from "./lib/review.mjs";
import {
  getJob,
  recordLastUsedProvider,
  readJobConfigFile,
  readJobFile,
  removeJobConfigFile,
  resolveJobConfigFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveWorkspaceRoot,
  getConfig,
  setConfig,
  updateJobAtomically,
  upsertJob,
  writeJobConfigFile,
  writeJobFile,
} from "./lib/state.mjs";
import {
  appendTimingRecord,
  listTimingRecords,
  summarizeTimingRecords,
} from "./lib/timing.mjs";
import { appendPreview, previewText } from "./lib/preview.mjs";

const COMPANION_PATH = fileURLToPath(import.meta.url);
const JOB_PREFIXES = {
  ask: "pa",
  rescue: "pr",
  review: "pv",
  "adversarial-review": "pv",
};
const TIMEOUTS_MS = {
  ask: 120_000,
  rescue: 600_000,
  review: 300_000,
  "adversarial-review": 300_000,
  health: 60_000,
};
const PROVIDER_TIMEOUT_MULTIPLIERS = {
  gemini: {
    "gemini-3.1-pro-preview": 2,
  },
  // opencode's kimi-for-coding variant is a code-reasoning model that hits
  // 120s+ on HumanEval-class problems (verified 2026-05-02 multiway bench R3).
  opencode: {
    "kimi-for-coding/k2p6": 2,
  },
};

function resolveTimeoutMs(provider, kind, { model = null, defaultModel = null } = {}) {
  const base = TIMEOUTS_MS[kind];
  if (!Number.isFinite(base)) return base;
  const entry = PROVIDER_TIMEOUT_MULTIPLIERS[provider];
  if (entry == null) return base;
  if (typeof entry === "number") return base * entry;
  // Explicit --model wins; fall back to the cached upstream-default model only
  // if the caller did not pass one. This way, --model gemini-flash-2.5 stays
  // at the base budget even when the cached default is a deep-reasoning model.
  const lookup = model || defaultModel;
  const multiplier = (lookup && entry[lookup]) || 1;
  return base * multiplier;
}
const HEALTH_SENTINEL = "POLYCLI_HEALTH_OK";
const SESSION_ID_ENV = "POLYCLI_COMPANION_SESSION_ID";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  polycli-companion.mjs setup [--provider <provider>] [--json]",
      "    [--enable-review-gate|--disable-review-gate]",
      "  polycli-companion.mjs health [--provider <provider>] [--model <model>] [--timeout-ms <ms>] [--json]",
      "  polycli-companion.mjs ask --provider <provider> [--model <model>] [--background] [--json] <prompt>",
      "  polycli-companion.mjs rescue --provider <provider> [--model <model>] [--background] [--json] <prompt>",
      "  polycli-companion.mjs review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]",
      "  polycli-companion.mjs adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]",
      "  polycli-companion.mjs status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]",
      "  polycli-companion.mjs result [job-id] [--json]",
      "  polycli-companion.mjs cancel [job-id] [--json]",
      "  polycli-companion.mjs timing [--provider <provider>] [--history <count>] [--json]",
    ].join("\n")
  );
}

function hasHelpFlag(args = []) {
  return args.includes("--help") || args.includes("-h");
}

function wantsJson(args = []) {
  return args.includes("--json");
}

function classifyErrorCode(message = "") {
  if (message.startsWith("Missing provider.")) return "missing_provider";
  if (message.startsWith("Unknown provider ")) return "unknown_provider";
  if (message.startsWith("Invalid --scope value ")) return "invalid_scope";
  if (message.startsWith("Missing prompt text ")) return "missing_prompt";
  if (message.startsWith("Unknown subcommand ")) return "unknown_subcommand";
  if (/^Job '.+' not found\.$/.test(message)) return "job_not_found";
  if (message === "No completed job found.") return "no_completed_job";
  if (message === "No active job found.") return "no_active_job";
  if (message === "--history must be a non-negative integer.") return "invalid_history";
  return "error";
}

function exitWithError({ message, code = classifyErrorCode(message), asJson = false, exitCode = 1 }) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ error: message, code }, null, 2)}\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exitCode = exitCode;
}

function output(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

function resolveProviderModelCacheFile(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), "provider-models.json");
}

function readProviderModelCache(workspaceRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveProviderModelCacheFile(workspaceRoot), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readCachedProviderModel(workspaceRoot, provider) {
  const cached = readProviderModelCache(workspaceRoot)[provider];
  return typeof cached === "string" && cached.trim() ? cached : null;
}

function cacheProviderModel(workspaceRoot, provider, model) {
  if (typeof model !== "string" || !model.trim()) return;
  const cacheFile = resolveProviderModelCacheFile(workspaceRoot);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(
    cacheFile,
    `${JSON.stringify({ ...readProviderModelCache(workspaceRoot), [provider]: model }, null, 2)}\n`,
    "utf8"
  );
}

async function inspectProvider(provider) {
  const runtime = getProviderRuntime(provider);
  const availability = await Promise.resolve(runtime.getAvailability(process.cwd()));
  const auth = await Promise.resolve(runtime.getAuthStatus(process.cwd()));
  const row = {
    provider,
    available: availability.available ?? false,
    availabilityDetail: availability.detail ?? null,
    loggedIn: auth.loggedIn ?? false,
    authDetail: auth.detail ?? auth.reason ?? null,
    model: auth.model ?? null,
    capabilities: runtime.capabilities,
  };
  cacheProviderModel(resolveWorkspaceRoot(process.cwd()), provider, row.model);
  return row;
}

async function inspectProviderAvailability(provider) {
  const runtime = getProviderRuntime(provider);
  const availability = await Promise.resolve(runtime.getAvailability(process.cwd()));
  return {
    provider,
    available: availability.available ?? false,
    availabilityDetail: availability.detail ?? null,
    loggedIn: null,
    authDetail: "not checked by health",
    model: null,
    capabilities: runtime.capabilities,
  };
}

function createJobId(kind) {
  const prefix = JOB_PREFIXES[kind] || "pj";
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function parseExecutionMode(options) {
  if (options.background && options.wait) {
    throw new Error("Choose either --background or --wait, not both.");
  }
  return {
    background: Boolean(options.background),
  };
}

function emitNote(line) {
  if (!line) return;
  process.stderr.write(`${line}\n`);
}

function emitRuntimeWarnings(result = {}) {
  if (!Array.isArray(result.warnings)) return;
  for (const warning of result.warnings) {
    if (typeof warning === "string" && warning.trim()) {
      process.stderr.write(`${warning.trim()}\n`);
    }
  }
}

function validateEffort(effort) {
  if (effort == null) return;
  if (!["low", "medium", "high"].includes(effort)) {
    throw new Error("--effort must be one of: low, medium, high.");
  }
}

function buildProviderFlagRuntimeOptions(provider, options) {
  const runtimeOptions = {};
  const notes = [];
  const resumeFlags = [
    options["resume-last"] ? "--resume-last" : null,
    options.resume ? "--resume" : null,
    options.fresh ? "--fresh" : null,
  ].filter(Boolean);

  if (provider === "kimi") {
    if (resumeFlags.length > 1) {
      throw new Error("Choose only one of --resume-last, --resume, or --fresh.");
    }
    if (options["resume-last"]) runtimeOptions.resumeLast = true;
    if (options.resume) runtimeOptions.resumeSessionId = options.resume;
    if (options.fresh) runtimeOptions.fresh = true;
    if (options.write) {
      notes.push("Kimi doesn't distinguish plan-mode from write-mode; it will act on what the prompt asks.");
    }
    if (options.effort) {
      notes.push(`--effort is gemini-specific; ${provider} will proceed without it.`);
    }
    return { runtimeOptions, notes };
  }

  if (provider === "gemini") {
    if (options.write) runtimeOptions.write = true;
    if (options.effort) runtimeOptions.effort = options.effort;
    if (resumeFlags.length > 0) {
      notes.push(`${resumeFlags.join(", ")} ${resumeFlags.length === 1 ? "is" : "are"} kimi-specific; ${provider} will proceed without ${resumeFlags.length === 1 ? "it" : "them"}.`);
    }
    return { runtimeOptions, notes };
  }

  if (options.write) {
    notes.push(`--write is gemini-specific; ${provider} will proceed without it.`);
  }
  if (options.effort) {
    notes.push(`--effort is gemini-specific; ${provider} will proceed without it.`);
  }
  if (resumeFlags.length > 0) {
    notes.push(`${resumeFlags.join(", ")} ${resumeFlags.length === 1 ? "is" : "are"} kimi-specific; ${provider} will proceed without ${resumeFlags.length === 1 ? "it" : "them"}.`);
  }
  return { runtimeOptions, notes };
}

function buildExecutionEnvelope(execution, result) {
  return {
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || execution.defaultModel || null,
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    meta: execution.meta || {},
    ...compactProviderResult(result),
  };
}

function compactProviderResult(result = {}) {
  const compact = { ...result };
  if (typeof result.stdout === "string") {
    compact.stdoutBytes = Buffer.byteLength(result.stdout, "utf8");
    delete compact.stdout;
  }
  if (typeof result.stderr === "string") {
    compact.stderrBytes = Buffer.byteLength(result.stderr, "utf8");
    delete compact.stderr;
  }
  if (Array.isArray(result.events)) {
    compact.eventCount = result.events.length;
    delete compact.events;
  }
  return compact;
}

function cleanupRuntimeOptions(runtimeOptions = {}) {
  const cleanupPaths = Array.isArray(runtimeOptions.cleanupPaths)
    ? runtimeOptions.cleanupPaths
    : [];
  for (const cleanupPath of cleanupPaths) {
    if (typeof cleanupPath !== "string" || cleanupPath.trim() === "") continue;
    try {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    } catch {}
  }
}

function hydrateRuntimeOptions(runtimeOptions = {}) {
  if (!runtimeOptions.env) {
    return runtimeOptions;
  }
  return {
    ...runtimeOptions,
    env: { ...process.env, ...runtimeOptions.env },
  };
}

async function runForegroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  let result;
  try {
    result = await runProviderPromptStreaming({
      provider: execution.provider,
      prompt: execution.prompt,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      cwd: execution.cwd,
      timeout: execution.timeout,
      kind: execution.kind,
      measurementScope: execution.measurementScope || "request",
      meta: execution.meta || null,
      ...hydrateRuntimeOptions(execution.runtimeOptions),
      onEvent() {},
    });
  } finally {
    cleanupRuntimeOptions(execution.runtimeOptions);
  }
  emitRuntimeWarnings(result);
  if (result.timing) {
    appendTimingRecord(workspaceRoot, result.timing);
  }
  cacheProviderModel(workspaceRoot, execution.provider, result.model);

  const envelope = buildExecutionEnvelope(execution, result);
  if (asJson) {
    output(envelope, true);
    return;
  }

  if (!result.ok) {
    throw new Error(result.error || `${execution.provider} ${execution.kind} failed`);
  }

  const lines = [];
  if (execution.meta?.truncationNotice) {
    lines.push(execution.meta.truncationNotice);
  }
  lines.push(result.response);
  output(lines.join("\n\n"), false);
}

function buildQueuedJob(execution, workspaceRoot) {
  const now = new Date().toISOString();
  const jobId = createJobId(execution.kind);
  return {
    jobId,
    workspaceRoot,
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || null,
    defaultModel: execution.defaultModel || null,
    status: "queued",
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    logFile: resolveJobLogFile(workspaceRoot, jobId),
    createdAt: now,
    updatedAt: now,
    sessionId: process.env[SESSION_ID_ENV] || null,
    ...execution.jobMeta,
  };
}

function renderStartedJob(job) {
  return [
    `Started ${job.provider} ${job.kind} job ${job.jobId}.`,
    `Use /polycli:status ${job.jobId} to monitor it.`,
    `Use /polycli:result ${job.jobId} to fetch the stored output.`,
  ].join("\n");
}

function renderJobDetail(job) {
  const lines = [
    `Job: ${job.jobId}`,
    `Provider: ${job.provider}`,
    `Kind: ${job.kind}`,
    `Status: ${job.status}`,
  ];
  if (job.model) lines.push(`Model: ${job.model}`);
  if (job.promptPreview) lines.push(`Prompt: ${job.promptPreview}`);
  if (job.scope) lines.push(`Scope: ${job.scope}`);
  if (job.baseRef) lines.push(`Base Ref: ${job.baseRef}`);
  if (job.createdAt) lines.push(`Created: ${job.createdAt}`);
  if (job.finishedAt) lines.push(`Finished: ${job.finishedAt}`);
  if (job.sessionId) lines.push(`Session: ${job.sessionId}`);
  if (job.progressPreview) {
    lines.push("");
    lines.push("Progress:");
    lines.push(job.progressPreview);
  }
  return lines.join("\n");
}

function renderStatusSnapshot(snapshot) {
  const rows = [...snapshot.running, ...snapshot.recent];
  if (rows.length === 0) {
    return "No jobs found.";
  }

  const lines = [
    "| jobId | provider | kind | status | prompt |",
    "|---|---|---|---|---|",
  ];
  for (const job of rows) {
    lines.push(`| ${job.jobId} | ${job.provider} | ${job.kind} | ${job.status} | ${job.promptPreview || ""} |`);
    if (job.progressPreview && snapshot.running.some((running) => running.jobId === job.jobId)) {
      lines.push(`|  |  |  | progress | ${previewText(job.progressPreview, 180)} |`);
    }
  }
  return lines.join("\n");
}

function renderResultEnvelope(envelope) {
  const result = envelope.result ?? envelope;
  const lines = [
    `Job: ${envelope.job.jobId}`,
    `Provider: ${envelope.job.provider}`,
    `Kind: ${envelope.job.kind}`,
    `Status: ${envelope.job.status}`,
  ];
  if (envelope.job.finishedAt) lines.push(`Finished: ${envelope.job.finishedAt}`);
  if (envelope.job.sessionId) lines.push(`Session: ${envelope.job.sessionId}`);
  if (result?.response) {
    lines.push("");
    lines.push("Response:");
    lines.push(result.response);
  }
  if (!result?.response && result?.error) {
    lines.push("");
    lines.push("Error:");
    lines.push(result.error);
  }
  return lines.join("\n");
}

function buildResultPayload(envelope) {
  const job = envelope.job || {};
  const result = envelope.result || {};
  return {
    provider: result.provider ?? job.provider ?? null,
    kind: result.kind ?? job.kind ?? null,
    model: result.model ?? job.model ?? null,
    promptPreview: result.promptPreview ?? job.promptPreview ?? null,
    ...result,
    job: {
      jobId: job.jobId ?? null,
      provider: job.provider ?? null,
      kind: job.kind ?? null,
      model: job.model ?? null,
      status: job.status ?? null,
      promptPreview: job.promptPreview ?? null,
      createdAt: job.createdAt ?? null,
      updatedAt: job.updatedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      pid: job.pid ?? null,
      logFile: job.logFile ?? null,
      sessionId: job.sessionId ?? null,
      error: job.error ?? null,
    },
  };
}

async function startBackgroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  const job = buildQueuedJob(execution, workspaceRoot);
  upsertJob(workspaceRoot, job);
  writeJobConfigFile(workspaceRoot, job.jobId, {
    workspaceRoot,
    execution: {
      ...execution,
      measurementScope: "job",
      meta: {
        ...(execution.meta || {}),
        background: true,
        jobId: job.jobId,
      },
    },
    jobId: job.jobId,
  });

  fs.writeFileSync(job.logFile, `[${new Date().toISOString()}] started ${job.provider} ${job.kind}\n`, "utf8");
  const logFd = fs.openSync(job.logFile, "a");
  const child = spawn(process.execPath, [COMPANION_PATH, "_job-worker", resolveJobConfigFile(workspaceRoot, job.jobId)], {
    cwd: execution.cwd,
    env: { ...process.env },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  child.unref();
  fs.closeSync(logFd);

  const runningJob = upsertJob(workspaceRoot, {
    ...job,
    status: "running",
    pid: child.pid ?? null,
  });

  if (asJson) {
    output({ ok: true, job: runningJob }, true);
    return;
  }

  output(renderStartedJob(runningJob), false);
}

async function runSetup(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"],
    valueOptions: ["provider"],
  });
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate, not both.");
  }
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }

  let providers;
  if (options.provider) {
    providers = [resolveProvider({ provider: options.provider }).provider];
  } else if (positionals[0]) {
    providers = [resolveProvider({ positionals }).provider];
  } else {
    providers = listProviderRuntimes().map((runtime) => runtime.id);
  }

  const gateConfig = getConfig(workspaceRoot);
  const results = [];
  for (const provider of providers) {
    results.push({
      ...(await inspectProvider(provider)),
      stopReviewGate: gateConfig.stopReviewGate === true,
      stopReviewGateWorkspace: workspaceRoot,
    });
  }

  if (options.json) {
    output(results, true);
    return;
  }

  const lines = [];
  for (const row of results) {
    lines.push(
      [
        `[${row.provider}]`,
        `available=${row.available ? "yes" : "no"}`,
        `loggedIn=${row.loggedIn ? "yes" : "no"}`,
        row.model ? `model=${row.model}` : null,
        row.availabilityDetail ? `version=${row.availabilityDetail}` : null,
        row.authDetail ? `detail=${row.authDetail}` : null,
      ].filter(Boolean).join(" ")
    );
  }
  output(lines.join("\n"), false);
}

async function probeProviderHealth({
  provider,
  model = null,
  timeout,
  workspaceRoot,
}) {
  const inspection = await inspectProviderAvailability(provider);
  const report = {
    ...inspection,
    ok: false,
    probe: {
      ok: false,
      responseMatched: false,
      expected: HEALTH_SENTINEL,
      responsePreview: null,
      error: null,
      timing: null,
    },
  };

  if (!inspection.available) {
    report.probe.error = inspection.availabilityDetail || "provider CLI is unavailable";
  } else {
    try {
      const result = await runProviderPromptStreaming({
        provider,
        prompt: `Reply with ${HEALTH_SENTINEL} only.`,
        model,
        defaultModel: model ? null : readCachedProviderModel(workspaceRoot, provider),
        cwd: process.cwd(),
        timeout,
        kind: "health",
        measurementScope: "request",
        meta: { health: true },
        ...buildPromptRuntimeOptions({
          provider,
          kind: "ask",
        }),
        onEvent() {},
      });
      if (result.timing) {
        appendTimingRecord(workspaceRoot, result.timing);
      }
      const response = result.response || "";
      const responseMatched = response.trim() === HEALTH_SENTINEL;
      report.probe = {
        ok: result.ok,
        responseMatched,
        expected: HEALTH_SENTINEL,
        responsePreview: previewText(response, 180),
        error: result.error ?? null,
        timing: result.timing ?? null,
      };
      report.ok = Boolean(result.ok && responseMatched);
      report.model = result.model ?? report.model;
      cacheProviderModel(workspaceRoot, provider, report.model);
    } catch (error) {
      report.probe.error = error.message;
    }
  }

  return report;
}

function renderHealthReport(report) {
  const lines = [
    `[${report.provider}] health=${report.ok ? "ok" : "failed"}`,
    `available=${report.available ? "yes" : "no"}`,
    `auth=${report.loggedIn == null ? "not_checked" : (report.loggedIn ? "yes" : "no")}`,
  ];
  if (report.model) lines.push(`model=${report.model}`);
  if (report.availabilityDetail) lines.push(`version=${report.availabilityDetail}`);
  if (report.authDetail) lines.push(`detail=${report.authDetail}`);
  lines.push(`probe=${report.probe.ok ? "ok" : "failed"}`);
  lines.push(`matched=${report.probe.responseMatched ? "yes" : "no"}`);
  if (report.probe.responsePreview) lines.push(`response=${report.probe.responsePreview}`);
  if (report.probe.error) lines.push(`error=${report.probe.error}`);
  return lines.join(" ");
}

function buildHealthPayload(results) {
  const healthyProviders = results.filter((result) => result.ok).map((result) => result.provider);
  const unhealthyProviders = results.filter((result) => !result.ok).map((result) => result.provider);
  return {
    ok: healthyProviders.length > 0,
    anyHealthy: healthyProviders.length > 0,
    allHealthy: results.length > 0 && unhealthyProviders.length === 0,
    healthyProviders,
    unhealthyProviders,
    results,
  };
}

async function runHealth(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider", "model", "timeout-ms"],
    aliasMap: { m: "model" },
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const timeoutMs = options["timeout-ms"] ? Number.parseInt(options["timeout-ms"], 10) : TIMEOUTS_MS.health;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TIMEOUTS_MS.health;
  const hasSingleProvider = Boolean(options.provider || positionals[0]);
  if (options.model && !hasSingleProvider) {
    throw new Error("--model requires --provider for health; provider model names are not portable.");
  }
  const providers = hasSingleProvider
    ? [resolveProvider({ provider: options.provider, positionals }).provider]
    : listProviderRuntimes().map((runtime) => runtime.id);

  const results = await Promise.all(providers.map((provider) => probeProviderHealth({
      provider,
      model: options.model || null,
      timeout,
      workspaceRoot,
    })));

  const payload = buildHealthPayload(results);
  if (!payload.anyHealthy) {
    process.exitCode = 2;
  }
  output(
    options.json
      ? payload
      : [
        `Healthy providers: ${payload.healthyProviders.length > 0 ? payload.healthyProviders.join(", ") : "none"}`,
        `All healthy: ${payload.allHealthy ? "yes" : "no"}`,
        ...results.map((result) => renderHealthReport(result)),
      ].join("\n"),
    options.json
  );
}

function parsePromptExecution(rawArgs, kind) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait", "resume-last", "fresh", "write"],
    valueOptions: ["provider", "model", "resume", "effort"],
    aliasMap: { m: "model" },
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals,
  });
  validateEffort(options.effort);
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const userPrompt = remainingPositionals.join(" ").trim();
  if (!userPrompt) {
    throw new Error(`Missing prompt text for ${kind}.`);
  }
  const providerFlags = buildProviderFlagRuntimeOptions(provider, options);
  for (const note of providerFlags.notes) emitNote(note);
  const cachedDefaultModel = readCachedProviderModel(workspaceRoot, provider);
  return {
    options,
    execution: {
      provider,
      kind,
      prompt: userPrompt,
      userPrompt,
      model: options.model || null,
      defaultModel: cachedDefaultModel,
      cwd: process.cwd(),
      timeout: resolveTimeoutMs(provider, kind, {
        model: options.model || null,
        defaultModel: cachedDefaultModel,
      }),
      meta: {},
      jobMeta: {},
      measurementScope: "request",
      runtimeOptions: buildPromptRuntimeOptions({
        provider,
        kind,
        runtimeOptions: providerFlags.runtimeOptions,
      }),
    },
  };
}

async function runAsk(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "ask");
  recordLastUsedProvider(resolveWorkspaceRoot(execution.cwd), execution.provider);
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}

async function runRescue(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "rescue");
  recordLastUsedProvider(resolveWorkspaceRoot(execution.cwd), execution.provider);
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}

function buildReviewExecution(rawArgs, { adversarial }) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait"],
    valueOptions: ["provider", "model", "base", "scope"],
    aliasMap: { m: "model" },
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals,
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const focus = remainingPositionals.join(" ").trim();
  const reviewContext = collectReviewContext({
    cwd: process.cwd(),
    scope: options.scope,
    baseRef: options.base || null,
  });

  if (!reviewContext.ok) {
    throw new Error(reviewContext.error);
  }

  return {
    options,
    provider,
    reviewContext,
    execution: {
      provider,
      kind: adversarial ? "adversarial-review" : "review",
      prompt: buildReviewPrompt({
        provider,
        diff: reviewContext.diff,
        focus,
        adversarial,
        truncated: reviewContext.truncated,
        truncationNotice: reviewContext.truncationNotice,
      }),
      userPrompt: focus || `${adversarial ? "adversarial " : ""}review ${reviewContext.scope}`,
      model: options.model || null,
      defaultModel: readCachedProviderModel(workspaceRoot, provider),
      cwd: process.cwd(),
      timeout: resolveTimeoutMs(provider, adversarial ? "adversarial-review" : "review", {
        model: options.model || null,
        defaultModel: readCachedProviderModel(workspaceRoot, provider),
      }),
      meta: {
        scope: reviewContext.scope,
        baseRef: reviewContext.baseRef || null,
        truncated: reviewContext.truncated,
        truncationNotice: reviewContext.truncationNotice,
        adversarial,
        background: false,
      },
      jobMeta: {
        scope: reviewContext.scope,
        baseRef: reviewContext.baseRef || null,
        adversarial,
      },
      measurementScope: "request",
      runtimeOptions: buildReviewRuntimeOptions({
        provider,
        cwd: process.cwd(),
      }),
    },
  };
}

async function runReviewCommand(rawArgs, { adversarial }) {
  const { options, provider, reviewContext, execution } = buildReviewExecution(rawArgs, { adversarial });
  if (!reviewContext.diff.trim()) {
    const warnings = Array.isArray(reviewContext.warnings) && reviewContext.warnings.length > 0
      ? reviewContext.warnings
      : undefined;
    output(
      options.json
        ? { ok: true, provider, verdict: "no_changes", scope: reviewContext.scope, warnings }
        : [
          ...(warnings ? [`Note: ${warnings.join(" | ")}`] : []),
          "No changes to review.",
        ].join("\n\n"),
      options.json
    );
    return;
  }

  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}

async function runStatus(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "all", "wait"],
    valueOptions: ["timeout-ms"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const reference = positionals[0] || null;

  if (options.wait) {
    const target = reference ? resolveJobReference(workspaceRoot, reference) : resolveLatestActiveJob(workspaceRoot);
    if (!target) {
      throw new Error(reference ? `Job '${reference}' not found.` : "No active job found.");
    }
    const waited = await waitForJob(workspaceRoot, target.jobId, {
      timeoutMs: options["timeout-ms"] ? Number.parseInt(options["timeout-ms"], 10) : undefined,
    });
    if (options.json) {
      output(waited, true);
      return;
    }
    if (waited.error) {
      throw new Error(waited.error);
    }
    output(renderJobDetail(waited.job), false);
    return;
  }

  if (reference) {
    const job = resolveJobReference(workspaceRoot, reference);
    if (!job) {
      throw new Error(`Job '${reference}' not found.`);
    }
    const refreshed = refreshJob(workspaceRoot, job);
    if (options.json) {
      output({ job: refreshed }, true);
      return;
    }
    output(renderJobDetail(refreshed), false);
    return;
  }

  const snapshot = buildStatusSnapshot(workspaceRoot, { showAll: Boolean(options.all) });
  if (options.json) {
    output(snapshot, true);
    return;
  }
  output(renderStatusSnapshot(snapshot), false);
}

async function runResult(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const job = positionals[0]
    ? resolveJobReference(workspaceRoot, positionals[0])
    : resolveLatestTerminalJob(workspaceRoot);

  if (!job) {
    throw new Error(positionals[0] ? `Job '${positionals[0]}' not found.` : "No completed job found.");
  }

  const refreshed = refreshJob(workspaceRoot, job);
  if (refreshed.status === "queued" || refreshed.status === "running") {
    throw new Error(`Job '${refreshed.jobId}' is still ${refreshed.status}. Use status first.`);
  }

  const envelope = readJobFile(resolveJobFile(workspaceRoot, refreshed.jobId)) || { job: refreshed, result: refreshed.result };
  if (options.json) {
    output(buildResultPayload(envelope), true);
    return;
  }
  output(renderResultEnvelope(envelope), false);
}

async function runCancel(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const job = positionals[0]
    ? resolveJobReference(workspaceRoot, positionals[0])
    : resolveLatestActiveJob(workspaceRoot);

  if (!job) {
    if (options.json) {
      output({ cancelled: false, reason: "not_found", jobId: positionals[0] || null }, true);
      process.exitCode = 1;
      return;
    }
    output(positionals[0] ? `Job ${positionals[0]} not found.` : "No active job found to cancel.", false);
    process.exitCode = 1;
    return;
  }

  const report = await cancelJob(workspaceRoot, job.jobId);
  if (options.json) {
    output(report, true);
  } else if (report.cancelled) {
    output(`Cancelled job ${report.jobId}.`, false);
  } else if (report.reason === "not_cancellable") {
    output(`Job ${report.jobId} is already ${job.status}.`, false);
    process.exitCode = 4;
  } else {
    output(`Failed to cancel ${report.jobId}: ${report.error || report.reason}`, false);
    process.exitCode = 5;
  }
}

function formatMetric(metric) {
  if (!metric) return "n/a";
  if (metric.status === "measured" || metric.status === "zero") {
    return `${metric.ms}ms`;
  }
  return metric.status;
}

function renderTimingReport(records, aggregate) {
  if (records.length === 0) {
    return "No timing records found.";
  }

  const lines = [
    "Recent timing records:",
    ...records.map((record) => {
      const suffix = [
        `total=${formatMetric(record.metrics.total)}`,
        `ttft=${formatMetric(record.metrics.ttft)}`,
        `gen=${formatMetric(record.metrics.gen)}`,
        `tool=${formatMetric(record.metrics.tool)}`,
        `tail=${formatMetric(record.metrics.tail)}`,
      ].join(" ");
      return `- ${record.completedAt} ${record.provider} ${record.kind || "prompt"} ${record.measurementScope} ${suffix}`;
    }),
    "",
    "Aggregate:",
  ];

  for (const [provider, summary] of Object.entries(aggregate.byProvider)) {
    lines.push(
      `- ${provider}: count=${summary.recordCount} total.p50=${summary.metrics.total.p50} total.p95=${summary.metrics.total.p95}`
    );
  }

  return lines.join("\n");
}

function parseHistoryLimit(value) {
  if (value == null) return 20;
  if (!/^\d+$/.test(String(value))) {
    throw new Error("--history must be a non-negative integer.");
  }
  return Number.parseInt(value, 10);
}

async function runTiming(rawArgs) {
  const { options } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider", "history"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const provider = options.provider
    ? resolveProvider({ provider: options.provider }).provider
    : null;
  const limit = parseHistoryLimit(options.history);
  const records = listTimingRecords(workspaceRoot, {
    provider,
    limit,
  });
  const aggregate = summarizeTimingRecords(records);

  if (options.json) {
    output({ records, aggregate }, true);
    return;
  }

  output(renderTimingReport(records, aggregate), false);
}

async function runJobWorker(rawArgs) {
  const configFile = rawArgs[0];
  if (!configFile) {
    throw new Error("Missing config path for _job-worker.");
  }
  const payload = readJobConfigFile(configFile);
  if (!payload) {
    throw new Error(`Unable to read job config ${configFile}`);
  }

  const { workspaceRoot, execution, jobId } = payload;
  const current = getJob(workspaceRoot, jobId);
  if (!current) {
    throw new Error(`Unknown job ${jobId}`);
  }

  try {
    const result = await runProviderPromptStreaming({
      provider: execution.provider,
      prompt: execution.prompt,
      model: execution.model || null,
      defaultModel: execution.defaultModel || null,
      cwd: execution.cwd,
      timeout: execution.timeout,
      kind: execution.kind,
      measurementScope: execution.measurementScope || "job",
      meta: execution.meta || null,
      ...hydrateRuntimeOptions(execution.runtimeOptions),
      onEvent(event) {
        appendPreview(current.logFile, execution.provider, event);
      },
    });

    const write = updateJobAtomically(workspaceRoot, jobId, (latest) => {
      if (!latest || latest.status === "cancelled") {
        return null;
      }
      const finishedJob = {
        ...latest,
        ...execution.jobMeta,
        status: result.ok ? "completed" : "failed",
        pid: null,
        finishedAt: new Date().toISOString(),
        sessionId: result.sessionId ?? null,
        error: result.error ?? null,
      };
      return {
        job: finishedJob,
        envelope: {
          job: finishedJob,
          result: compactProviderResult(result),
        },
      };
    });
    if (!write.written) {
      removeJobConfigFile(workspaceRoot, jobId);
      return;
    }
    if (result.timing) {
      appendTimingRecord(workspaceRoot, result.timing);
    }
    cacheProviderModel(workspaceRoot, execution.provider, result.model);
    removeJobConfigFile(workspaceRoot, jobId);
  } catch (error) {
    const write = updateJobAtomically(workspaceRoot, jobId, (latest) => {
      if (!latest || latest.status === "cancelled") {
        return null;
      }
      const failedJob = {
        ...latest,
        ...execution.jobMeta,
        status: "failed",
        pid: null,
        finishedAt: new Date().toISOString(),
        error: error.message,
      };
      return {
        job: failedJob,
        envelope: {
          job: failedJob,
          result: { ok: false, error: error.message },
        },
      };
    });
    if (!write.written) {
      removeJobConfigFile(workspaceRoot, jobId);
      return;
    }
    removeJobConfigFile(workspaceRoot, jobId);
    throw error;
  } finally {
    cleanupRuntimeOptions(execution.runtimeOptions);
  }
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (hasHelpFlag(rawArgs) && command !== "_job-worker") {
    printUsage();
    return;
  }

  if (command === "setup") {
    await runSetup(rawArgs);
    return;
  }
  if (command === "health") {
    await runHealth(rawArgs);
    return;
  }
  if (command === "ask") {
    await runAsk(rawArgs);
    return;
  }
  if (command === "rescue") {
    await runRescue(rawArgs);
    return;
  }
  if (command === "review") {
    await runReviewCommand(rawArgs, { adversarial: false });
    return;
  }
  if (command === "adversarial-review") {
    await runReviewCommand(rawArgs, { adversarial: true });
    return;
  }
  if (command === "status") {
    await runStatus(rawArgs);
    return;
  }
  if (command === "result") {
    await runResult(rawArgs);
    return;
  }
  if (command === "cancel") {
    await runCancel(rawArgs);
    return;
  }
  if (command === "timing") {
    await runTiming(rawArgs);
    return;
  }
  if (command === "_job-worker") {
    await runJobWorker(rawArgs);
    return;
  }

  throw new Error(`Unknown subcommand '${command}'.`);
}

main().catch((error) => {
  exitWithError({
    message: error.message,
    asJson: wantsJson(process.argv.slice(2)),
    exitCode: process.exitCode || 1,
  });
});
