const TERMINAL_DECISION_STATUSES = new Set(["adopted", "failed", "skipped", "cancelled"]);
const TERMINAL_ATTEMPT_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function truncateMiddle(value, width) {
  const text = String(value ?? "");
  if (!Number.isFinite(width) || width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return ".".repeat(width);
  const left = Math.ceil((width - 3) / 2);
  const right = Math.floor((width - 3) / 2);
  return `${text.slice(0, left)}...${text.slice(text.length - right)}`;
}

function shellQuote(token) {
  const text = String(token);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function formatReproductionCommand(argv = []) {
  if (!Array.isArray(argv) || argv.length === 0) return "not recorded";
  return ["polycli", ...argv].map(shellQuote).join(" ");
}

function emptyState(provider) {
  return {
    provider,
    status: "unknown",
    reason: null,
    jobId: null,
    logFile: null,
    model: null,
    timingRef: null,
    preview: null,
    lastEventAt: null,
  };
}

function mergeEvent(state, event) {
  return {
    ...state,
    jobId: event.jobId ?? state.jobId,
    logFile: event.logFile ?? state.logFile,
    model: event.model ?? state.model,
    timingRef: event.timingRef ?? state.timingRef,
    preview: event.preview ?? state.preview,
    lastEventAt: event.at ?? state.lastEventAt,
  };
}

export function classifyProviderStates(events = []) {
  const states = {};
  const hasTerminal = new Set();
  const hasStarted = new Set();

  for (const event of events) {
    if (!event?.provider) continue;
    const provider = event.provider;
    states[provider] = mergeEvent(states[provider] || emptyState(provider), event);

    if (event.phase === "provider_decision" && TERMINAL_DECISION_STATUSES.has(event.status)) {
      hasTerminal.add(provider);
      states[provider] = {
        ...states[provider],
        status: event.status,
        reason: event.reason ?? null,
      };
      continue;
    }

    if (event.phase === "attempt_result" && TERMINAL_ATTEMPT_STATUSES.has(event.status)) {
      hasTerminal.add(provider);
      states[provider] = {
        ...states[provider],
        status: event.status === "completed" ? "completed" : event.status,
        reason: event.reason ?? states[provider].reason,
      };
      continue;
    }

    if (event.phase === "job_started" || event.phase === "attempt_started") {
      hasStarted.add(provider);
    }
  }

  for (const provider of hasStarted) {
    if (!hasTerminal.has(provider)) {
      states[provider] = {
        ...(states[provider] || emptyState(provider)),
        status: "unfinished",
      };
    }
  }

  return states;
}
