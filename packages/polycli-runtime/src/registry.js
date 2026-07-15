import { performance } from "node:perf_hooks";

import { PROVIDER_IDS, PROVIDER_OPERATION_NAMES } from "./constants.js";
import {
  getClaudeAvailability,
  getClaudeAuthStatus,
  runClaudePrompt,
  runClaudePromptStreaming,
} from "./claude.js";
import {
  getCopilotAvailability,
  getCopilotAuthStatus,
  runCopilotPrompt,
  runCopilotPromptStreaming,
} from "./copilot.js";
import {
  getGeminiAvailability,
  getGeminiAuthStatus,
  runGeminiPrompt,
  runGeminiPromptStreaming,
} from "./gemini.js";
import {
  getKimiAvailability,
  getKimiAuthStatus,
  runKimiPrompt,
  runKimiPromptStreaming,
} from "./kimi.js";
import {
  getQwenAvailability,
  getQwenAuthStatus,
  runQwenPrompt,
  runQwenPromptStreaming,
} from "./qwen.js";
import {
  getMiniMaxAvailability,
  getMiniMaxAuthStatus,
  runMiniMaxPrompt,
  runMiniMaxPromptStreaming,
} from "./minimax.js";
import {
  getOpenCodeAvailability,
  getOpenCodeAuthStatus,
  runOpenCodePrompt,
  runOpenCodePromptStreaming,
} from "./opencode.js";
import {
  getPiAvailability,
  getPiAuthStatus,
  runPiPrompt,
  runPiPromptStreaming,
} from "./pi.js";
import {
  getCmdAvailability,
  getCmdAuthStatus,
  runCmdPrompt,
  runCmdPromptStreaming,
} from "./cmd.js";
import {
  getAgyAvailability,
  getAgyAuthStatus,
  runAgyPrompt,
  runAgyPromptStreaming,
} from "./agy.js";
import {
  getGrokAvailability,
  getGrokAuthStatus,
  runGrokPrompt,
  runGrokPromptStreaming,
} from "./grok.js";
import { attachPromptTiming, extractProviderEventText } from "./timing.js";
import { REVIEW_FLAG_EXPECTATIONS } from "./review-flags.js";

const TIMING_SUPPORT = {
  claude: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  copilot: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  gemini: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  kimi: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  qwen: { ttft: true, gen: true, tail: true, tool: true, runtimePersistence: "session" },
  minimax: { ttft: false, gen: false, tail: false, tool: false, runtimePersistence: "ephemeral" },
  opencode: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  pi: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  cmd: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "ephemeral" },
  agy: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  grok: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
};

