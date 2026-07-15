import { parseArgs } from "@bbingz/polycli-utils/args";

export const COMMAND_SURFACE_VERSION = 1;

const SHARED_SURFACES = Object.freeze([
  "claude-plugin",
  "codex-skill",
  "copilot-skill",
  "opencode-plugin",
  "terminal",
]);

const TERMINAL_SURFACE = Object.freeze(["terminal"]);
const INTERNAL_SURFACE = Object.freeze(["internal"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function option(name, type, description, extras = {}) {
  const aliases = extras.aliases ?? [];
  const valueName = extras.valueName ?? name;
  const forms = extras.forms ?? [
    type === "boolean" ? `--${name}` : `--${name} <${valueName}>`,
    ...aliases.map((alias) => type === "boolean" ? `-${alias}` : `-${alias} <${valueName}>`),
  ];
  return {
    name,
    aliases,
    type,
    forms,
    required: extras.required ?? false,
    repeatable: extras.repeatable ?? false,
    default: extras.default ?? null,
    enumValues: extras.enumValues ?? null,
    enumSource: extras.enumSource ?? null,
    description,
    conflictsWith: extras.conflictsWith ?? [],
    requires: extras.requires ?? [],
    sensitive: extras.sensitive ?? false,
    visibility: extras.visibility ?? "public",
    minimum: extras.minimum ?? null,
    maximum: extras.maximum ?? null,
  };
}

function positional(name, description, extras = {}) {
  return {
    name,
    description,
    required: extras.required ?? false,
    variadic: extras.variadic ?? false,
    sensitive: extras.sensitive ?? false,
    role: extras.role ?? "value",
  };
}

const HELP_OPTION = option("help", "boolean", "Show command-specific help.", { aliases: ["h"] });
const JSON_OPTION = option("json", "boolean", "Emit the legacy JSON contract.");
const JSON_V2_OPTION = option("json-v2", "boolean", "Emit the versioned JSON envelope contract.", {
  conflictsWith: ["json"],
});
const RUN_ID_OPTION = option("run-id", "string", "Join this invocation to a run correlation id.", { valueName: "id" });

const V2_RESULT_SCHEMA_BY_COMMAND = Object.freeze({
  setup: "polycli.result.provider.setup.v2",
  health: "polycli.result.provider.health.v2",
  ask: "polycli.result.provider-command.v2",
  rescue: "polycli.result.provider-command.v2",
  review: "polycli.result.provider-command.v2",
  "adversarial-review": "polycli.result.provider-command.v2",
  status: "polycli.result.job-status-command.v2",
  result: "polycli.result.job.result.v2",
  cancel: "polycli.result.job.cancel.v2",
  timing: "polycli.result.timing.report.v2",
  "debug.runs": "polycli.result.ledger.run-list.v2",
  "debug.show": "polycli.result.ledger.run-events.v2",
  "debug.explain": "polycli.result.ledger.explanation.v2",
  "debug.tail": "polycli.result.ledger.tail.v2",
  "sessions.list": "polycli.result.session.list.v2",
  "sessions.purge": "polycli.result.session.purge.v2",
});

function definition({
  id,
  path,
  summary,
  usage,
  argumentMode = "options",
  surfaces = SHARED_SURFACES,
  dispatchTarget = "companion",
  visibility = "public",
  executable = true,
  defaultSubcommand = null,
  runTracked = false,
  effects = {},
  options = [],
  positionals = [],
  constraints = [],
  examples = [],
  outputs = null,
  errors = [],
  exitCodes = [0, 1],
}) {
  const resolvedOutputs = outputs && V2_RESULT_SCHEMA_BY_COMMAND[id]
    ? { ...outputs, jsonV2: V2_RESULT_SCHEMA_BY_COMMAND[id] }
    : outputs;
  const globalOptions = visibility === "public" ? [HELP_OPTION] : [];
  if (resolvedOutputs?.jsonV1) {
    globalOptions.push(resolvedOutputs?.jsonV2
      ? { ...JSON_OPTION, conflictsWith: ["json-v2"] }
      : JSON_OPTION);
  }
  if (resolvedOutputs?.jsonV2) globalOptions.push(JSON_V2_OPTION);
  if (runTracked) globalOptions.push(RUN_ID_OPTION);
  return {
    id,
    path,
    aliases: [],
    visibility,
    surfaces,
    dispatchTarget,
    executable,
    defaultSubcommand,
    summary,
    usage,
    argumentMode,
    runTracked,
    effects: {
      providerInvocation: false,
      readsWorkspace: false,
      writesLocalState: false,
      destructive: false,
      ...effects,
    },
    options: [...globalOptions, ...options],
    positionals,
    constraints,
    examples,
    outputs: resolvedOutputs,
    errors,
    exitCodes,
  };
}

const LEGACY_OBJECT_OUTPUT = Object.freeze({
  text: "text.v1",
  jsonV1: "legacy.object.v1",
  jsonV2: null,
});

const LEGACY_ARRAY_OUTPUT = Object.freeze({
  text: "text.v1",
  jsonV1: "legacy.array.v1",
  jsonV2: null,
});

const AGENT_CONTEXT_OUTPUT = Object.freeze({
  text: "text.v1",
  jsonV1: "polycli.agent-context.v1",
  jsonV2: null,
});

const PROVIDER_OPTION = option("provider", "string", "Provider id; may also be the first positional.", {
  enumSource: "providers",
  valueName: "provider",
});
const MODEL_OPTION = option("model", "string", "Override the provider model.", {
  aliases: ["m"],
  valueName: "model",
});
const BACKGROUND_OPTION = option("background", "boolean", "Launch a durable background job.", {
  conflictsWith: ["wait"],
});
const WAIT_OPTION = option("wait", "boolean", "Run in the foreground or wait for a selected job.", {
  conflictsWith: ["background"],
});

const PROMPT_OPTIONS = [
  PROVIDER_OPTION,
  MODEL_OPTION,
  BACKGROUND_OPTION,
  WAIT_OPTION,
  option("resume-last", "boolean", "Resume the provider's latest session where supported.", {
    conflictsWith: ["resume", "fresh"],
  }),
  option("fresh", "boolean", "Force a fresh provider session where supported.", {
    conflictsWith: ["resume", "resume-last"],
  }),
  option("write", "boolean", "Allow provider write mode where explicitly supported."),
  option("resume", "string", "Resume an explicit provider session.", {
    valueName: "session-id",
    conflictsWith: ["resume-last", "fresh"],
  }),
  option("effort", "enum", "Provider reasoning effort.", {
    enumValues: ["low", "medium", "high"],
    valueName: "level",
  }),
];

const REVIEW_OPTIONS = [
  PROVIDER_OPTION,
  MODEL_OPTION,
  BACKGROUND_OPTION,
  WAIT_OPTION,
  option("base", "string", "Base revision for branch review.", { valueName: "ref" }),
  option("scope", "enum", "Diff scope.", {
    enumValues: ["auto", "staged", "unstaged", "working-tree", "branch"],
    valueName: "scope",
  }),
  option("max-diff-bytes", "integer", "Maximum diff bytes included in the review prompt.", { valueName: "n", minimum: 0 }),
];

const COMMON_ERRORS = ["invalid_argument", "unknown_command", "unknown_subcommand", "internal_error"];

export const COMMAND_DEFINITIONS = deepFreeze([
  definition({
    id: "agent-context",
    path: ["agent-context"],
    summary: "Describe the installed Polycli command and provider contract without probes.",
    usage: "polycli agent-context [--json]",
    effects: {},
    options: [],
    examples: [{ argv: ["agent-context", "--json"], description: "Emit deterministic machine discovery." }],
    outputs: AGENT_CONTEXT_OUTPUT,
    errors: COMMON_ERRORS,
  }),
  definition({
    id: "setup",
    path: ["setup"],
    summary: "Inspect provider setup and configure the local review gate.",
    usage: "polycli setup [provider] [options]",
    argumentMode: "provider-optional",
    runTracked: true,
    effects: { providerInvocation: true, readsWorkspace: true, writesLocalState: true },
    options: [
      PROVIDER_OPTION,
      option("probe-auth", "boolean", "Run the provider auth probe."),
      option("enable-review-gate", "boolean", "Enable the workspace stop-review gate.", { conflictsWith: ["disable-review-gate"] }),
      option("disable-review-gate", "boolean", "Disable the workspace stop-review gate.", { conflictsWith: ["enable-review-gate"] }),
    ],
    positionals: [positional("provider", "Optional provider id.", { role: "provider" })],
    examples: [{ argv: ["setup", "--provider", "qwen", "--json"], description: "Inspect one provider." }],
    outputs: LEGACY_ARRAY_OUTPUT,
    errors: [...COMMON_ERRORS, "unknown_provider", "provider_failed", "ledger_persist_failed"],
  }),
  definition({
    id: "health",
    path: ["health"],
    summary: "Probe provider availability and a bounded health prompt.",
    usage: "polycli health [provider] [options]",
    argumentMode: "provider-optional",
    runTracked: true,
    effects: { providerInvocation: true, readsWorkspace: true, writesLocalState: true },
    options: [
      PROVIDER_OPTION,
      MODEL_OPTION,
      option("timeout-ms", "integer", "Health probe timeout in milliseconds.", { valueName: "ms", minimum: 1 }),
    ],
    positionals: [positional("provider", "Optional provider id.", { role: "provider" })],
    examples: [{ argv: ["health", "--provider", "qwen", "--json"], description: "Probe one provider." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "unknown_provider", "ledger_persist_failed"],
    exitCodes: [0, 1, 2],
  }),
  ...["ask", "rescue"].map((id) => definition({
    id,
    path: [id],
    summary: id === "ask" ? "Ask one provider a prompt." : "Ask one provider to rescue a difficult task.",
    usage: `polycli ${id} [provider] [options] <prompt...>`,
    argumentMode: "provider-prompt-tail",
    runTracked: true,
    effects: { providerInvocation: true, readsWorkspace: true, writesLocalState: true },
    options: PROMPT_OPTIONS,
    positionals: [
      positional("provider-or-prompt", "Provider id when --provider is omitted, otherwise prompt text.", { role: "provider-or-prompt", sensitive: true }),
      positional("prompt", "Prompt text.", { required: true, variadic: true, sensitive: true, role: "prompt" }),
    ],
    constraints: [{ kind: "conflicts", options: ["background", "wait"] }],
    examples: [{ argv: [id, "--provider", "qwen", "Reply with only OK"], description: "Run one foreground prompt." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "missing_provider", "unknown_provider", "missing_prompt", "provider_failed", "ledger_persist_failed"],
  })),
  ...["review", "adversarial-review"].map((id) => definition({
    id,
    path: [id],
    summary: id === "review" ? "Review the selected Git diff read-only." : "Run an adversarial read-only review of the selected Git diff.",
    usage: `polycli ${id} [provider] [options] [focus...]`,
    argumentMode: "provider-focus-tail",
    runTracked: true,
    effects: { providerInvocation: true, readsWorkspace: true, writesLocalState: true },
    options: REVIEW_OPTIONS,
    positionals: [
      positional("provider-or-focus", "Provider id when --provider is omitted, otherwise review focus.", { role: "provider-or-prompt", sensitive: true }),
      positional("focus", "Optional review focus.", { variadic: true, sensitive: true, role: "prompt" }),
    ],
    constraints: [{ kind: "conflicts", options: ["background", "wait"] }],
    examples: [{ argv: [id, "--provider", "claude", "--scope", "staged"], description: "Review staged changes." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "missing_provider", "unknown_provider", "invalid_scope", "provider_failed", "ledger_persist_failed"],
  })),
  definition({
    id: "status",
    path: ["status"],
    summary: "Inspect or wait for background jobs in the current workspace.",
    usage: "polycli status [job-selector] [--job <selector>] [--all] [--wait] [--for <state>] [--timeout-ms <ms>] [--json|--json-v2]",
    argumentMode: "job-optional",
    effects: { readsWorkspace: true, writesLocalState: true },
    options: [
      option("job", "string", "Typed job selector.", { valueName: "selector", conflictsWith: ["all"] }),
      option("all", "boolean", "Show all retained jobs.", { conflictsWith: ["job", "for"] }),
      option("wait", "boolean", "Wait for selected jobs to reach terminal state."),
      option("for", "enum", "Requested terminal state for a selected wait.", {
        enumValues: ["terminal", "completed", "failed", "cancelled"],
        valueName: "state",
        default: "terminal",
        requires: ["wait"],
        conflictsWith: ["all"],
      }),
      option("timeout-ms", "integer", "Wait timeout in milliseconds.", { valueName: "ms", requires: ["wait"], minimum: 1 }),
    ],
    positionals: [positional("job-selector", "Optional legacy exact or unique-prefix selector.", { role: "job" })],
    examples: [{ argv: ["status", "--job", "latest-active", "--wait", "--for", "terminal", "--json-v2"], description: "Wait for one selected job." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "job_not_found", "ambiguous_selector", "no_active_job", "no_completed_job"],
    exitCodes: [0, 1, 2],
  }),
  definition({
    id: "result",
    path: ["result"],
    summary: "Read one terminal background job result.",
    usage: "polycli result [job-selector] [--job <selector>] [--json|--json-v2]",
    argumentMode: "job-optional",
    effects: { readsWorkspace: true, writesLocalState: true },
    options: [option("job", "string", "Typed job selector.", { valueName: "selector" })],
    positionals: [positional("job-selector", "Optional legacy exact or unique-prefix selector.", { role: "job" })],
    examples: [{ argv: ["result", "--job", "latest-terminal", "--json-v2"], description: "Read the latest terminal result." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "job_not_found", "ambiguous_selector", "no_completed_job"],
  }),
  definition({
    id: "cancel",
    path: ["cancel"],
    summary: "Cancel one active background job safely.",
    usage: "polycli cancel [job-selector] [--job <selector>] [--json|--json-v2]",
    argumentMode: "job-optional",
    effects: { readsWorkspace: true, writesLocalState: true },
    options: [option("job", "string", "Typed job selector.", { valueName: "selector" })],
    positionals: [positional("job-selector", "Optional legacy exact or unique-prefix selector.", { role: "job" })],
    constraints: [{ kind: "targetsActiveJob" }],
    examples: [{ argv: ["cancel", "--job", "latest-active", "--json-v2"], description: "Cancel the latest active job." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "job_not_found", "ambiguous_selector", "no_active_job", "worker_identity_unverified", "cancel_failed"],
    exitCodes: [0, 1, 4, 5],
  }),
  definition({
    id: "timing",
    path: ["timing"],
    summary: "Read timing history and aggregates.",
    usage: "polycli timing [--provider <provider>] [--history <count|all>] [--all] [--json|--json-v2]",
    effects: { readsWorkspace: true },
    options: [
      PROVIDER_OPTION,
      option("history", "string", "History count or all.", { valueName: "count|all" }),
      option("all", "boolean", "Include all provider histories."),
    ],
    examples: [{ argv: ["timing", "--provider", "qwen", "--history", "20", "--json"], description: "Read one provider history." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "unknown_provider"],
  }),
  definition({
    id: "debug",
    path: ["debug"],
    summary: "Inspect the redacted run ledger.",
    usage: "polycli debug <runs|show|explain|tail> ...",
    executable: false,
    defaultSubcommand: "runs",
    effects: { readsWorkspace: true },
    examples: [{ argv: ["debug", "runs", "--json"], description: "List recent runs." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: COMMON_ERRORS,
  }),
  definition({
    id: "debug.runs",
    path: ["debug", "runs"],
    summary: "List recent run summaries.",
    usage: "polycli debug runs [--json|--json-v2]",
    effects: { readsWorkspace: true, writesLocalState: true },
    examples: [{ argv: ["debug", "runs", "--json"], description: "List recent runs." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: COMMON_ERRORS,
  }),
  ...["show", "explain"].map((subcommand) => definition({
    id: `debug.${subcommand}`,
    path: ["debug", subcommand],
    summary: subcommand === "show" ? "Show redacted events for one run." : "Explain one run deterministically.",
    usage: `polycli debug ${subcommand} <run-id> [--json|--json-v2]`,
    effects: { readsWorkspace: true, writesLocalState: true },
    positionals: [positional("run-id", "Run correlation id.", { required: true, role: "run" })],
    examples: [{ argv: ["debug", subcommand, "run_abc", "--json"], description: `${subcommand} one run.` }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "invalid_argument"],
  })),
  definition({
    id: "debug.tail",
    path: ["debug", "tail"],
    summary: "Read bounded redacted ledger events using an opaque cursor.",
    usage: "polycli debug tail [run-id] [--after <event-id>] [--limit <n>] [--wait] [--timeout-ms <ms>] [--json|--json-v2]",
    effects: { readsWorkspace: true },
    options: [
      option("after", "string", "Return events after this opaque event cursor.", { valueName: "event-id" }),
      option("limit", "integer", "Maximum events to return (1-500).", { valueName: "n", minimum: 1, maximum: 500 }),
      option("wait", "boolean", "Wait for an event after the required cursor.", { requires: ["after"] }),
      option("timeout-ms", "integer", "Wait timeout in milliseconds.", { valueName: "ms", requires: ["wait"], minimum: 1 }),
    ],
    positionals: [positional("run-id", "Optional run correlation id.", { role: "run" })],
    examples: [{ argv: ["debug", "tail", "--after", "evt_abc", "--wait", "--json-v2"], description: "Follow one pinned run from an opaque cursor." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: [...COMMON_ERRORS, "cursor_expired"],
    exitCodes: [0, 1, 2],
  }),
  definition({
    id: "sessions",
    path: ["sessions"],
    summary: "Inspect or purge recorded upstream session artifacts.",
    usage: "polycli sessions <list|purge> ...",
    executable: false,
    defaultSubcommand: "list",
    effects: { readsWorkspace: true },
    examples: [{ argv: ["sessions", "list", "--json"], description: "List recorded artifacts." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: COMMON_ERRORS,
  }),
  definition({
    id: "sessions.list",
    path: ["sessions", "list"],
    summary: "List recorded upstream session artifacts.",
    usage: "polycli sessions list [--json|--json-v2]",
    effects: { readsWorkspace: true },
    examples: [{ argv: ["sessions", "list", "--json"], description: "List recorded artifacts." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: COMMON_ERRORS,
  }),
  definition({
    id: "sessions.purge",
    path: ["sessions", "purge"],
    summary: "Dry-run or explicitly purge recorded upstream session artifacts.",
    usage: "polycli sessions purge [--confirm] [--json|--json-v2]",
    effects: { readsWorkspace: true, writesLocalState: true, destructive: true },
    options: [option("confirm", "boolean", "Delete the validated artifacts instead of dry-running.")],
    constraints: [{ kind: "confirmationOption", option: "confirm" }],
    examples: [{ argv: ["sessions", "purge", "--json"], description: "Preview the purge plan." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: COMMON_ERRORS,
  }),
  definition({
    id: "tui",
    path: ["tui"],
    summary: "Open the terminal run inspector; loading may update local recovery state.",
    usage: "polycli tui [--run-id <id>] [--history <n>]",
    surfaces: TERMINAL_SURFACE,
    dispatchTarget: "terminal-wrapper",
    effects: { readsWorkspace: true, writesLocalState: true },
    options: [
      option("run-id", "string", "Select an initial run.", { valueName: "id" }),
      option("history", "integer", "Limit the run list.", { valueName: "n" }),
      option("smoke", "boolean", "Render one non-interactive smoke frame."),
      option("fixture-dir", "string", "Test fixture directory.", { valueName: "path", visibility: "internal" }),
      option("script-keys", "string", "Test-only scripted input.", { valueName: "keys", visibility: "internal" }),
    ],
    examples: [{ argv: ["tui", "--history", "20"], description: "Inspect recent runs." }],
    outputs: { text: "tui.v1", jsonV1: null, jsonV2: null },
    errors: COMMON_ERRORS,
  }),
  definition({
    id: "_stop-review-gate",
    path: ["_stop-review-gate"],
    summary: "Internal stop-review gate execution.",
    usage: "polycli _stop-review-gate ...",
    visibility: "internal",
    surfaces: INTERNAL_SURFACE,
    runTracked: true,
    effects: { providerInvocation: true, readsWorkspace: true },
    options: [PROVIDER_OPTION],
    positionals: [positional("prompt", "Internal gate prompt.", { required: true, variadic: true, sensitive: true })],
    examples: [{ argv: ["_stop-review-gate"], description: "Internal only." }],
    outputs: LEGACY_OBJECT_OUTPUT,
    errors: COMMON_ERRORS,
  }),
  definition({
    id: "_job-worker",
    path: ["_job-worker"],
    summary: "Internal background job worker.",
    usage: "polycli _job-worker <config-file>",
    visibility: "internal",
    surfaces: INTERNAL_SURFACE,
    effects: { providerInvocation: true, readsWorkspace: true, writesLocalState: true },
    positionals: [positional("config-file", "Internal job config path.", { required: true, sensitive: true })],
    examples: [{ argv: ["_job-worker"], description: "Internal only." }],
    outputs: { text: "text.v1", jsonV1: null, jsonV2: null },
    errors: COMMON_ERRORS,
  }),
]);

export const ERROR_DEFINITIONS = deepFreeze([
  { code: "invalid_argument", exitCode: 1, retryable: false, summary: "An argument violates the registered command contract." },
  { code: "unknown_command", exitCode: 1, retryable: false, summary: "The top-level command is not registered." },
  { code: "unknown_subcommand", exitCode: 1, retryable: false, summary: "The nested command is not registered." },
  { code: "missing_provider", exitCode: 1, retryable: false, summary: "No provider was selected." },
  { code: "unknown_provider", exitCode: 1, retryable: false, summary: "The provider id is not integrated." },
  { code: "missing_prompt", exitCode: 1, retryable: false, summary: "A prompt-bearing command has no prompt text." },
  { code: "invalid_scope", exitCode: 1, retryable: false, summary: "The review scope is invalid." },
  { code: "job_not_found", exitCode: 1, retryable: false, summary: "The selected job does not exist in this workspace." },
  { code: "ambiguous_selector", exitCode: 1, retryable: false, summary: "A job selector matches more than one retained job." },
  { code: "no_active_job", exitCode: 1, retryable: true, summary: "No active job matches the command default." },
  { code: "no_completed_job", exitCode: 1, retryable: true, summary: "No terminal job matches the command default." },
  { code: "cursor_expired", exitCode: 1, retryable: false, summary: "The requested ledger cursor is not retained for the selected run." },
  { code: "provider_failed", exitCode: 1, retryable: true, summary: "The provider path failed without a normal result." },
  { code: "ledger_persist_failed", exitCode: 1, retryable: true, summary: "A required terminal ledger record could not be persisted." },
  { code: "worker_identity_unverified", exitCode: 5, retryable: true, summary: "The worker identity could not be verified safely." },
  { code: "cancel_failed", exitCode: 5, retryable: true, summary: "The worker could not be cancelled safely." },
  { code: "internal_error", exitCode: 1, retryable: false, summary: "Polycli failed outside a typed domain result." },
]);

const NULLABLE_STRING_SCHEMA = { type: ["string", "null"] };
const PUBLIC_OBJECT_SCHEMA = { type: "object", additionalProperties: true };

function typedResultSchema(id, type, required = [], properties = {}, { additionalProperties = false } = {}) {
  return {
    $id: id,
    type: "object",
    required: ["type", ...required],
    properties: {
      type: { const: type },
      ...properties,
    },
    additionalProperties,
  };
}

const V2_RESULT_SCHEMA_IDS = Object.freeze([
  "polycli.result.provider.setup.v2",
  "polycli.result.provider.health.v2",
  "polycli.result.provider.execution.v2",
  "polycli.result.job.started.v2",
  "polycli.result.job.status-list.v2",
  "polycli.result.job.status.v2",
  "polycli.result.job.result.v2",
  "polycli.result.job.cancel.v2",
  "polycli.result.timing.report.v2",
  "polycli.result.ledger.run-list.v2",
  "polycli.result.ledger.run-events.v2",
  "polycli.result.ledger.explanation.v2",
  "polycli.result.ledger.tail.v2",
  "polycli.result.session.list.v2",
  "polycli.result.session.purge.v2",
]);

export const OUTPUT_SCHEMA_DEFINITIONS = deepFreeze({
  "text.v1": { $id: "text.v1", type: "string" },
  "tui.v1": { $id: "tui.v1", type: "string" },
  "legacy.object.v1": { $id: "legacy.object.v1", type: "object", additionalProperties: true },
  "legacy.array.v1": { $id: "legacy.array.v1", type: "array", items: { type: "object" } },
  "polycli.agent-context.v1": {
    $id: "polycli.agent-context.v1",
    type: "object",
    required: ["schemaVersion", "commandSurfaceVersion", "build", "hostSurface", "offline", "commands", "providers", "outputSchemas", "errors", "exitCodes", "features", "compatibility"],
    properties: {
      schemaVersion: { const: 1 },
      commandSurfaceVersion: { type: "integer" },
      build: { type: "object" },
      hostSurface: { type: "string" },
      offline: { const: true },
      commands: { type: "array" },
      providers: { type: "array" },
      outputSchemas: { type: "object" },
      errors: { type: "array" },
      exitCodes: { type: "array" },
      features: { type: "object" },
      compatibility: { type: "object" },
    },
    additionalProperties: false,
  },
  "polycli.job.v2": {
    $id: "polycli.job.v2",
    type: "object",
    required: ["jobId", "provider", "kind", "status", "model", "defaultModel", "promptPreview", "hostSessionId", "providerSessionId", "createdAt", "updatedAt", "finishedAt", "logFile", "error"],
    properties: {
      jobId: NULLABLE_STRING_SCHEMA,
      provider: NULLABLE_STRING_SCHEMA,
      kind: NULLABLE_STRING_SCHEMA,
      status: NULLABLE_STRING_SCHEMA,
      model: NULLABLE_STRING_SCHEMA,
      defaultModel: NULLABLE_STRING_SCHEMA,
      promptPreview: NULLABLE_STRING_SCHEMA,
      hostSessionId: NULLABLE_STRING_SCHEMA,
      providerSessionId: NULLABLE_STRING_SCHEMA,
      createdAt: NULLABLE_STRING_SCHEMA,
      updatedAt: NULLABLE_STRING_SCHEMA,
      finishedAt: NULLABLE_STRING_SCHEMA,
      logFile: NULLABLE_STRING_SCHEMA,
      error: {},
    },
    additionalProperties: false,
  },
  "polycli.wait.v2": {
    $id: "polycli.wait.v2",
    type: ["object", "null"],
    required: ["for", "satisfied", "timedOut", "terminalMismatch"],
    properties: {
      for: { enum: ["terminal", "completed", "failed", "cancelled"] },
      satisfied: { type: "boolean" },
      timedOut: { type: "boolean" },
      terminalMismatch: { type: "boolean" },
    },
    additionalProperties: false,
  },
  "polycli.error.v2": {
    $id: "polycli.error.v2",
    type: "object",
    required: ["code", "message", "data", "nextSteps"],
    properties: {
      code: { enum: ERROR_DEFINITIONS.map((entry) => entry.code) },
      message: { type: "string" },
      data: { type: "object" },
      nextSteps: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
  "polycli.result.provider.setup.v2": typedResultSchema(
    "polycli.result.provider.setup.v2",
    "provider.setup",
    ["providers"],
    { providers: { type: "array", items: PUBLIC_OBJECT_SCHEMA } },
  ),
  "polycli.result.provider.health.v2": typedResultSchema(
    "polycli.result.provider.health.v2",
    "provider.health",
    ["results", "healthyProviders", "unhealthyProviders", "allHealthy", "anyHealthy"],
    {
      results: { type: "array", items: PUBLIC_OBJECT_SCHEMA },
      healthyProviders: { type: "array" },
      unhealthyProviders: { type: "array" },
      allHealthy: { type: "boolean" },
      anyHealthy: { type: "boolean" },
    },
  ),
  "polycli.result.provider.execution.v2": typedResultSchema(
    "polycli.result.provider.execution.v2",
    "provider.execution",
    ["execution", "providerResult"],
    {
      execution: {
        type: "object",
        required: ["provider", "kind", "model", "promptPreview"],
        properties: {
          provider: NULLABLE_STRING_SCHEMA,
          kind: NULLABLE_STRING_SCHEMA,
          model: NULLABLE_STRING_SCHEMA,
          promptPreview: NULLABLE_STRING_SCHEMA,
        },
        additionalProperties: false,
      },
      providerResult: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } }, additionalProperties: true },
    },
  ),
  "polycli.result.job.started.v2": typedResultSchema(
    "polycli.result.job.started.v2", "job.started", ["job"], { job: { $ref: "polycli.job.v2" } },
  ),
  "polycli.result.provider-command.v2": {
    $id: "polycli.result.provider-command.v2",
    oneOf: [
      { $ref: "polycli.result.provider.execution.v2" },
      { $ref: "polycli.result.job.started.v2" },
    ],
  },
  "polycli.result.job.status-list.v2": typedResultSchema(
    "polycli.result.job.status-list.v2",
    "job.status-list",
    ["totalJobs", "running", "recent", "wait"],
    {
      totalJobs: { type: "integer", minimum: 0 },
      running: { type: "array", items: { $ref: "polycli.job.v2" } },
      recent: { type: "array", items: { $ref: "polycli.job.v2" } },
      wait: { $ref: "polycli.wait.v2" },
    },
  ),
  "polycli.result.job.status.v2": typedResultSchema(
    "polycli.result.job.status.v2",
    "job.status",
    ["job", "wait"],
    { job: { $ref: "polycli.job.v2" }, wait: { $ref: "polycli.wait.v2" } },
  ),
  "polycli.result.job-status-command.v2": {
    $id: "polycli.result.job-status-command.v2",
    oneOf: [
      { $ref: "polycli.result.job.status-list.v2" },
      { $ref: "polycli.result.job.status.v2" },
    ],
  },
  "polycli.result.job.result.v2": typedResultSchema(
    "polycli.result.job.result.v2",
    "job.result",
    ["job", "providerResult"],
    { job: { $ref: "polycli.job.v2" }, providerResult: PUBLIC_OBJECT_SCHEMA },
  ),
  "polycli.result.job.cancel.v2": typedResultSchema(
    "polycli.result.job.cancel.v2",
    "job.cancel",
    ["jobId", "cancelled", "reason"],
    { jobId: NULLABLE_STRING_SCHEMA, cancelled: { type: "boolean" }, reason: NULLABLE_STRING_SCHEMA },
  ),
  "polycli.result.timing.report.v2": typedResultSchema(
    "polycli.result.timing.report.v2",
    "timing.report",
    ["records", "aggregate", "metadata"],
    { records: { type: "array" }, aggregate: PUBLIC_OBJECT_SCHEMA, metadata: PUBLIC_OBJECT_SCHEMA },
  ),
  "polycli.result.ledger.run-list.v2": typedResultSchema(
    "polycli.result.ledger.run-list.v2", "ledger.run-list", ["runs"], { runs: { type: "array" } },
  ),
  "polycli.result.ledger.run-events.v2": typedResultSchema(
    "polycli.result.ledger.run-events.v2", "ledger.run-events", ["runId", "events"], { runId: NULLABLE_STRING_SCHEMA, events: { type: "array" } },
  ),
  "polycli.result.ledger.explanation.v2": typedResultSchema(
    "polycli.result.ledger.explanation.v2", "ledger.explanation", [], {}, { additionalProperties: true },
  ),
  "polycli.result.ledger.tail.v2": typedResultSchema(
    "polycli.result.ledger.tail.v2",
    "ledger.tail",
    ["runId", "events", "cursor", "limited", "cursorExpired", "waitTimedOut"],
    {
      runId: NULLABLE_STRING_SCHEMA,
      events: { type: "array" },
      cursor: {
        type: "object",
        required: ["requested", "oldest", "latest", "next"],
        properties: {
          requested: NULLABLE_STRING_SCHEMA,
          oldest: NULLABLE_STRING_SCHEMA,
          latest: NULLABLE_STRING_SCHEMA,
          next: NULLABLE_STRING_SCHEMA,
        },
        additionalProperties: false,
      },
      limited: { type: "boolean" },
      cursorExpired: { type: "boolean" },
      waitTimedOut: { type: "boolean" },
    },
  ),
  "polycli.result.session.list.v2": typedResultSchema(
    "polycli.result.session.list.v2", "session.list", ["recorded", "nonPurgeable"], { recorded: { type: "array" }, nonPurgeable: { type: "array" } },
  ),
  "polycli.result.session.purge.v2": typedResultSchema(
    "polycli.result.session.purge.v2",
    "session.purge",
    ["confirmed", "plan", "nonPurgeable", "summary"],
    { confirmed: { type: "boolean" }, plan: PUBLIC_OBJECT_SCHEMA, nonPurgeable: { type: "array" }, summary: PUBLIC_OBJECT_SCHEMA },
  ),
  "polycli.envelope.v2": {
    $id: "polycli.envelope.v2",
    type: "object",
    required: ["schemaVersion", "id", "ok", "_meta"],
    properties: {
      schemaVersion: { const: 2 },
      id: { type: "string", pattern: "^inv_[a-f0-9]{20}$" },
      ok: { type: "boolean" },
      result: { oneOf: V2_RESULT_SCHEMA_IDS.map(($ref) => ({ $ref })) },
      error: { $ref: "polycli.error.v2" },
      _meta: {
        type: "object",
        required: ["command", "hostSurface", "workspaceSlug", "runId", "jobId"],
        properties: {
          command: { type: "array", items: { type: "string" } },
          hostSurface: NULLABLE_STRING_SCHEMA,
          workspaceSlug: NULLABLE_STRING_SCHEMA,
          runId: NULLABLE_STRING_SCHEMA,
          jobId: NULLABLE_STRING_SCHEMA,
        },
        additionalProperties: false,
      },
    },
    oneOf: [
      { required: ["result"], not: { required: ["error"] }, properties: { ok: { const: true } } },
      { required: ["error"], not: { required: ["result"] }, properties: { ok: { const: false } } },
    ],
    additionalProperties: false,
  },
});

function pathKey(path) {
  return Array.isArray(path) ? path.join(".") : String(path);
}

function isSurfaceVisible(entry, hostSurface) {
  if (!hostSurface) return true;
  if (hostSurface === "unknown") return entry.surfaces.length > 1;
  return entry.surfaces.includes(hostSurface);
}

export function listCommandDefinitions({
  hostSurface = null,
  includeInternal = false,
  topLevelOnly = false,
} = {}) {
  return COMMAND_DEFINITIONS.filter((entry) => {
    if (!includeInternal && entry.visibility === "internal") return false;
    if (topLevelOnly && entry.path.length !== 1) return false;
    if (includeInternal && entry.visibility === "internal") return true;
    return isSurfaceVisible(entry, hostSurface);
  });
}

export function getCommandDefinition(path) {
  const key = pathKey(path);
  return COMMAND_DEFINITIONS.find((entry) => pathKey(entry.path) === key) ?? null;
}

export function resolveCommandPath(argv, { hostSurface = null, includeInternal = true } = {}) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const candidates = listCommandDefinitions({ hostSurface, includeInternal })
    .filter((entry) => entry.path.every((part, index) => argv[index] === part))
    .sort((left, right) => right.path.length - left.path.length);
  let definition = candidates[0] ?? null;
  if (!definition) return null;

  let consumed = definition.path.length;
  if (!definition.executable && definition.defaultSubcommand) {
    const explicitChild = argv[definition.path.length];
    if (explicitChild === "--help" || explicitChild === "-h") {
      return { definition, args: argv.slice(consumed) };
    }
    if (explicitChild && !explicitChild.startsWith("-")) {
      return { definition, args: argv.slice(consumed) };
    }
    const defaultDefinition = getCommandDefinition([...definition.path, definition.defaultSubcommand]);
    if (defaultDefinition) definition = defaultDefinition;
  }
  return { definition, args: argv.slice(consumed) };
}

function levenshtein(left, right) {
  const a = String(left);
  const b = String(right);
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
    }
  }
  return rows[a.length][b.length];
}

export function suggestFromCandidates(argument, candidates) {
  return candidates
    .map((candidate) => ({ candidate, distance: levenshtein(argument, candidate) }))
    .filter(({ candidate, distance }) => candidate.startsWith(argument) || argument.startsWith(candidate) || distance <= 2)
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

function commandArgumentError(definition, message, data = {}, code = "invalid_argument") {
  const error = new Error(message);
  error.code = code;
  error.data = { command: definition.path, ...data };
  return error;
}

function optionIsEnabled(value) {
  return value !== undefined && value !== null && value !== false;
}

function validateCommandPositionals(definition, parsed, enumSources) {
  const positionals = parsed.positionals;
  const providers = enumSources.providers ?? [];
  const explicitProvider = parsed.options.provider ?? null;

  if (definition.argumentMode === "provider-optional") {
    if (positionals.length > 1) {
      throw commandArgumentError(definition, "Too many positional arguments.", { arguments: positionals });
    }
    const positionalProvider = positionals[0] ?? null;
    if (positionalProvider && explicitProvider) {
      throw commandArgumentError(
        definition,
        `Provider target cannot be supplied as positional provider '${positionalProvider}' together with --provider '${explicitProvider}'.`,
        {
          argument: positionalProvider,
          positionalProvider,
          explicitProvider,
          conflictsWith: "--provider",
        },
      );
    }
    if (positionalProvider && !providers.includes(positionalProvider)) {
      throw commandArgumentError(
        definition,
        `Unknown provider '${positionalProvider}'.`,
        { argument: positionalProvider, validValues: providers },
        "unknown_provider",
      );
    }
    if (definition.id === "health" && parsed.options.model && !explicitProvider && !positionalProvider) {
      const error = commandArgumentError(
        definition,
        "--model requires --provider for health; provider model names are not portable.",
        { argument: "--model", requires: "provider" },
      );
      error.legacyCode = "error";
      throw error;
    }
    return;
  }

  if (definition.argumentMode === "provider-prompt-tail" || definition.argumentMode === "provider-focus-tail") {
    let tail = positionals;
    if (!explicitProvider) {
      if (!providers.includes(positionals[0])) {
        throw commandArgumentError(
          definition,
          `Missing provider. Pass --provider <${providers.join("|")}> or use one as the first argument.`,
          { validValues: providers },
          "missing_provider",
        );
      }
      tail = positionals.slice(1);
    }
    if (definition.argumentMode === "provider-prompt-tail" && !tail.join(" ").trim()) {
      throw commandArgumentError(
        definition,
        `Missing prompt text for ${definition.path.join(" ")}.`,
        {},
        "missing_prompt",
      );
    }
    return;
  }

  if (definition.argumentMode === "job-optional") {
    if (parsed.options.job && positionals.length > 0) {
      throw commandArgumentError(
        definition,
        "Pass either a positional job selector or --job, not both.",
        { argument: "--job", conflictsWith: "positional job selector" },
      );
    }
    if (positionals.length > 1) {
      throw commandArgumentError(definition, "Too many job selectors.", { arguments: positionals });
    }
    return;
  }

  const variadicIndex = definition.positionals.findIndex((entry) => entry.variadic);
  const requiredCount = definition.positionals.filter((entry) => entry.required && !entry.variadic).length;
  if (positionals.length < requiredCount) {
    const missing = definition.positionals.find((entry, index) => entry.required && positionals[index] == null);
    throw commandArgumentError(definition, `Missing positional argument ${missing?.name ?? "value"}.`, {
      argument: missing?.name ?? null,
    });
  }
  if (variadicIndex === -1 && positionals.length > definition.positionals.length) {
    throw commandArgumentError(definition, "Too many positional arguments.", { arguments: positionals });
  }
  if (variadicIndex >= 0 && definition.positionals[variadicIndex].required && positionals.length <= variadicIndex) {
    const entry = definition.positionals[variadicIndex];
    throw commandArgumentError(definition, `Missing positional argument ${entry.name}.`, { argument: entry.name });
  }
}

function parserConfig(definition) {
  const valueOptions = [];
  const booleanOptions = [];
  const aliasMap = {};
  for (const entry of definition.options) {
    if (entry.type === "boolean") booleanOptions.push(entry.name);
    else valueOptions.push(entry.name);
    for (const alias of entry.aliases) aliasMap[alias] = entry.name;
  }
  return {
    valueOptions,
    booleanOptions,
    aliasMap,
    unknownOptionMode: "error",
    rejectDuplicateOptions: true,
  };
}

export function parseCommandArgs(definition, argv, { enumSources = {} } = {}) {
  if (!definition) throw new TypeError("command definition is required");
  try {
    const parsed = parseArgs(argv, parserConfig(definition));
    const byName = new Map(definition.options.map((entry) => [entry.name, entry]));
    for (const entry of definition.options) {
      const value = parsed.options[entry.name];
      if (value === undefined) {
        if (entry.default !== null) parsed.options[entry.name] = entry.default;
        if (entry.required) {
          throw commandArgumentError(definition, `Missing required option --${entry.name}.`, {
            argument: `--${entry.name}`,
          });
        }
        continue;
      }
      // Relational constraints decide whether an option is valid in this invocation
      // at all, so report them before validating the option's value. In particular,
      // `--timeout-ms` without `--wait` remains a dependency error even if its value
      // is malformed.
      if (optionIsEnabled(value)) {
        for (const conflict of entry.conflictsWith) {
          if (optionIsEnabled(parsed.options[conflict])) {
            throw commandArgumentError(
              definition,
              `Options --${entry.name} and --${conflict} cannot be used together.`,
              { argument: `--${entry.name}`, conflictsWith: `--${conflict}` },
            );
          }
        }
        for (const requirement of entry.requires) {
          if (!optionIsEnabled(parsed.options[requirement])) {
            throw commandArgumentError(
              definition,
              `Option --${entry.name} requires --${requirement}.`,
              { argument: `--${entry.name}`, requires: `--${requirement}` },
            );
          }
        }
      }
      if (entry.type === "integer") {
        const integerText = String(value);
        const integer = /^-?\d+$/.test(integerText) ? Number(integerText) : Number.NaN;
        if (!Number.isSafeInteger(integer)
          || (entry.minimum != null && integer < entry.minimum)
          || (entry.maximum != null && integer > entry.maximum)) {
          throw commandArgumentError(
            definition,
            entry.maximum != null
              ? `Option --${entry.name} must be an integer from ${entry.minimum ?? Number.MIN_SAFE_INTEGER} to ${entry.maximum}.`
              : `Option --${entry.name} must be ${entry.minimum === 0 ? "a non-negative" : entry.minimum === 1 ? "a positive" : "an"} integer.`,
            { argument: `--${entry.name}`, value, minimum: entry.minimum, maximum: entry.maximum },
          );
        }
      }
      if (entry.type === "enum" && !entry.enumValues.includes(value)) {
        throw commandArgumentError(
          definition,
          `Invalid --${entry.name} value '${value}'. Expected one of: ${entry.enumValues.join(", ")}.`,
          { argument: `--${entry.name}`, value, validValues: entry.enumValues },
          entry.name === "scope" ? "invalid_scope" : "invalid_argument",
        );
      }
      if (entry.enumSource) {
        const values = enumSources[entry.enumSource];
        if (Array.isArray(values) && !values.includes(value)) {
          throw commandArgumentError(
            definition,
            `Unknown ${entry.enumSource === "providers" ? "provider" : entry.enumSource} '${value}'.`,
            { argument: `--${entry.name}`, value, validValues: values },
            entry.enumSource === "providers" ? "unknown_provider" : "invalid_argument",
          );
        }
      }
    }
    for (const constraint of definition.constraints) {
      if (constraint.kind !== "conflicts") continue;
      const enabled = constraint.options.filter((name) => optionIsEnabled(parsed.options[name]));
      if (enabled.length > 1) {
        throw commandArgumentError(
          definition,
          `Options ${enabled.map((name) => `--${name}`).join(" and ")} cannot be used together.`,
          { argument: `--${enabled[0]}`, conflictsWith: enabled.slice(1).map((name) => `--${name}`) },
        );
      }
    }
    // Registry validation guarantees these references resolve. Keeping this lookup here
    // makes malformed injected definitions fail closed in focused tests.
    for (const name of Object.keys(parsed.options)) {
      if (!byName.has(name)) {
        throw commandArgumentError(definition, `Unknown parsed option --${name}.`, { argument: `--${name}` });
      }
    }
    if (!parsed.options.help) validateCommandPositionals(definition, parsed, enumSources);
    return parsed;
  } catch (error) {
    if (error?.code === "invalid_argument" && /^Unknown option\b/.test(error.message)) {
      const validFlags = definition.options
        .filter((entry) => entry.visibility !== "internal")
        .flatMap((entry) => [`--${entry.name}`, ...entry.aliases.map((alias) => `-${alias}`)]);
      const argument = error.data?.argument ?? "";
      error.data = {
        ...(error.data || {}),
        command: definition.path,
        validFlags,
        suggestions: suggestFromCandidates(argument, validFlags),
      };
      if (error.data.suggestions.length > 0) {
        error.message = `${error.message} Did you mean ${error.data.suggestions.join(" or ")}?`;
      }
    }
    throw error;
  }
}

function renderOption(entry) {
  return `  ${entry.forms.join(", ").padEnd(30)} ${entry.description}`.trimEnd();
}

export function renderRootHelp({ hostSurface = "unknown" } = {}) {
  const entries = listCommandDefinitions({ hostSurface, topLevelOnly: true });
  const lines = ["Usage:", "  polycli <command> [options]", "", "Commands:"];
  for (const entry of entries) {
    lines.push(`  ${entry.path[0].padEnd(24)} ${entry.summary}`.trimEnd());
  }
  lines.push("", "Run `polycli <command> --help` for command-specific usage.");
  return lines.join("\n");
}

export function renderCommandHelp(definition) {
  if (!definition) throw new TypeError("command definition is required");
  const lines = ["Usage:", `  ${definition.usage}`, "", definition.summary];
  const publicOptions = definition.options.filter((entry) => entry.visibility !== "internal");
  if (publicOptions.length > 0) {
    lines.push("", "Options:", ...publicOptions.map(renderOption));
  }
  if (definition.positionals.length > 0) {
    lines.push("", "Positionals:");
    for (const entry of definition.positionals) {
      const rules = [
        entry.required ? "required" : "optional",
        entry.variadic ? "variadic" : null,
        entry.sensitive ? "sensitive" : null,
        `role=${entry.role}`,
      ].filter(Boolean).join(", ");
      lines.push(`  ${entry.name.padEnd(24)} ${entry.description} (${rules})`.trimEnd());
    }
  }
  lines.push(
    "",
    "Effects:",
    `  providerInvocation: ${definition.effects.providerInvocation ? "yes" : "no"}`,
    `  readsWorkspace: ${definition.effects.readsWorkspace ? "yes" : "no"}`,
    `  writesLocalState: ${definition.effects.writesLocalState ? "yes" : "no"}`,
    `  destructive: ${definition.effects.destructive ? "yes" : "no"}`,
  );
  if (definition.argumentMode.includes("prompt") || definition.argumentMode.includes("focus")) {
    lines.push("", "Use `--` before prompt text that begins with `-`.");
  }
  if (definition.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of definition.examples) {
      lines.push(`  polycli ${example.argv.join(" ")}`);
      lines.push(`    ${example.description}`);
    }
  }
  return lines.join("\n");
}

export function assertCommandRegistry({
  commands = COMMAND_DEFINITIONS,
  errorDefinitions = ERROR_DEFINITIONS,
  outputSchemas = OUTPUT_SCHEMA_DEFINITIONS,
  handlerIds = null,
} = {}) {
  const ids = new Set();
  const paths = new Set();
  const commandNames = new Set();
  const errors = new Set(errorDefinitions.map((entry) => entry.code));
  const schemas = new Set(Object.keys(outputSchemas));
  if (errors.size !== errorDefinitions.length) throw new Error("duplicate error definition");
  for (const error of errorDefinitions) {
    if (!error.code || !Number.isInteger(error.exitCode) || error.exitCode < 0 || error.exitCode > 255) {
      throw new Error(`invalid error definition: ${error.code || "unknown"}`);
    }
  }
  function visitSchema(value, owner) {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && !schemas.has(value.$ref)) {
      throw new Error(`unknown schema reference ${value.$ref} in ${owner}`);
    }
    for (const child of Object.values(value)) visitSchema(child, owner);
  }
  for (const [schemaId, schema] of Object.entries(outputSchemas)) {
    if (schema.$id !== schemaId) throw new Error(`schema id mismatch: ${schemaId}`);
    visitSchema(schema, schemaId);
  }
  const tuiOnlyOptions = new Set(["smoke", "fixture-dir", "script-keys"]);
  for (const entry of commands) {
    const key = pathKey(entry.path);
    if (ids.has(entry.id)) throw new Error(`duplicate command id: ${entry.id}`);
    if (paths.has(key)) throw new Error(`duplicate command path: ${key}`);
    ids.add(entry.id);
    paths.add(key);
    for (const name of [entry.path.at(-1), ...entry.aliases]) {
      const scopedName = `${entry.path.slice(0, -1).join(".")}:${name}`;
      if (commandNames.has(scopedName)) throw new Error(`duplicate command name or alias: ${key}`);
      commandNames.add(scopedName);
    }
    if (entry.visibility === "public" && (
      !entry.summary
      || !entry.usage
      || entry.examples.length === 0
      || entry.surfaces.length === 0
      || !entry.outputs
      || !Object.values(entry.outputs).some(Boolean)
      || !Array.isArray(entry.errors)
      || entry.errors.length === 0
      || !Array.isArray(entry.exitCodes)
      || entry.exitCodes.length === 0
    )) {
      throw new Error(`incomplete public command definition: ${key}`);
    }
    const optionKeys = new Set();
    for (const item of entry.options) {
      for (const keyName of [item.name, ...item.aliases]) {
        if (optionKeys.has(keyName)) throw new Error(`duplicate option ${keyName} for ${key}`);
        optionKeys.add(keyName);
      }
      for (const reference of [...item.conflictsWith, ...item.requires]) {
        if (!entry.options.some((candidate) => candidate.name === reference)) {
          throw new Error(`unresolved option reference ${reference} for ${key}`);
        }
      }
      if (entry.id !== "tui" && tuiOnlyOptions.has(item.name)) {
        throw new Error(`terminal-only option ${item.name} on ${key}`);
      }
    }
    for (const alias of entry.aliases) {
      if (optionKeys.has(alias)) throw new Error(`command alias collides with option ${alias} for ${key}`);
    }
    if (entry.runTracked && !entry.options.some((item) => item.name === "run-id")) {
      throw new Error(`run-tracked command missing run-id: ${key}`);
    }
    for (const error of entry.errors) {
      if (!errors.has(error)) throw new Error(`unknown error ${error} for ${key}`);
    }
    for (const schema of Object.values(entry.outputs || {}).filter(Boolean)) {
      if (!schemas.has(schema)) throw new Error(`unknown output schema ${schema} for ${key}`);
    }
    if (entry.visibility === "public"
      && entry.executable
      && entry.dispatchTarget === "companion"
      && entry.id !== "agent-context"
      && entry.outputs?.jsonV1
      && !entry.outputs?.jsonV2) {
      throw new Error(`operational command missing JSON v2 schema: ${key}`);
    }
    if (entry.effects.destructive && !entry.constraints.some((item) => item.kind === "confirmationOption")) {
      throw new Error(`destructive command missing confirmation constraint: ${key}`);
    }
  }
  if (handlerIds) {
    const registered = commands
      .filter((entry) => entry.executable && entry.dispatchTarget === "companion")
      .map((entry) => entry.id)
      .sort();
    const bound = [...handlerIds].sort();
    if (JSON.stringify(registered) !== JSON.stringify(bound)) {
      throw new Error(`handler/registry mismatch: registered=${registered.join(",")} handlers=${bound.join(",")}`);
    }
  }
  return true;
}

assertCommandRegistry();
