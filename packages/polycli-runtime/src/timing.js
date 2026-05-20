import { TIMING_SCHEMA_VERSION, validateTimingRecord } from "@bbingz/polycli-timing";

import { extractClaudeText } from "./claude.js";
import { extractCopilotText } from "./copilot.js";
import { extractGeminiText } from "./gemini.js";
import { extractKimiText } from "./kimi.js";
import { extractQwenText } from "./qwen.js";
import { extractMiniMaxEventText } from "./minimax.js";
import { extractOpenCodeText } from "./opencode.js";
import { extractPiText } from "./pi.js";
import { extractCmdText } from "./cmd.js";
import { extractAgyText } from "./agy.js";

const TIMING_OUTCOMES = new Set(["success", "failure", "timeout", "terminated", "cancelled"]);

function measuredOrZero(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid measured timing value: ${ms}`);
  }
  if (ms === 0) {
    return { status: "zero", ms: 0 };
  }
  return { status: "measured", ms };
}

function missingMetric() {
  return { status: "missing", ms: null };
}

function unsupportedMetric() {
  return { status: "unsupported", ms: null };
}

function capabilityMetric(ms, supported) {
  if (!supported) {
    return unsupportedMetric();
  }
  if (!Number.isFinite(ms) || ms < 0) {
    return missingMetric();
  }
  return measuredOrZero(ms);
}

function errorText(result) {
  if (typeof result?.error === "string") return result.error;
  if (result?.error?.message) return result.error.message;
  return "";
}

function normalizeExitCode(value) {
  return Number.isInteger(value) ? value : null;
}

function inferTimingOutcome(result) {
  if (result?.ok) return "success";
  const exitCode = normalizeExitCode(result?.status ?? result?.exitCode);
  const text = errorText(result);
  if (result?.timedOut || exitCode === 124 || /\b(timed out|timeout)\b/i.test(text)) return "timeout";
  if (result?.aborted || exitCode === 130 || /\b(interrupted|aborted|cancelled|canceled)\b/i.test(text)) {
    return "cancelled";
  }
  if (result?.signal || exitCode === 143 || /\bterminated\b/i.test(text)) return "terminated";
  return "failure";
}

function inferTerminationReason(result, outcome, exitCode) {
  if (result?.terminationReason) return result.terminationReason;
  if (outcome === "timeout") return "timeout";
  if (outcome === "cancelled") return "cancelled";
  if (result?.signal) return `signal:${result.signal}`;
  if (outcome === "terminated") return "terminated";
  if (exitCode != null && exitCode !== 0) return `exit_code:${exitCode}`;
  return null;
}

function buildTimingDiagnostics(result, explicit = {}) {
  const exitCode = normalizeExitCode(explicit.exitCode ?? result?.status ?? result?.exitCode);
  const outcome = explicit.outcome ?? inferTimingOutcome(result);
  return {
    outcome,
    exitCode,
    terminationReason: explicit.terminationReason ?? inferTerminationReason(result, outcome, exitCode),
    responseMatched: explicit.responseMatched,
    errorCode: explicit.errorCode ?? result?.errorCode,
  };
}

function addStringField(record, key, value) {
  if (typeof value === "string" && value.trim()) {
    record[key] = value;
  }
}

function addIntegerField(record, key, value) {
  if (Number.isInteger(value)) {
    record[key] = value;
  }
}

function addBooleanField(record, key, value) {
  if (typeof value === "boolean") {
    record[key] = value;
  }
}

export function extractProviderEventText(provider, event) {
  if (provider === "claude") return extractClaudeText(event);
  if (provider === "copilot") return extractCopilotText(event);
  if (provider === "gemini") return extractGeminiText(event);
  if (provider === "kimi") return extractKimiText(event);
  if (provider === "qwen") return extractQwenText(event);
  if (provider === "minimax") return extractMiniMaxEventText(event);
  if (provider === "opencode") return extractOpenCodeText(event);
  if (provider === "pi") return extractPiText(event);
  if (provider === "cmd") return extractCmdText(event);
  if (provider === "agy") return extractAgyText(event);
  return "";
}

export function buildPromptTimingRecord({
  provider,
  kind = "prompt",
  runtimePersistence = "ephemeral",
  measurementScope = "request",
  completedAt = new Date().toISOString(),
  totalMs,
  ttftMs = null,
  tailMs = null,
  toolMs = null,
  supportedMetrics = {},
  meta = null,
  outcome = null,
  exitCode = null,
  terminationReason = null,
  responseMatched = null,
  errorCode = null,
} = {}) {
  const metrics = {
    cold: unsupportedMetric(),
    ttft: capabilityMetric(ttftMs, Boolean(supportedMetrics.ttft)),
    gen: capabilityMetric(
      Number.isFinite(ttftMs) ? totalMs - ttftMs : null,
      Boolean(supportedMetrics.gen)
    ),
    tool: capabilityMetric(toolMs, Boolean(supportedMetrics.tool)),
    retry: unsupportedMetric(),
    tail: capabilityMetric(tailMs, Boolean(supportedMetrics.tail)),
    total: measuredOrZero(totalMs),
  };

  const record = {
    version: TIMING_SCHEMA_VERSION,
    provider,
    runtimePersistence,
    measurementScope,
    completedAt,
    kind,
    metrics,
  };

  if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
    record.meta = meta;
  }
  if (TIMING_OUTCOMES.has(outcome)) {
    record.outcome = outcome;
  }
  addIntegerField(record, "exitCode", exitCode);
  addStringField(record, "terminationReason", terminationReason);
  addBooleanField(record, "responseMatched", responseMatched);
  addStringField(record, "errorCode", errorCode);

  const validation = validateTimingRecord(record);
  if (!validation.ok) {
    throw new Error(`Invalid timing record: ${validation.errors.join("; ")}`);
  }

  return record;
}

export function attachPromptTiming(result, {
  provider,
  kind = "prompt",
  runtimePersistence = "ephemeral",
  measurementScope = "request",
  totalMs,
  ttftMs = null,
  tailMs = null,
  toolMs = null,
  supportedMetrics = {},
  meta = null,
  outcome = null,
  exitCode = null,
  terminationReason = null,
  responseMatched = null,
  errorCode = null,
} = {}) {
  const diagnostics = buildTimingDiagnostics(result, {
    outcome,
    exitCode,
    terminationReason,
    responseMatched,
    errorCode,
  });
  return {
    ...result,
    timing: buildPromptTimingRecord({
      provider,
      kind,
      runtimePersistence,
      measurementScope,
      totalMs,
      ttftMs,
      tailMs,
      toolMs,
      supportedMetrics,
      meta,
      ...diagnostics,
      completedAt: new Date().toISOString(),
    }),
  };
}
