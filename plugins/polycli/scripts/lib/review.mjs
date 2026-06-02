import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCommand } from "@bbingz/polycli-utils/process";
import { REVIEW_FLAG_EXPECTATIONS } from "@bbingz/polycli-runtime";

const DEFAULT_MAX_DIFF_BYTES = null;
const REVIEW_SCOPES = new Set(["auto", "staged", "unstaged", "working-tree", "branch"]);
const REVIEW_APPEND_SYSTEM =
  "Always emit a visible final markdown answer in assistant text. Never finish with reasoning blocks only. If there are no actionable issues, output exactly: No issues found.";
const REVIEW_CONSTRAINT_ERROR = "non-overridable review hard constraints";
const AGY_REVIEW_UNSUPPORTED_ERROR = "agy does not expose a non-interactive plan mode; /review cannot enforce read-only constraints.";
const REVIEW_UNSUPPORTED_PROVIDERS = new Set(["agy"]);
const GEMINI_REVIEW_DISABLED_MCP_NAME = "__polycli_review_no_mcp__";
const COPILOT_REVIEW_EXCLUDED_TOOLS = [
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
const QWEN_REVIEW_EXCLUDED_TOOLS = [
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
export function normalizeReviewScope(scope) {
  const effective = scope || "auto";
  if (!REVIEW_SCOPES.has(effective)) {
    throw new Error(`Invalid --scope value '${effective}'. Expected one of: ${[...REVIEW_SCOPES].join(", ")}`);
  }
  return effective;
}

function git(cwd, args) {
  return runCommand("git", args, { cwd });
}

function makeReviewTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `polycli-review-${prefix}-`));
}

function assertNoReviewConstraintOverride(provider, runtimeOptions = {}) {
  const extraArgs = Array.isArray(runtimeOptions.extraArgs) ? runtimeOptions.extraArgs : [];
  if (extraArgs.length > 0) {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
  // The per-provider read-only option key(s) are sourced from the shared
  // REVIEW_FLAG_EXPECTATIONS map (single source of truth). readOnlyValue
  // "plan" rejects any other truthy value; readOnlyValue null rejects any
  // value other than `false`.
  const spec = REVIEW_FLAG_EXPECTATIONS[provider];
  if (!spec) return;
  const keys = spec.readOnlyOptionKeys ?? (spec.readOnlyOptionKey ? [spec.readOnlyOptionKey] : []);
  for (const key of keys) {
    const value = runtimeOptions[key];
    const overridden = spec.readOnlyValue
      ? Boolean(value) && value !== spec.readOnlyValue
      : value !== undefined && value !== false;
    if (overridden) {
      throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
    }
  }
}

export function assertReviewProviderSupported(provider) {
  if (REVIEW_UNSUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(AGY_REVIEW_UNSUPPORTED_ERROR);
  }
}

const REVIEW_HARD_CONSTRAINTS = {
  kimi() {
    return { yolo: false, extraArgs: ["--no-thinking", "--max-steps-per-turn", "1"] };
  },
  qwen() {
    return {
      approvalMode: "plan",
      appendSystem: REVIEW_APPEND_SYSTEM,
      extraArgs: QWEN_REVIEW_EXCLUDED_TOOLS.flatMap((tool) => ["--exclude-tools", tool]),
    };
  },
  claude() {
    return {
      permissionMode: "plan",
      maxTurns: 1,
      extraArgs: ["--tools", "", "--mcp-config", "{\"mcpServers\":{}}", "--strict-mcp-config"],
    };
  },
  gemini() {
    const cwd = makeReviewTempDir("gemini-cwd");
    return {
      approvalMode: "plan",
      cwd,
      cleanupPaths: [cwd],
      extraArgs: ["--extensions", "", "--allowed-mcp-server-names", GEMINI_REVIEW_DISABLED_MCP_NAME],
    };
  },
  copilot() {
    return {
      allowAllTools: false,
      allowAllPaths: false,
      allowAllUrls: false,
      noAskUser: true,
      extraArgs: ["--excluded-tools", COPILOT_REVIEW_EXCLUDED_TOOLS],
    };
  },
  opencode({ env } = {}) {
    return {
      skipPermissions: false,
      extraArgs: ["--agent", "plan"],
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          permission: "deny",
        }),
      },
    };
  },
  pi() {
    return { noSession: true, extraArgs: ["--no-tools", "--no-extensions", "--no-skills", "--no-context-files"] };
  },
  cmd() {
    return { yolo: false, extraArgs: ["--permission-mode", "plan"] };
  },
  minimax() {
    return {};
  },
  grok() {
    // --permission-mode plan is grok's read-only mode and composes with the -p one-shot runner.
    return { permissionMode: "plan", alwaysApprove: false };
  },
};

export function buildReviewRuntimeOptions({
  provider,
  cwd,
  runtimeOptions = {},
  env = process.env,
} = {}) {
  assertReviewProviderSupported(provider);
  const constraintBuilder = REVIEW_HARD_CONSTRAINTS[provider];
  if (!constraintBuilder) {
    return runtimeOptions;
  }

  assertNoReviewConstraintOverride(provider, runtimeOptions);
  const constrained = constraintBuilder({ cwd, env });
  const merged = { ...runtimeOptions, ...constrained };

  if (runtimeOptions.env || constrained.env) {
    merged.env = { ...(runtimeOptions.env || {}), ...(constrained.env || {}) };
  }
  if (runtimeOptions.extraArgs || constrained.extraArgs) {
    merged.extraArgs = [...(runtimeOptions.extraArgs || []), ...(constrained.extraArgs || [])];
  }

  return merged;
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.status === 0 && result.stdout.trim() === "true";
}