const RUNTIMES = Object.freeze({
  claude: {
    id: "claude",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "status",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getClaudeAvailability,
    getAuthStatus: getClaudeAuthStatus,
    runPrompt: runClaudePrompt,
    runPromptStreaming: runClaudePromptStreaming,
  },
  copilot: {
    id: "copilot",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getCopilotAvailability,
    getAuthStatus: getCopilotAuthStatus,
    runPrompt: runCopilotPrompt,
    runPromptStreaming: runCopilotPromptStreaming,
  },
  gemini: {
    id: "gemini",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getGeminiAvailability,
    getAuthStatus: getGeminiAuthStatus,
    runPrompt: runGeminiPrompt,
    runPromptStreaming: runGeminiPromptStreaming,
  },
  kimi: {
    id: "kimi",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getKimiAvailability,
    getAuthStatus: getKimiAuthStatus,
    runPrompt: runKimiPrompt,
    runPromptStreaming: runKimiPromptStreaming,
  },
  qwen: {
    id: "qwen",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getQwenAvailability,
    getAuthStatus: getQwenAuthStatus,
    runPrompt: runQwenPrompt,
    runPromptStreaming: runQwenPromptStreaming,
  },
  minimax: {
    id: "minimax",
    capabilities: {
      streaming: true,
      sessionResume: false,
      structuredOutput: true,
      authProbeCost: "status",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getMiniMaxAvailability,
    getAuthStatus: getMiniMaxAuthStatus,
    runPrompt: runMiniMaxPrompt,
    runPromptStreaming: runMiniMaxPromptStreaming,
  },
  opencode: {
    id: "opencode",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getOpenCodeAvailability,
    getAuthStatus: getOpenCodeAuthStatus,
    runPrompt: runOpenCodePrompt,
    runPromptStreaming: runOpenCodePromptStreaming,
  },
  pi: {
    id: "pi",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getPiAvailability,
    getAuthStatus: getPiAuthStatus,
    runPrompt: runPiPrompt,
    runPromptStreaming: runPiPromptStreaming,
  },
  cmd: {
    id: "cmd",
    capabilities: {
      streaming: true,
      sessionResume: false,
      structuredOutput: false,
      authProbeCost: "status",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getCmdAvailability,
    getAuthStatus: getCmdAuthStatus,
    runPrompt: runCmdPrompt,
    runPromptStreaming: runCmdPromptStreaming,
  },
  agy: {
    id: "agy",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: false,
      authProbeCost: "model",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getAgyAvailability,
    getAuthStatus: getAgyAuthStatus,
    runPrompt: runAgyPrompt,
    runPromptStreaming: runAgyPromptStreaming,
  },
  grok: {
    id: "grok",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
      authProbeCost: "status",
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getGrokAvailability,
    getAuthStatus: getGrokAuthStatus,
    runPrompt: runGrokPrompt,
    runPromptStreaming: runGrokPromptStreaming,
  },
});

for (const runtime of Object.values(RUNTIMES)) {
  Object.freeze(runtime.capabilities);
  Object.freeze(runtime);
}

function getTimingSupport(provider) {
  return TIMING_SUPPORT[provider] || {
    ttft: false,
    gen: false,
    tail: false,
    tool: false,
    runtimePersistence: "ephemeral",
  };
}

function getTimingSupportForRun(provider, options = {}) {
  const support = getTimingSupport(provider);
  if (provider === "claude" && options.executionMode === "tmux-tui") {
    return { ...support, ttft: false, gen: false, tail: false };
  }
  return support;
}

function inferRuntimePersistence(provider, result) {
  const support = getTimingSupport(provider);
  return support.runtimePersistence;
}

function buildTimingMeta(provider, result, meta, support = getTimingSupport(provider)) {
  const merged = {
    ...(meta || {}),
    ...(result?.timingMeta || {}),
  };

  if (provider === "claude" && result?.detached === true) {
    merged.tmuxDetached = true;
    merged.timingScope = merged.timingScope || "tmux_startup";
    merged.llmCompletionObserved = false;
  }

  if (support.runtimePersistence === "session" && !result?.sessionId) {
    merged.sessionIdMissing = true;
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

function trackQwenToolTiming(event, timestamp, state) {
  if (event?.type !== "assistant" || !Array.isArray(event.message?.content)) {
    return;
  }

  for (const block of event.message.content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "tool_use" && block.id && !state.pendingTools.has(block.id)) {
      state.pendingTools.set(block.id, timestamp);
      continue;
    }
    if (block.type !== "tool_result" || !block.tool_use_id) continue;
    const startedAt = state.pendingTools.get(block.tool_use_id);
    if (startedAt == null) continue;
    state.pendingTools.delete(block.tool_use_id);
    state.toolMs = (state.toolMs ?? 0) + Math.max(timestamp - startedAt, 0);
  }
}

function isTerminalSummaryEvent(provider, event) {
  if (!event || typeof event !== "object") {
    return false;
  }
  if (provider === "qwen" || provider === "claude" || provider === "opencode") {
    return event.type === "result";
  }
  if (provider === "gemini") {
    return event.type === "result";
  }
  if (provider === "copilot") {
    return event.type === "assistant.message" || event.type === "result" || event.type === "final";
  }
  if (provider === "pi") {
    return event.type === "agent_end";
  }
  if (provider === "grok") {
    return event.type === "end";
  }
  return false;
}

function shouldCountEventTextForTiming(provider, event, firstTextAt) {
  if (firstTextAt == null) {
    return true;
  }
  return !isTerminalSummaryEvent(provider, event);
}

export function getProviderRuntime(providerId) {
  const runtime = RUNTIMES[providerId];
  if (!runtime) {
    throw new Error(`Unknown provider runtime: ${providerId}`);
  }
  return runtime;
}

export function listProviderRuntimes() {
  return PROVIDER_IDS.map((providerId) => getProviderRuntime(providerId));
}

/**
 * Return static provider metadata for offline command discovery.
 *
 * This deliberately copies only public, JSON-safe capability fields. It does
 * not invoke availability/auth probes and does not expose invocation flags or
 * operational state.
 */
export function describeProviderRuntimes() {
  return PROVIDER_IDS.map((providerId) => {
    const runtime = getProviderRuntime(providerId);
    const timingSupport = getTimingSupport(providerId);
    const reviewExpectation = REVIEW_FLAG_EXPECTATIONS[providerId];
    const reviewSupported = reviewExpectation.reviewSafety !== "unsupported";

    return {
      id: providerId,
      runtimeOperations: [...runtime.capabilities.operations],
      commandSupport: {
        setup: true,
        health: true,
        ask: true,
        rescue: true,
        review: reviewSupported,
        adversarialReview: reviewSupported,
      },
      capabilities: {
        streaming: runtime.capabilities.streaming,
        sessionResume: runtime.capabilities.sessionResume,
        structuredOutput: runtime.capabilities.structuredOutput,
        authProbeCost: runtime.capabilities.authProbeCost,
        runtimePersistence: timingSupport.runtimePersistence,
        timing: {
          ttft: timingSupport.ttft,
          gen: timingSupport.gen,
          tail: timingSupport.tail,
          tool: timingSupport.tool,
        },
      },
      reviewSafety: {
        mode: reviewExpectation.reviewSafety,
        stopReviewGate: reviewExpectation.stopReviewGateSafety,
      },
    };
  });
}

function applyModelFallback(result, { model = null, defaultModel = null } = {}) {
  if (result.model) return result;
  const fallbackModel = model || defaultModel;
  return fallbackModel ? { ...result, model: fallbackModel } : result;
}

export async function runProviderPrompt({
  provider,
  kind = "prompt",
  measurementScope = "request",
  meta = null,
  defaultModel = null,
  nowMs = () => performance.now(),
  runtime = null,
  ...options
}) {
  const startedAt = nowMs();
  const timingSupport = getTimingSupportForRun(provider, options);
  const selectedRuntime = runtime ?? getProviderRuntime(provider);
  const result = await selectedRuntime.runPrompt({ ...options, defaultModel });
  const runtimePersistence = inferRuntimePersistence(provider, result);
  const resultWithModel = applyModelFallback(result, {
    model: options.model,
    defaultModel,
  });
  return attachPromptTiming(resultWithModel, {
    provider,
    kind,
    runtimePersistence,
    measurementScope,
    totalMs: Math.max(nowMs() - startedAt, 0),
    supportedMetrics: timingSupport,
    meta: buildTimingMeta(provider, result, meta, timingSupport),
  });
}

export async function runProviderPromptStreaming({
  provider,
  kind = "prompt",
  measurementScope = "request",
  meta = null,
  defaultModel = null,
  onEvent,
  nowMs = () => performance.now(),
  runtime = null,
  ...options
}) {
  const startedAt = nowMs();
  const timingSupport = getTimingSupportForRun(provider, options);
  const selectedRuntime = runtime ?? getProviderRuntime(provider);
  let firstTextAt = null;
  let lastTextAt = null;
  const toolState = { pendingTools: new Map(), toolMs: null };

  const result = await selectedRuntime.runPromptStreaming({
    ...options,
    defaultModel,
    onEvent(event) {
      const now = nowMs();
      const eventText = extractProviderEventText(provider, event);
      if ((timingSupport.ttft || timingSupport.tail) && eventText.trim() && shouldCountEventTextForTiming(provider, event, firstTextAt)) {
        if (firstTextAt == null) {
          firstTextAt = now;
        }
        lastTextAt = now;
      }
      if (timingSupport.tool && provider === "qwen") {
        trackQwenToolTiming(event, now, toolState);
      }
      if (typeof onEvent === "function") {
        onEvent(event);
      }
    },
  });

  const finishedAt = nowMs();
  const resultWithModel = applyModelFallback(result, {
    model: options.model,
    defaultModel,
  });
  const runtimePersistence = inferRuntimePersistence(provider, resultWithModel);
  return attachPromptTiming(resultWithModel, {
    provider,
    kind,
    runtimePersistence,
    measurementScope,
    totalMs: finishedAt - startedAt,
    ttftMs: firstTextAt == null ? null : firstTextAt - startedAt,
    tailMs: lastTextAt == null ? null : Math.max(finishedAt - lastTextAt, 0),
    toolMs: toolState.toolMs,
    supportedMetrics: timingSupport,
    meta: buildTimingMeta(provider, result, meta, timingSupport),
  });
}
