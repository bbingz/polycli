const PROMPT_FINAL_ANSWER_APPEND_SYSTEM =
  "Always emit a visible final answer in assistant text. Never finish with reasoning blocks only.";
const GEMINI_PROMPT_DISABLED_MCP_NAME = "__polycli_prompt_no_mcp__";
const COPILOT_PROMPT_EXCLUDED_TOOLS = [
  "bash",
  "read_bash",
  "write_bash",
  "stop_bash",
  "list_bash",
  "powershell",
  "read_powershell",
  "write_powershell",
  "stop_powershell",
  "list_powershell",
  "view",
  "create",
  "edit",
  "apply_patch",
  "task",
  "read_agent",
  "list_agents",
  "grep",
  "glob",
  "web_fetch",
  "skill",
  "ask_user",
].join(",");
const QWEN_PROMPT_EXCLUDED_TOOLS = [
  "agent",
  "task_stop",
  "send_message",
  "skill",
  "list_directory",
  "read_file",
  "grep_search",
  "glob",
  "todo_write",
  "ask_user_question",
  "exit_plan_mode",
  "web_fetch",
];

function mergeExtraArgs(runtimeOptions, extraArgs) {
  return [...(runtimeOptions.extraArgs || []), ...extraArgs];
}

export function buildPromptRuntimeOptions({
  provider,
  kind,
  runtimeOptions = {},
} = {}) {
  if ((kind === "ask" || kind === "rescue") && provider === "agy") {
    return {
      ...runtimeOptions,
      yolo: true,
    };
  }

  // kimi-code v0.6.0 has no per-invocation ask constraints: `-p` one-shot mode rejects
  // --plan/--auto and the old --no-thinking/--max-steps-per-turn flags were removed (those
  // are now config.toml-level). kimi ask therefore uses the plain `-p` invocation.

  if (kind === "ask" && provider === "claude") {
    return {
      ...runtimeOptions,
      permissionMode: "plan",
      maxTurns: 1,
      extraArgs: mergeExtraArgs(runtimeOptions, [
        "--tools",
        "",
        "--mcp-config",
        "{\"mcpServers\":{}}",
        "--strict-mcp-config",
      ]),
    };
  }

  if (kind === "ask" && provider === "gemini") {
    return {
      ...runtimeOptions,
      approvalMode: "plan",
      extraArgs: mergeExtraArgs(runtimeOptions, [
        "--extensions",
        "",
        "--allowed-mcp-server-names",
        GEMINI_PROMPT_DISABLED_MCP_NAME,
      ]),
    };
  }

  if (kind === "ask" && provider === "copilot") {
    return {
      ...runtimeOptions,
      allowAllTools: false,
      allowAllPaths: false,
      allowAllUrls: false,
      noAskUser: true,
      extraArgs: mergeExtraArgs(runtimeOptions, ["--excluded-tools", COPILOT_PROMPT_EXCLUDED_TOOLS]),
    };
  }

  if (kind === "ask" && provider === "opencode") {
    return {
      ...runtimeOptions,
      skipPermissions: false,
      extraArgs: mergeExtraArgs(runtimeOptions, ["--agent", "plan"]),
      env: {
        ...(runtimeOptions.env || {}),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          permission: "deny",
        }),
      },
    };
  }

  if (kind === "ask" && provider === "pi") {
    return {
      ...runtimeOptions,
      noSession: true,
      extraArgs: mergeExtraArgs(runtimeOptions, [
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
      ]),
    };
  }

  if (kind === "ask" && provider === "cmd") {
    return {
      ...runtimeOptions,
      yolo: false,
      extraArgs: mergeExtraArgs(runtimeOptions, ["--permission-mode", "plan"]),
    };
  }

  if (provider === "qwen") {
    const merged = {
      ...runtimeOptions,
      appendSystem: runtimeOptions.appendSystem || PROMPT_FINAL_ANSWER_APPEND_SYSTEM,
    };
    if (kind === "ask") {
      merged.approvalMode = "plan";
      merged.maxSteps = 20;
      merged.extraArgs = mergeExtraArgs(
        runtimeOptions,
        QWEN_PROMPT_EXCLUDED_TOOLS.flatMap((tool) => ["--exclude-tools", tool])
      );
    }
    return merged;
  }

  return runtimeOptions;
}

export { PROMPT_FINAL_ANSWER_APPEND_SYSTEM };
