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
import { resolveProvider } from "./lib/providers.mjs";
import { buildReviewPrompt, buildReviewRuntimeOptions, collectReviewContext } from "./lib/review.mjs";
import {
  getJob,
  readJobConfigFile,
  readJobFile,
  removeJobConfigFile,
  resolveJobConfigFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveWorkspaceRoot,
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
  review: 180_000,
  "adversarial-review": 180_000,
};

function printUsage() {
  console.log(
    [
      "Usage:",
      "  polycli-companion.mjs setup [--provider <provider>] [--json]",
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

function output(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

function collapseWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function previewText(text, maxLength = 120) {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 1)}…`;
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

function summarizeEventText(provider, event) {
  if (!event || typeof event !== "object") return "";

  if (provider === "claude") {
    if (event.type === "result" && event.is_error !== true && event.subtype !== "error" && typeof event.result === "string") {
      return event.result;
    }
    if (typeof event.text === "string") return event.text;
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
      return event.delta.text;
    }
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "copilot") {
    if ((event.type === "result" || event.type === "final") && typeof event.result === "string") return event.result;
    if (event.type === "assistant.message_delta" && typeof event.data?.deltaContent === "string") return event.data.deltaContent;
    if (event.type === "assistant.message" && typeof event.data?.content === "string") return event.data.content;
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.text === "string") return event.text;
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "gemini") {
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.content === "string") return event.content;
    if (typeof event.text === "string") return event.text;
    if (typeof event.message?.content === "string") return event.message.content;
    return "";
  }

  if (provider === "kimi") {
    if (event.role !== "assistant") return "";
    if (typeof event.content === "string") return event.content;
    if (!Array.isArray(event.content)) return "";
    return event.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "qwen") {
    if (event.type === "result" && event.is_error !== true && event.subtype !== "error" && typeof event.result === "string") {
      return event.result;
    }
    if (event.type !== "assistant" || !Array.isArray(event.message?.content)) return "";
    return event.message.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "minimax") {
    if (event.type === "progress" && typeof event.text === "string") return event.text;
    if (event.type === "result" && typeof event.response === "string") return event.response;
  }

  if (provider === "opencode") {
    if (event.type === "result" && typeof event.text === "string") return event.text;
    if (event.type === "text" && typeof event.part?.text === "string") return event.part.text;
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.text === "string") return event.text;
    if (typeof event.part?.text === "string") return event.part.text;
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "pi") {
    if (event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
      return event.assistantMessageEvent.delta;
    }
    if (event.type === "agent_end" && typeof event.result?.text === "string") return event.result.text;
    if (typeof event.text === "string") return event.text;
  }

  return "";
}

function appendPreview(logFile, provider, event) {
  const text = summarizeEventText(provider, event);
  if (!text) return;
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean)
    .slice(0, 10);
  if (lines.length === 0) return;
  const block = lines.join("\n");
  try {
    const existingLines = fs.readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (existingLines.slice(-lines.length).join("\n") === block) {
      return;
    }
  } catch {}
  fs.appendFileSync(logFile, `${block}\n`, "utf8");
}

function buildExecutionEnvelope(execution, result) {
  return {
    provider: execution.provider,
    kind: execution.kind,
    model: execution.model || null,
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    meta: execution.meta || {},
    ...result,
  };
}

async function runForegroundExecution(execution, asJson) {
  const workspaceRoot = resolveWorkspaceRoot(execution.cwd);
  const result = await runProviderPromptStreaming({
    provider: execution.provider,
    prompt: execution.prompt,
    model: execution.model || null,
    cwd: execution.cwd,
    timeout: execution.timeout,
    kind: execution.kind,
    measurementScope: execution.measurementScope || "request",
    meta: execution.meta || null,
    ...(execution.runtimeOptions || {}),
    onEvent() {},
  });
  if (result.timing) {
    appendTimingRecord(workspaceRoot, result.timing);
  }

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
    status: "queued",
    promptPreview: previewText(execution.userPrompt || execution.prompt),
    logFile: resolveJobLogFile(workspaceRoot, jobId),
    createdAt: now,
    updatedAt: now,
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
  const lines = [
    `Job: ${envelope.job.jobId}`,
    `Provider: ${envelope.job.provider}`,
    `Kind: ${envelope.job.kind}`,
    `Status: ${envelope.job.status}`,
  ];
  if (envelope.job.finishedAt) lines.push(`Finished: ${envelope.job.finishedAt}`);
  if (envelope.job.sessionId) lines.push(`Session: ${envelope.job.sessionId}`);
  if (envelope.result?.response) {
    lines.push("");
    lines.push("Response:");
    lines.push(envelope.result.response);
  }
  if (!envelope.result?.response && envelope.result?.error) {
    lines.push("");
    lines.push("Error:");
    lines.push(envelope.result.error);
  }
  return lines.join("\n");
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
    booleanOptions: ["json"],
    valueOptions: ["provider"],
  });

  let providers;
  if (options.provider) {
    providers = [resolveProvider({ provider: options.provider }).provider];
  } else if (positionals[0]) {
    providers = [resolveProvider({ positionals }).provider];
  } else {
    providers = listProviderRuntimes().map((runtime) => runtime.id);
  }

  const results = [];
  for (const provider of providers) {
    const runtime = getProviderRuntime(provider);
    const availability = await Promise.resolve(runtime.getAvailability(process.cwd()));
    const auth = await Promise.resolve(runtime.getAuthStatus(process.cwd()));
    results.push({
      provider,
      available: availability.available ?? false,
      availabilityDetail: availability.detail ?? null,
      loggedIn: auth.loggedIn ?? false,
      authDetail: auth.detail ?? auth.reason ?? null,
      model: auth.model ?? null,
      capabilities: runtime.capabilities,
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

function parsePromptExecution(rawArgs, kind) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait"],
    valueOptions: ["provider", "model"],
    aliasMap: { m: "model" },
  });
  const { provider, remainingPositionals } = resolveProvider({
    provider: options.provider,
    positionals,
  });
  const userPrompt = remainingPositionals.join(" ").trim();
  if (!userPrompt) {
    throw new Error(`Missing prompt text for ${kind}.`);
  }
  return {
    options,
    execution: {
      provider,
      kind,
      prompt: userPrompt,
      userPrompt,
      model: options.model || null,
      cwd: process.cwd(),
      timeout: TIMEOUTS_MS[kind],
      meta: {},
      jobMeta: {},
      measurementScope: "request",
    },
  };
}

async function runAsk(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "ask");
  const { background } = parseExecutionMode(options);
  if (background) {
    await startBackgroundExecution(execution, options.json);
    return;
  }
  await runForegroundExecution(execution, options.json);
}

async function runRescue(rawArgs) {
  const { options, execution } = parsePromptExecution(rawArgs, "rescue");
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
      cwd: process.cwd(),
      timeout: TIMEOUTS_MS[adversarial ? "adversarial-review" : "review"],
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
    output(
      options.json
        ? { ok: true, provider, verdict: "no_changes", scope: reviewContext.scope }
        : "No changes to review.",
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
    output(envelope, true);
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
      process.exitCode = 3;
      return;
    }
    output(positionals[0] ? `Job ${positionals[0]} not found.` : "No active job found to cancel.", false);
    process.exitCode = 3;
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

async function runTiming(rawArgs) {
  const { options } = parseArgs(rawArgs, {
    booleanOptions: ["json"],
    valueOptions: ["provider", "history"],
  });
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const limit = options.history ? Number.parseInt(options.history, 10) : 20;
  const records = listTimingRecords(workspaceRoot, {
    provider: options.provider || null,
    limit: Number.isFinite(limit) ? limit : 20,
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
      cwd: execution.cwd,
      timeout: execution.timeout,
      kind: execution.kind,
      measurementScope: execution.measurementScope || "job",
      meta: execution.meta || null,
      ...(execution.runtimeOptions || {}),
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
          result,
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
  }
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "setup") {
    await runSetup(rawArgs);
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
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = process.exitCode || 1;
});
