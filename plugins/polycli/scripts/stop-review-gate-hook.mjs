#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  getConfig,
  listJobs,
  readLastUsedProvider,
  resolveWorkspaceRoot,
} from "./lib/state.mjs";

const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 60_000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const STOP_REVIEW_SENTINEL_PREFIX = "POLYCLI_STOP_REVIEW_";

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message) {
  if (message) process.stderr.write(`${message}\n`);
}

function resolveCompanionPath() {
  return process.env.POLYCLI_COMPANION_PATH
    || path.join(SCRIPT_DIR, "polycli-companion.bundle.mjs");
}

function loadPromptTemplate(rootDir, name) {
  return fs.readFileSync(path.join(rootDir, "prompts", `${name}.md`), "utf8");
}

function interpolateTemplate(template, variables) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : "";
  });
}

function createStopReviewSentinelToken() {
  return `${STOP_REVIEW_SENTINEL_PREFIX}${randomUUID().replaceAll("-", "")}`;
}

function buildStopReviewPrompt(input = {}, { sentinelToken = createStopReviewSentinelToken() } = {}) {
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
  const claudeResponseBlock = lastAssistantMessage
    ? ["Previous Claude response:", lastAssistantMessage].join("\n")
    : "";
  return interpolateTemplate(template, {
    CLAUDE_RESPONSE_BLOCK: claudeResponseBlock,
    SENTINEL_TOKEN: sentinelToken,
  });
}

export function parseStopReviewOutput(rawOutput, { sentinelToken = null } = {}) {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return {
      ok: false,
      error: "The stop-time Polycli review returned no output. Run /polycli:review --wait manually or bypass the gate.",
    };
  }

  // Scan all lines, but when a per-run token is present, only accept verdicts carrying
  // that token. This keeps compatibility with providers that prefix prose while avoiding
  // stale ALLOW:/BLOCK: lines echoed from the previous Claude response.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (sentinelToken) {
      const allowPrefix = `ALLOW ${sentinelToken}:`;
      const blockPrefix = `BLOCK ${sentinelToken}:`;
      if (trimmed.startsWith(allowPrefix)) return { ok: true, error: null };
      if (trimmed.startsWith(blockPrefix)) {
        const detail = trimmed.slice(blockPrefix.length).trim() || text;
        return { ok: false, error: `Polycli stop-time review found issues: ${detail}` };
      }
      continue;
    }
    if (trimmed.startsWith("ALLOW:")) return { ok: true, error: null };
    if (trimmed.startsWith("BLOCK:")) {
      const detail = trimmed.slice("BLOCK:".length).trim() || text;
      return { ok: false, error: `Polycli stop-time review found issues: ${detail}` };
    }
  }

  return {
    ok: false,
    error: "The stop-time Polycli review returned an unexpected answer (no ALLOW/BLOCK sentinel found). Run /polycli:review --wait manually or bypass the gate.",
  };
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout || "");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return null;
  return JSON.parse(text.slice(jsonStart));
}

export function runStopReview({
  cwd,
  companionPath = resolveCompanionPath(),
  provider,
  input = {},
  timeoutMs = STOP_REVIEW_TIMEOUT_MS,
} = {}) {
  const sentinelToken = createStopReviewSentinelToken();
  const prompt = buildStopReviewPrompt(input, { sentinelToken });
  const result = spawnSync(process.execPath, [companionPath, "ask", "--provider", provider, "--json", prompt], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env },
  });

  if (result.error?.code === "ETIMEDOUT") {
    return {
      ok: true,
      skipped: true,
      note: "The stop-time Polycli review timed out after 15 minutes; skipping the gate so Claude Code can stop.",
    };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      error: detail ? `The stop-time Polycli review failed: ${detail}` : "The stop-time Polycli review failed.",
    };
  }

  try {
    const payload = parseJsonFromStdout(result.stdout);
    if (payload?.response) return parseStopReviewOutput(payload.response, { sentinelToken });
    if (payload?.error) return { ok: false, error: payload.error };
  } catch {
    // fall through
  }

  return { ok: false, error: "The stop-time Polycli review returned invalid output." };
}

function parseHealthPayload(stdout) {
  try {
    return parseJsonFromStdout(stdout);
  } catch {
    return null;
  }
}

export function resolveReviewProvider({
  workspaceRoot,
  companionPath = resolveCompanionPath(),
  cwd = process.cwd(),
} = {}) {
  const lastUsedProvider = readLastUsedProvider(workspaceRoot);
  if (lastUsedProvider) {
    return { provider: lastUsedProvider, source: "last-used", reason: null };
  }

  const result = spawnSync(process.execPath, [companionPath, "health", "--json", "--timeout-ms", String(HEALTH_TIMEOUT_MS)], {
    cwd,
    encoding: "utf8",
    timeout: HEALTH_TIMEOUT_MS + 5_000,
    env: { ...process.env },
  });
  const payload = parseHealthPayload(result.stdout);
  const provider = Array.isArray(payload?.healthyProviders) ? payload.healthyProviders[0] : null;
  if (provider) {
    return { provider, source: "health", reason: null };
  }

  return {
    provider: null,
    source: "none",
    reason: "No current provider could be resolved for the stop-review gate; no last-used provider is recorded and health found no healthy providers. Skipping so Claude Code can stop.",
  };
}

function sortJobsNewestFirst(jobs) {
  return jobs
    .slice()
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}

function findRunningJob(workspaceRoot) {
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  return jobs.find((job) => job.status === "queued" || job.status === "running") || null;
}

export function handleStopHook(input = {}) {
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);
  const companionPath = resolveCompanionPath();

  const runningJob = findRunningJob(workspaceRoot);
  const runningNote = runningJob
    ? `Polycli job ${runningJob.jobId} is still running. Check /polycli:status ${runningJob.jobId}.`
    : null;

  if (!config.stopReviewGate) {
    logNote(runningNote);
    return;
  }

  const providerResult = resolveReviewProvider({ workspaceRoot, companionPath, cwd });
  if (!providerResult.provider) {
    logNote(providerResult.reason);
    logNote(runningNote);
    return;
  }

  const review = runStopReview({
    cwd,
    companionPath,
    provider: providerResult.provider,
    input,
  });
  if (review.skipped) {
    logNote(review.note);
    logNote(runningNote);
    return;
  }
  if (!review.ok) {
    emitDecision({
      decision: "block",
      reason: runningNote ? `${runningNote} ${review.error}` : review.error,
    });
    return;
  }

  logNote(runningNote);
}

function main() {
  handleStopHook(readHookInput());
}

if (process.argv[1] && process.argv[1].endsWith("stop-review-gate-hook.mjs")) {
  try {
    main();
  } catch (err) {
    process.stderr.write(
      `[polycli stop-review-gate-hook] fatal: ${err && err.message ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}
