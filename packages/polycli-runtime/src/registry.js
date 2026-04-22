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
import { attachPromptTiming, extractProviderEventText } from "./timing.js";

const TIMING_SUPPORT = {
  claude: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  copilot: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  gemini: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  kimi: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  qwen: { ttft: true, gen: true, tail: true, tool: true, runtimePersistence: "session" },
  minimax: { ttft: false, gen: false, tail: false, tool: false, runtimePersistence: "ephemeral" },
  opencode: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
  pi: { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" },
};

const RUNTIMES = {
  claude: {
    id: "claude",
    capabilities: {
      streaming: true,
      sessionResume: true,
      structuredOutput: true,
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
      structuredOutput: false,
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
      operations: PROVIDER_OPERATION_NAMES,
    },
    getAvailability: getPiAvailability,
    getAuthStatus: getPiAuthStatus,
    runPrompt: runPiPrompt,
    runPromptStreaming: runPiPromptStreaming,
  },
};

function getTimingSupport(provider) {
  return TIMING_SUPPORT[provider] || {
    ttft: false,
    gen: false,
    tail: false,
    tool: false,
    runtimePersistence: "ephemeral",
  };
}

function inferRuntimePersistence(provider, result) {
  const support = getTimingSupport(provider);
  if (support.runtimePersistence === "session" && result?.sessionId) {
    return "session";
  }
  return "ephemeral";
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
  if (provider === "copilot") {
    return event.type === "assistant.message" || event.type === "result" || event.type === "final";
  }
  if (provider === "pi") {
    return event.type === "agent_end";
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

export async function runProviderPrompt({
  provider,
  kind = "prompt",
  measurementScope = "request",
  meta = null,
  ...options
}) {
  const startedAt = Date.now();
  const result = await getProviderRuntime(provider).runPrompt(options);
  const runtimePersistence = inferRuntimePersistence(provider, result);
  return attachPromptTiming(result, {
    provider,
    kind,
    runtimePersistence,
    measurementScope,
    totalMs: Date.now() - startedAt,
    supportedMetrics: getTimingSupport(provider),
    meta,
  });
}

export async function runProviderPromptStreaming({
  provider,
  kind = "prompt",
  measurementScope = "request",
  meta = null,
  onEvent,
  ...options
}) {
  const startedAt = Date.now();
  const timingSupport = getTimingSupport(provider);
  let firstTextAt = null;
  let lastTextAt = null;
  const toolState = { pendingTools: new Map(), toolMs: null };

  const result = await getProviderRuntime(provider).runPromptStreaming({
    ...options,
    onEvent(event) {
      const now = Date.now();
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

  const finishedAt = Date.now();
  const runtimePersistence = inferRuntimePersistence(provider, result);
  return attachPromptTiming(result, {
    provider,
    kind,
    runtimePersistence,
    measurementScope,
    totalMs: finishedAt - startedAt,
    ttftMs: firstTextAt == null ? null : firstTextAt - startedAt,
    tailMs: lastTextAt == null ? null : Math.max(finishedAt - lastTextAt, 0),
    toolMs: toolState.toolMs,
    supportedMetrics: timingSupport,
    meta,
  });
}