export function detectDefaultBaseRef(cwd) {
  for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
    const result = git(cwd, ["rev-parse", "--verify", candidate]);
    if (result.status === 0) return candidate;
  }
  return "HEAD~1";
}

function readDiff(cwd, args) {
  const result = git(cwd, args);
  return {
    ok: result.status === 0,
    diff: result.stdout,
    error: result.stderr.trim() || `git ${args.join(" ")} failed`,
  };
}

function diffForScope(cwd, scope, baseRef) {
  if (scope === "staged") {
    return readDiff(cwd, ["diff", "--cached", "--no-ext-diff", "--unified=3"]);
  }
  if (scope === "unstaged") {
    return readDiff(cwd, ["diff", "--no-ext-diff", "--unified=3"]);
  }
  if (scope === "working-tree") {
    return readDiff(cwd, ["diff", "HEAD", "--no-ext-diff", "--unified=3"]);
  }
  if (scope === "branch") {
    const base = baseRef || detectDefaultBaseRef(cwd);
    const result = readDiff(cwd, ["diff", `${base}...HEAD`, "--no-ext-diff", "--unified=3"]);
    return { ...result, baseRef: base };
  }
  throw new Error(`Unsupported scope '${scope}'`);
}

export function collectReviewContext({ cwd, scope = "auto", baseRef = null, maxDiffBytes = DEFAULT_MAX_DIFF_BYTES } = {}) {
  const effectiveScope = normalizeReviewScope(scope);
  if (!ensureGitRepository(cwd)) {
    return { ok: false, error: "Not inside a git repository." };
  }

  let selected = null;
  if (effectiveScope === "auto") {
    const attempts = [];
    const staged = diffForScope(cwd, "staged", null);
    attempts.push({ scope: "staged", ...staged });
    if (staged.ok && staged.diff.trim()) selected = { ...staged, scope: "staged" };
    if (!selected) {
      const unstaged = diffForScope(cwd, "unstaged", null);
      attempts.push({ scope: "unstaged", ...unstaged });
      if (unstaged.ok && unstaged.diff.trim()) selected = { ...unstaged, scope: "unstaged" };
    }
    if (!selected) {
      const branch = diffForScope(cwd, "branch", baseRef);
      attempts.push({ scope: "branch", ...branch });
      if (branch.ok && branch.diff.trim()) selected = { ...branch, scope: "branch" };
    }
    if (!selected) {
      const warnings = attempts
        .filter((attempt) => !attempt.ok)
        .map((attempt) => `${attempt.scope} diff failed: ${attempt.error}`);
      const branchAttempt = attempts.find((attempt) => attempt.scope === "branch");
      selected = {
        ok: true,
        diff: "",
        scope: "auto",
        baseRef: branchAttempt?.baseRef || baseRef || detectDefaultBaseRef(cwd),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
  } else {
    selected = { ...diffForScope(cwd, effectiveScope, baseRef), scope: effectiveScope };
  }

  if (!selected.ok) {
    return { ok: false, error: selected.error };
  }

  const diffText = selected.diff || "";
  const capActive = typeof maxDiffBytes === "number" && Number.isFinite(maxDiffBytes) && maxDiffBytes > 0;
  const truncated = capActive && Buffer.byteLength(diffText, "utf8") > maxDiffBytes;
  const truncatedDiff = truncated
    ? Buffer.from(diffText, "utf8").subarray(0, maxDiffBytes).toString("utf8")
    : diffText;

  return {
    ok: true,
    scope: selected.scope,
    baseRef: selected.baseRef || baseRef,
    diff: truncatedDiff,
    warnings: selected.warnings,
    truncated,
    truncationNotice: truncated
      ? `Diff truncated to ${maxDiffBytes} bytes before sending to provider.`
      : null,
  };
}

function escapeGeminiAtCommandSyntax(text) {
  return String(text ?? "").replace(/(?<!\\)@/g, "\\@");
}

export function buildReviewPrompt({
  provider,
  diff,
  focus = "",
  adversarial = false,
  truncated = false,
  truncationNotice = null,
} = {}) {
  const modeText = adversarial
    ? "Run an adversarial code review. Challenge the implementation approach, assumptions, hidden failure modes, and architectural tradeoffs."
    : "Run a code review. Focus on concrete bugs, regressions, risky behavior changes, and missing tests.";
  const focusText = focus ? `Extra focus from user: ${focus}` : "No extra focus from user.";
  const truncationText = truncated
    ? `Important: ${truncationNotice || "The diff was truncated before review."}`
    : "The diff was not truncated.";
  const promptDiff = provider === "gemini"
    ? escapeGeminiAtCommandSyntax(diff || "(empty diff)")
    : diff || "(empty diff)";

  return [
    `You are acting as ${provider} inside polycli.`,
    modeText,
    "Return markdown only.",
    "Review only the provided git diff and context in this prompt.",
    "Do not run tools, commands, or tests.",
    "Do not inspect the repository beyond the provided diff.",
    "Your output must contain a visible final answer in assistant text, not only reasoning blocks.",
    "Start with a short verdict line.",
    "Then list findings ordered by severity, with file/line references when possible.",
    "If you find no actionable issues, say exactly: No issues found.",
    "Do not suggest that you are about to apply fixes.",
    focusText,
    truncationText,
    "",
    "Git diff:",
    promptDiff,
  ].join("\n");
}
