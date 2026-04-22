import { TIMING_SCHEMA_VERSION, validateTimingRecord } from "@bbingz/polycli-timing";

import { extractClaudeText } from "./claude.js";
import { extractCopilotText } from "./copilot.js";
import { extractGeminiText } from "./gemini.js";
import { extractKimiText } from "./kimi.js";
import { extractQwenText } from "./qwen.js";
import { extractMiniMaxEventText } from "./minimax.js";
import { extractOpenCodeText } from "./opencode.js";
import { extractPiText } from "./pi.js";

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
  if (!Number.isFinite(ms)) {
    return missingMetric();
  }
  return measuredOrZero(ms);
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
} = {}) {
  const metrics = {
    cold: unsupportedMetric(),
    ttft: capabilityMetric(ttftMs, Boolean(supportedMetrics.ttft)),
    gen: capabilityMetric(
      Number.isFinite(ttftMs) ? Math.max(totalMs - ttftMs, 0) : null,
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
} = {}) {
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
      completedAt: new Date().toISOString(),
    }),
  };
}
