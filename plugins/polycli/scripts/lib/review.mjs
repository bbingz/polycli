import { runCommand } from "@bbingz/polycli-utils/process";

const DEFAULT_MAX_DIFF_BYTES = 200_000;
const REVIEW_SCOPES = new Set(["auto", "staged", "unstaged", "working-tree", "branch"]);

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
    const staged = diffForScope(cwd, "staged", null);
    if (staged.ok && staged.diff.trim()) selected = { ...staged, scope: "staged" };
    if (!selected) {
      const unstaged = diffForScope(cwd, "unstaged", null);
      if (unstaged.ok && unstaged.diff.trim()) selected = { ...unstaged, scope: "unstaged" };
    }
    if (!selected) {
      const branch = diffForScope(cwd, "branch", baseRef);
      if (branch.ok && branch.diff.trim()) selected = { ...branch, scope: "branch" };
    }
    if (!selected) {
      selected = { ok: true, diff: "", scope: "auto", baseRef: baseRef || detectDefaultBaseRef(cwd) };
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
