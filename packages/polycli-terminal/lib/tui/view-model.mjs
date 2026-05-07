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

function line(width, char = "-") {
  return char.repeat(Math.max(0, width));
}

function fit(value, width) {
  return truncateMiddle(value, width).padEnd(Math.max(0, width), " ");
}

function layoutMode(width, height) {
  if (width < 60 || height < 18) return "compact";
  if (width < 96) return "medium";
  return "wide";
}

function eventLabel(event) {
  return [
    event.at ? String(event.at).slice(11, 19) : "--:--:--",
    event.provider || event.command || "run",
    event.phase || "event",
    event.status || "",
    event.reason ? `(${event.reason})` : "",
  ].filter(Boolean).join(" ");
}

export function buildTuiModel({
  runs = [],
  events = [],
  explanationText = "",
  selectedRunId = null,
  width = 100,
  height = 30,
} = {}) {
  const selected = selectedRunId || runs[0]?.runId || null;
  const selectedEvents = selected ? events.filter((event) => event.runId === selected) : [];
  const providers = classifyProviderStates(selectedEvents);
  const reproductionCommands = [...new Set(
    selectedEvents
      .filter((event) => Array.isArray(event.argv) && event.argv.length > 0)
      .map((event) => formatReproductionCommand(event.argv)),
  )];

  return {
    mode: layoutMode(width, height),
    width,
    height,
    selectedRunId: selected,
    runs,
    events: selectedEvents,
    providers,
    explanationText,
    reproductionCommands,
  };
}

export function renderTuiFrame(input = {}) {
  const model = buildTuiModel(input);
  const width = Math.max(40, model.width);
  const bodyHeight = Math.max(8, model.height - 3);
  const lines = [];

  lines.push(fit("polycli tui inspector", width));
  lines.push(line(width));

  if (model.mode === "compact") {
    lines.push(fit(`run ${model.selectedRunId || "none"}`, width));
  } else {
    lines.push(fit("runs", Math.floor(width / 3)) + fit("provider matrix", width - Math.floor(width / 3)));
  }

  for (const run of model.runs.slice(0, Math.max(2, Math.floor(bodyHeight / 4)))) {
    const marker = run.runId === model.selectedRunId ? ">" : " ";
    lines.push(fit(`${marker} ${run.runId} ${(run.commands || []).join(",")}`, width));
  }

  lines.push(line(width));
  for (const state of Object.values(model.providers).slice(0, 8)) {
    lines.push(fit(`${state.provider} ${state.status}${state.reason ? ` ${state.reason}` : ""}${state.jobId ? ` ${state.jobId}` : ""}`, width));
  }

  lines.push(line(width));
  for (const event of model.events.slice(0, Math.max(3, Math.floor(bodyHeight / 3)))) {
    lines.push(fit(eventLabel(event), width));
  }

  if (model.reproductionCommands.length > 0) {
    lines.push(line(width));
    lines.push(fit(`repro: ${model.reproductionCommands[0]}`, width));
  }

  while (lines.length < model.height - 1) lines.push("");
  lines.push(fit("q quit  up/down select  enter open  b back  r refresh  tab pane  ? help", width));
  return lines.slice(0, model.height).join("\n");
}
