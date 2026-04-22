import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { runCommand } from "@bbingz/polycli-utils/process";

const DEFAULT_MAX_DIFF_BYTES = 200_000;
const REVIEW_SCOPES = new Set(["auto", "staged", "unstaged", "working-tree", "branch"]);
const REVIEW_APPEND_SYSTEM =
  "Always emit a visible final markdown answer in assistant text. Never finish with reasoning blocks only. If there are no actionable issues, output exactly: No issues found.";
const REVIEW_CONSTRAINT_ERROR = "non-overridable review hard constraints";
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

function writeReviewTempFile(prefix, extension, text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `polycli-review-${prefix}-`));
  const filePath = path.join(root, `${prefix}-${randomUUID()}${extension}`);
  fs.writeFileSync(filePath, text, "utf8");
  return filePath;
}

function readYamlScalar(text, key) {
  const match = String(text ?? "").match(new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^#\\n]+))`, "m"));
  return match ? (match[1] ?? match[2] ?? match[3]?.trim() ?? null) : null;
}

function assertNoReviewConstraintOverride(provider, runtimeOptions = {}) {
  const extraArgs = Array.isArray(runtimeOptions.extraArgs) ? runtimeOptions.extraArgs : [];
  if (extraArgs.length > 0) {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
  if (provider === "gemini" && runtimeOptions.approvalMode && runtimeOptions.approvalMode !== "plan") {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
  if (provider === "opencode" && runtimeOptions.skipPermissions !== undefined && runtimeOptions.skipPermissions !== false) {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
  if (provider === "qwen" && runtimeOptions.maxSteps !== undefined && runtimeOptions.maxSteps !== 1) {
    throw new Error(`Cannot override ${REVIEW_CONSTRAINT_ERROR} for provider '${provider}'.`);
  }
}

function buildGeminiReviewPolicy() {
  return writeReviewTempFile("gemini-policy", ".toml", [
    "[[rule]]",
    'toolName = "*"',
    'decision = "deny"',
    "priority = 999",
    "interactive = false",
    "",
  ].join("\n"));
}

function buildMiniMaxReviewEnv(parentEnv = process.env) {
  const baseConfigPath = parentEnv.MINI_AGENT_CONFIG_PATH
    || path.join(os.homedir(), ".mini-agent", "config", "config.yaml");
  let baseConfigText = "";
  try {
    baseConfigText = fs.readFileSync(baseConfigPath, "utf8");
  } catch {}

  const lines = [];
  for (const key of ["api_key", "api_base", "model", "provider"]) {
    const value = readYamlScalar(baseConfigText, key);
    if (value != null && value !== "") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push(
    "tools:",
    "  enable_file_tools: false",
    "  enable_bash: false",
    "  enable_note: false",
    "  enable_skills: false",
    "  enable_mcp: false",
    ""
  );

  return {
    ...parentEnv,
    MINI_AGENT_CONFIG_PATH: writeReviewTempFile("minimax-config", ".yaml", lines.join("\n")),
  };
}

const REVIEW_HARD_CONSTRAINTS = {
  kimi() {
    return { extraArgs: ["--no-thinking", "--max-steps-per-turn", "1"] };
  },
  qwen() {
    return {
      maxSteps: 1,
      appendSystem: REVIEW_APPEND_SYSTEM,
    };
  },
  claude() {
    return { extraArgs: ["--max-turns", "1", "--tools", ""] };
  },
  gemini() {
    return {
      approvalMode: "plan",
      extraArgs: ["--policy", buildGeminiReviewPolicy()],
    };
  },
  copilot() {
    return {
      extraArgs: ["--excluded-tools", COPILOT_REVIEW_EXCLUDED_TOOLS],
    };
  },
  opencode({ env } = {}) {
    return {
      skipPermissions: false,
      extraArgs: ["--agent", "plan"],
      env: {
        ...(env || process.env),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          permission: "deny",
        }),
      },
    };
  },
  pi() {
    return { extraArgs: ["--no-tools"] };
  },
  minimax({ env } = {}) {
    return { env: buildMiniMaxReviewEnv(env) };
  },
};

export function buildReviewRuntimeOptions({
  provider,
  cwd,
  runtimeOptions = {},
  env = process.env,
} = {}) {
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
  const truncated = Buffer.byteLength(diffText, "utf8") > maxDiffBytes;
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
    diff || "(empty diff)",
  ].join("\n");
}
