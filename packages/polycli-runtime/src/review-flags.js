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
//   forbidFlags        — flags that must NOT appear in a provider's supported
//                        review-safety contract.
//   reviewUnsupported  — true when the provider has no read-only mode.
//   probes             — multi-step help probes (minimax: text-chat then root).
//   stopReviewGateSafety — whether the automatic stop gate may issue its
//                        custom prompt: enforced, prompt_only, or unsupported.

export const REVIEW_FLAG_EXPECTATIONS = Object.freeze({
  claude: Object.freeze({
    expectFlags: Object.freeze(["--tools", "--mcp-config", "--strict-mcp-config"]),
    extraArgTokens: Object.freeze(["--tools", "--mcp-config", "--strict-mcp-config"]),
    readOnlyOptionKey: "permissionMode",
    readOnlyValue: "plan",
    stopReviewGateSafety: "enforced",
  }),
  gemini: Object.freeze({
    expectFlags: Object.freeze(["--approval-mode", "--policy"]),
    extraArgTokens: Object.freeze(["--extensions", "--allowed-mcp-server-names"]),
    readOnlyOptionKey: "approvalMode",
    readOnlyValue: "plan",
    stopReviewGateSafety: "enforced",
  }),
  qwen: Object.freeze({
    expectFlags: Object.freeze(["--approval-mode", "--exclude-tools", "--max-session-turns"]),
    // Qwen Code 0.19.6 emits a minimal bare `qwen --help` page.
    // Supplying one registered option reveals the complete headless option
    // surface, but that option itself is omitted from the rendered help. Use
    // complementary, side-effect-free help probes so the drift check verifies
    // every invocation flag without issuing a model request.
    probes: Object.freeze([
      Object.freeze({
        helpArgs: Object.freeze(["--approval-mode", "plan", "--help"]),
        expect: Object.freeze(["--exclude-tools", "--max-session-turns"]),
      }),
      Object.freeze({
        helpArgs: Object.freeze(["--max-session-turns", "1", "--help"]),
        expect: Object.freeze(["--approval-mode"]),
      }),
    ]),
    extraArgTokens: Object.freeze(["--exclude-tools"]),
    readOnlyOptionKey: "approvalMode",
    readOnlyValue: "plan",
    stopReviewGateSafety: "enforced",
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
    stopReviewGateSafety: "enforced",
  }),
  opencode: Object.freeze({
    expectFlags: Object.freeze(["--agent"]),
    extraArgTokens: Object.freeze(["--agent"]),
    readOnlyOptionKey: "skipPermissions",
    readOnlyValue: null,
    stopReviewGateSafety: "enforced",
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
    stopReviewGateSafety: "enforced",
  }),
  cmd: Object.freeze({
    expectFlags: Object.freeze(["--permission-mode"]),
    extraArgTokens: Object.freeze(["--permission-mode"]),
    readOnlyOptionKey: "yolo",
    readOnlyValue: null,
    stopReviewGateSafety: "enforced",
  }),
  kimi: Object.freeze({
    // No independently verified flag-based no-tool/read-only lever is available for Kimi prompt
    // mode, so review is prompt-only (extraArgTokens empty, like minimax). expectFlags are the
    // load-bearing invocation flags the runtime depends on
    // (-p/--prompt + --output-format), so the drift check warns if kimi-code renames or drops them.
    expectFlags: Object.freeze(["--prompt", "--output-format"]),
    extraArgTokens: Object.freeze([]),
    stopReviewGateSafety: "prompt_only",
  }),
  agy: Object.freeze({
    // agy 1.1.2 exposes `--mode plan`, but the non-interactive `-p` path has
    // no verified hard no-write/no-command guarantee. Keep /review rejected
    // until that guarantee is independently proven without yolo permissions.
    expectFlags: Object.freeze(["--mode"]),
    extraArgTokens: Object.freeze([]),
    reviewUnsupported: true,
    stopReviewGateSafety: "unsupported",
  }),
  minimax: Object.freeze({
    expectFlags: Object.freeze([]),
    extraArgTokens: Object.freeze([]),
    probes: Object.freeze([
      Object.freeze({ helpArgs: Object.freeze(["text", "chat", "--help"]), expect: Object.freeze(["--message"]) }),
      Object.freeze({ helpArgs: Object.freeze(["--help"]), expect: Object.freeze(["--output", "--non-interactive"]) }),
    ]),
    stopReviewGateSafety: "prompt_only",
  }),
  grok: Object.freeze({
    // grok review enforces read-only via the --permission-mode plan runtimeOption (composes with
    // the -p one-shot mode, verified). It carries no review extraArgs of its own.
    expectFlags: Object.freeze(["--permission-mode"]),
    extraArgTokens: Object.freeze([]),
    readOnlyOptionKey: "permissionMode",
    readOnlyValue: "plan",
    stopReviewGateSafety: "enforced",
  }),
});
