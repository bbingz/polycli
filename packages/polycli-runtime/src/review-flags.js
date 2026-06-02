// Single source of truth for the review/ask hard-constraint flag vocabulary.
//
// This is DATA co-location, not a BaseProvider (Path-B invariant #1): the
// dynamic constraint builders in plugins/polycli/scripts/lib/review.mjs keep
// their per-provider logic. This map only records the tokens that two
// consumers used to hard-code independently and could silently desync:
//   - scripts/check-review-cli-drift.mjs CHECKS[].expect/forbid/probes
//   - lib/review.mjs assertNoReviewConstraintOverride read-only option keys
//
// Token meanings:
//   expectFlags        — CLI flags the drift check expects in `--help` output
//                        (drift CHECKS[].expect). These are HELP-surface flags,
//                        not necessarily the tokens review.mjs passes as extraArgs.
//   extraArgTokens     — the EXACT set of `--`-prefixed flag tokens that
//                        REVIEW_HARD_CONSTRAINTS[provider]() emits in extraArgs
//                        (values omitted). The consistency test asserts this
//                        EQUALS the flags review.mjs actually emits, so adding OR
//                        removing a flag in review.mjs without updating this map
//                        fails CI. NOT a subset of expectFlags — e.g. gemini's
//                        --approval-mode/--policy come from a runtimeOption while
//                        its extraArgs carry --extensions/--allowed-mcp-server-names.
//   readOnlyOptionKey  — the runtimeOption key whose value must stay the
//                        read-only sentinel; assertNoReviewConstraintOverride
//                        rejects any other truthy value.
//   readOnlyOptionKeys — plural form for providers guarding several keys.
//   readOnlyValue      — the only accepted value for readOnlyOptionKey ("plan"),
//                        or null when the guard only accepts `false`.
//   forbidFlags        — flags that must NOT appear (agy: a plan/approval flag
//                        appearing means /review support should be re-evaluated).
//   reviewUnsupported  — true when the provider has no read-only mode.
//   probes             — multi-step help probes (minimax: text-chat then root).

export const REVIEW_FLAG_EXPECTATIONS = Object.freeze({
  claude: Object.freeze({
    expectFlags: Object.freeze(["--tools", "--mcp-config", "--strict-mcp-config"]),
    extraArgTokens: Object.freeze(["--tools", "--mcp-config", "--strict-mcp-config"]),
    readOnlyOptionKey: "permissionMode",
    readOnlyValue: "plan",
  }),
  gemini: Object.freeze({
    expectFlags: Object.freeze(["--approval-mode", "--policy"]),
    extraArgTokens: Object.freeze(["--extensions", "--allowed-mcp-server-names"]),
    readOnlyOptionKey: "approvalMode",
    readOnlyValue: "plan",
  }),
  qwen: Object.freeze({
    expectFlags: Object.freeze(["--approval-mode", "--exclude-tools", "--max-session-turns"]),
    extraArgTokens: Object.freeze(["--exclude-tools"]),
    readOnlyOptionKey: "approvalMode",
    readOnlyValue: "plan",
  }),
  copilot: Object.freeze({
    expectFlags: Object.freeze([
      "--excluded-tools",
      "--allow-all-tools",
      "--allow-all-paths",
      "--allow-all-urls",
      "--no-ask-user",
    ]),
    extraArgTokens: Object.freeze(["--excluded-tools"]),
    readOnlyOptionKeys: Object.freeze(["allowAllTools", "allowAllPaths", "allowAllUrls"]),
    readOnlyValue: null,
  }),
  opencode: Object.freeze({
    expectFlags: Object.freeze(["--agent"]),
    extraArgTokens: Object.freeze(["--agent"]),
    readOnlyOptionKey: "skipPermissions",
    readOnlyValue: null,
  }),
  pi: Object.freeze({
    expectFlags: Object.freeze([
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
    ]),
    extraArgTokens: Object.freeze([
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
    ]),
    readOnlyOptionKey: null,
    readOnlyValue: null,
  }),
  cmd: Object.freeze({
    expectFlags: Object.freeze(["--permission-mode"]),
    extraArgTokens: Object.freeze(["--permission-mode"]),
    readOnlyOptionKey: "yolo",
    readOnlyValue: null,
  }),
  kimi: Object.freeze({
    // kimi-code v0.6.0: the legacy --no-thinking/--max-steps-per-turn review levers were removed
    // upstream and -p one-shot mode rejects --plan/--auto, so review is prompt-only (extraArgTokens
    // empty, like minimax). expectFlags are the load-bearing INVOCATION flags the runtime depends on
    // (-p/--prompt + --output-format), so the drift check warns if kimi-code renames or drops them.
    expectFlags: Object.freeze(["--prompt", "--output-format"]),
    extraArgTokens: Object.freeze([]),
  }),
  agy: Object.freeze({
    expectFlags: Object.freeze([]),
    extraArgTokens: Object.freeze([]),
    forbidFlags: Object.freeze(["--approval-mode", "--permission-mode", "--policy", "--plan", "--agent"]),
    reviewUnsupported: true,
  }),
  minimax: Object.freeze({
    expectFlags: Object.freeze([]),
    extraArgTokens: Object.freeze([]),
    probes: Object.freeze([
      Object.freeze({ helpArgs: Object.freeze(["text", "chat", "--help"]), expect: Object.freeze(["--message"]) }),
      Object.freeze({ helpArgs: Object.freeze(["--help"]), expect: Object.freeze(["--output", "--non-interactive"]) }),
    ]),
  }),
});
