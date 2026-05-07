# Changelog

Flat, reverse-chronological log for cross-AI collaboration (Claude / Codex / Gemini / etc.).
Format: `## YYYY-MM-DD — author — headline` followed by bullets.
Separate from `docs/release.md` (release-focused) and `docs/archive/session-memory-*.md` (single handoff snapshot).

---

## 2026-05-07 — Claude — background-job ledger plumbing (Q6 Spec 2)

- Parent process now persists a top-level `runContext` (runId / command / hostSurface / argv / jobId / provider / kind / model / defaultModel / logFile) into the per-job config when `--run-id` (or `POLYCLI_RUN_ID`) is in scope.
- After spawning the worker, the parent writes a `job_started` ledger event; no `provider_decision` from the parent.
- `_job-worker` reads `runContext`, writes `attempt_started` before the streaming call, and on completion writes `attempt_result` (status `completed` / `failed`) plus `provider_decision` (`adopted` on success, `failed reason=<kind>_failed` on not-ok). Worker-observed cancellation produces `attempt_result status=cancelled` + `provider_decision status=cancelled reason=job_cancelled`.
- Added shared `recordRunEventForContext(workspaceRoot, runContext, base)` writer; existing `recordRunEvent` delegates via `buildCurrentRunContext()`. Worker code never mutates the parent-side `RUN_CONTEXT` global.
- `createRunLedgerEvent` schema gains nullable `pid` / `durationMs` slots; foreground events round-trip with the existing fields and add `null` defaults for the new ones.
- Tests: 3 new background integration tests (success with `--run-id`, failed `cmd ask` without full prompt leakage, explicit `POLYCLI_HOST_SURFACE=codex-skill` propagation). All 61 plugin-level tests pass; full `npm test` and `npm run release:check` green.
- Killed-worker (`kill -9` after provider returns but before the ledger write) perfect recovery is documented as the open follow-up; it needs a reaper or scan-on-read step and is not in this slice.
- No version bump, no tag, no publish — main only. Roadmap Q6 status updated; `tasks/terminal-cli-tui-observability.md` background-worker checkbox flipped.

## 2026-05-07 — Claude — v0.6.7 released (terminal CLI + run ledger)

- Shipped standalone terminal CLI `@bbingz/polycli` (PATH-callable wrapper around the bundled companion); first-time npm publish.
- Added shared `debug` companion vocabulary (`debug runs / show <run-id> / explain <run-id>`) surfaced through Claude / Codex / Copilot / OpenCode / terminal.
- Added redacted append-only run ledger (NDJSON per workspace) with stable `runId` / `workspaceSlug` / `hostSurface`; foreground `health`, `ask`, `rescue`, `review`, `adversarial-review` write `health_result` / `attempt_started` / `attempt_result` / `provider_decision` / `run_summary` events. Background-worker ledger plumbing is the next follow-up.
- Added global `--run-id <id>` (or `POLYCLI_RUN_ID`) to join multi-command flows under one ledger run; stripped before provider/positional parsing.
- Bundle / release guards now cover a fifth byte-identical companion bundle (`packages/polycli-terminal/bin/polycli-companion.bundle.mjs`) and assert the terminal tarball ships `LICENSE`.
- Published artifacts: GitHub release https://github.com/bbingz/polycli/releases/tag/v0.6.7, npm `@bbingz/polycli-opencode@0.6.7`, npm `@bbingz/polycli@0.6.7`. Utility packages remain on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`).

## 2026-05-06 — Codex — prepare v0.6.4 Codex install-surface correction

- Corrected the Codex adapter docs and manifest after real Codex TUI verification showed `/polycli-codex:polycli ...` is not a registered slash command.
- Documented the actual Codex flow: `codex plugin marketplace add bbingz/polycli`, then install `Polycli` from TUI `/plugins`, then start a new thread so the `polycli` skill appears.
- Reworked the Codex skill invocation guidance to resolve the plugin root from the installed `SKILL.md` path instead of requiring a manually exported `PLUGIN_ROOT`.
- Tightened `npm run validate:codex-adapter` and `npm run validate:host-map` so future releases reject fake Codex slash-command examples and require Codex skill examples for `health`, `ask`, `review`, and `timing`.
- Prepared release notes and host package metadata for `v0.6.4`; OpenCode package moves to `@bbingz/polycli-opencode@0.6.4`, while utils/timing stay on `1.0.1`.

## 2026-05-06 — Codex — prepare v0.6.3 Codex adapter operability patch

- Strengthened the `polycli-codex` manifest and skill so Codex is explicitly told to prefer `/polycli-codex:polycli ...` over direct official CLI shell calls for `claude`, `copilot`, `opencode`, `pi`, `gemini`, `kimi`, `qwen`, and `minimax`; raw shell is now documented as an explicit-user-intent or unavailable-plugin fallback only.
- Updated the root README, Codex plugin README, and host command map with Codex slash examples for `health`, `ask`, `review`, `status`, `result`, and `timing`, so daily examples no longer look like a generic shell command.
- Added `docs/codex-adapter-operability.md` as the routing, fallback, first-run, and observability contract for Codex sessions.
- Added `scripts/validate-codex-adapter.mjs`, `npm run validate:codex-adapter`, unit coverage, CI wiring, and `release:check` wiring so Codex provider triggers, fallback language, and health/status/result/timing guidance cannot drift silently.
- Prepared release notes and host package metadata for `v0.6.3`; OpenCode package moves to `@bbingz/polycli-opencode@0.6.3`, while utils/timing stay on `1.0.1`.

## 2026-05-02 — Claude — opencode added to timeout multiplier + multiway benchmark doc

Triggered by a second 5-round multiway run using **real HuggingFace dataset rows** (offsets 5/1000/130/400/0 from MMLU college_math / GSM8K / HumanEval/130 / TruthfulQA / BBH), as opposed to the first run which used benchmark-flavored re-creations.

**Multiplier extended to opencode:**

- `plugins/polycli/scripts/polycli-companion.mjs`: `PROVIDER_TIMEOUT_MULTIPLIERS.opencode = { "kimi-for-coding/k2p6": 2 }`. Same pattern as gemini — model-scoped, only the reasoning variant gets ×2; other opencode models stay at base.
- Trigger: HumanEval/130 (Tribonacci with awkward forward-reference recurrence) made opencode hit `timedOut: true, signal: "SIGTERM"` at exactly 120021 ms — the 120s `ask` ceiling. Verified post-fix that opencode background job timeout is 240000ms (gemini still 240000ms, qwen unchanged at 120000ms).
- `gemini-cli-runtime/SKILL.md` Latency expectations section updated to show the multiplier is a registry, not gemini-only — the same pattern can be extended as new reasoning model ids appear.

**Benchmark doc persisted:**

- `docs/benchmarks/multiway-validation-2026-05-02.md` captures: exact dataset offsets and prompt verbatim text, full result matrix for both rounds (40/40 easy + 37/40 hard), per-provider behavior notes (kimi misreads complex prompts, minimax reasons shallowly on puzzle-class, opencode is a code-reasoning model), and **3 grader bugs** that bit me during the run (`.strip()` ate Python indent, prefix-only negation regex missed kimi's "not because" answer, single-language regex misclassified claude's Chinese reply). The grader-lessons section is the durable artifact — future benchmark scripts should not repeat these.

**What we did NOT do:**

- Did not write a reusable benchmark grader utility module (`tasks/benchmark-grader.mjs` style). polycli is not a benchmark suite; persisting the lessons in a doc is sufficient.
- Did not extend the multiplier to other providers preemptively — opencode addition was driven by a real timeout observation, not speculation.

## 2026-05-02 — Claude — kimi/minimax model id fix + gemini multiplier stress test

Followups discovered during a 5-round 9-way validation (8 polycli providers + codex via subagent, prompts from MMLU / GSM8K / HumanEval / TruthfulQA / open-ended).

**Fix: kimi & minimax `model` field was null in ask result**

- `packages/polycli-runtime/src/kimi.js:347` and `:404` — fall back to `readKimiDefaultModel()` (already existed but was unused) when `parsed.model ?? model ?? defaultModel` is all null. Reads `~/.kimi/config.toml` `default_model` scalar.
- `packages/polycli-runtime/src/minimax.js:238` — fall back to `readMiniMaxConfig().model` (reads `~/.mini-agent/config/config.yaml`) under the same condition.
- Root cause: `cacheProviderModel` only writes when `result.model` is non-empty. kimi stream-json and mini-agent log don't carry a model id, so cache stayed empty, so subsequent runs got null `defaultModel`, so model stayed null. Chicken-and-egg. Direct config read breaks the loop.
- Verified post-fix: `kimi` returns `kimi-code/kimi-for-coding`, `minimax` returns `MiniMax-M2.7-highspeed`. Resolves the "null for kimi/mini-agent" caveat in `reference_default_model_extraction_caveats.md`.

**Stress test: gemini timeout multiplier**

Goal: prove the `gemini-3.1-pro-preview` ×2 multiplier was actually necessary, not just defensive.

| prompt class | gemini wall | gemini ttft | observation |
|---|---|---|---|
| Standard 5-round (MMLU / GSM8K / HumanEval / TruthfulQA / open-ended) | 7-22s | (mostly < total) | far below 120s base — multiplier irrelevant |
| GPQA-style physics reasoning + algebra (453 byte prompt, ask) | 55s | 44s | half the base 120s — comfortable headroom but base would have worked |
| Heavy structured output: 800-byte rate-limit design prompt (rescue) | 55s | 37s + 18s gen | far below 600s rescue base |

Result: under prompts I could construct, `gemini-3.1-pro-preview` peaks around 55s — never approaches even the 120s `ask` base, much less the 240s multiplier ceiling. The multiplier is defensive headroom for the original observation (user reported gemini "self-admitted long thinking time" on review of large diffs), not a tight fit. Documented this honestly: the multiplier provides safety margin for the worst case rather than reacting to a routine ceiling breach. No timeout tuning change.

**Side observations from the 5-round validation (no fixes needed, recorded for posterity):**

- All 9 entities (8 polycli + codex) returned correct answers on R1/R2/R4. Code-completion (R3) instruction-following varied: 7/8 polycli wrapped the function in markdown despite "no extra commentary" — only `minimax` and `codex` gave a true one-liner. This is upstream LLM behavior, not polycli routing.
- `claude` provider answered the English R4 prompt in Chinese because the user's global `CLAUDE.md` says "Always respond in Chinese". CLAUDE.md inheritance only reaches the `claude` provider; other providers respect prompt language. Documented in memory as expected behavior.
- 5 rounds × 8 providers wall time: 113s (parallel start per round, sequential rounds). Codex reference run (subagent `a48de540074220012`): all 5 prompts correct, 7-9s latency each.

## 2026-05-02 — Claude — multi-way self-review: 4 doc fixes + 1 verified bug + multiplier scope tightening

Ran a 4-way self-review where each provider audited polycli's claims about itself (`gemini` / `qwen` / `kimi` / `minimax` each reading their own `*-cli-runtime/SKILL.md`). Triaged findings into red (true defects, fix), yellow (LLM claims to verify against real CLIs), and green (engineering choices).

**Red — 4 doc defects fixed:**

- `minimax-cli-runtime/SKILL.md` P0.5: removed self-contradiction. Section claimed Layer 1/3 sentinels were "跨 locale 稳定" while the same paragraph noted OSError messages may be i18n'd by glibc. Reworded as "纯 ASCII 字面量, 未观察到 i18n" and clarified the i18n caveat is OS-layer (outside Mini-Agent's control).
- `minimax-cli-runtime/SKILL.md` P0.9: scoped the "0 次 `os.environ`" claim to first-party Mini-Agent code (excludes transitive deps like httpx / pydantic) and clarified the implication is auth-purpose only.
- `qwen-cli-runtime/SKILL.md`: documented `--unsafe` vs `--approval-mode` precedence with source-verified semantics. Initial draft said "--unsafe wins", but reading `buildQwenInvocation` in `packages/polycli-runtime/src/qwen.js:73-76` showed the opposite: an explicit `--approval-mode` wins; `--unsafe` is only a shortcut to `yolo` when `--approval-mode` is omitted. Background-mode `yolo` still requires `--unsafe` as an independent safety guard.
- `kimi-cli-runtime/SKILL.md`: "Auth ping" was misleading — `--max-steps-per-turn 1 + 30s` is a liveness probe (verifies binary launches and reaches the model) but does not validate token freshness. Renamed to "Liveness probe" and pointed to `setup --json` `authenticated` field for true auth state.

**Yellow — 6 claims verified against real CLIs (gemini 0.40.1, kimi 1.40.0, qwen 0.15.6):**

| # | Claim | Verdict |
|---|---|---|
| 5 | gemini `--write` → `--approval-mode auto_edit` | ✅ help confirms `auto_edit` is a valid enum |
| 6 | kimi `-V` and `-v` flags | ⚠️ partially wrong — `-V` and `--version` both work, but `-v` returns a click usage error in 1.40.0+, not verbose. Doc updated. |
| 7 | kimi stream-json `role` set | ✅ live probe shows only `assistant` (kimi's self-claim of "user/system" was a hallucination) |
| 8 | kimi `--approval-mode` acceptance | ✅ kimi 1.40 has no `--approval-mode` (only `--yolo`/`--plan`/`--afk`/`--print`); doc was correct |
| 9 | `--print` ≈ `--yolo` | ✅ `kimi --help` 1.40 says "Print mode auto-dismisses AskUserQuestion and auto-approves tool calls"; doc was correct |
| 10 | kimi auth paths | ✅ subcommand list is `login/logout/term/acp/info/export/mcp/plugin/vis/web` — no API-key/SSO subcommands; doc was correct |

Net: kimi's self-review hallucinated 5 of 6 — LLMs are unreliable narrators about their own CLI surfaces. Real probes are necessary. Only Q6 produced a doc edit (`-v` wording in `kimi-cli-runtime/SKILL.md` lines 36 and 97).

**Green — multiplier tightened to model scope:**

- Refactored `PROVIDER_TIMEOUT_MULTIPLIERS = { gemini: 2 }` → `{ gemini: { "gemini-3.1-pro-preview": 2 } }`. Refactored `resolveTimeoutMs` signature to `(provider, kind, { model, defaultModel })`. Resolution: explicit `--model` wins; falls back to cached upstream-default model only if caller did not pass one. So `--model gemini-flash-2.5` stays at base 120s/600s/300s even though the cached default is a reasoning model — addresses gemini self-review's complaint that the multiplier was over-broad.
- `gemini-cli-runtime/SKILL.md`: Latency expectations rewritten with explicit resolution rules and a note that adding new reasoning model ids (when upstream releases them) is the maintenance path — do not blanket-multiply the whole provider.
- `qwen-cli-runtime/SKILL.md`: Safety rule "If Bash call fails, return nothing" gets a Rationale clarifying this is a forwarder contract — the companion already encodes failure in `error`/exit code, the subagent re-emitting prose would only duplicate or paraphrase. (Addresses qwen self-review #2.)

**Side check — mini-agent upstream:** verified via GitHub API (`/repos/MiniMax-AI/Mini-Agent`): no releases, no tags, latest commit `d76a4f63` 2026-02-14 (cosmetic fix). Still 0.1.0; minimax self-review's hint about "possibly newer version" was unsupported. Memory entry stays accurate.

## 2026-05-02 — Claude — README clarifies polycli is an in-host plugin, not a shell binary

- Triggered by a real Codex session that grepped the user's `PATH` directories for a `polycli` binary, found nothing, concluded "polycli has no callable entry point", and fell back to invoking `qwen` directly — defeating the routing purpose of polycli. Codex-rescue review (agent `afee5f7a594387551`) confirmed the misleading signals: hero SVG showed `$ polycli health --json` (shell prompt), and README L25/L36/L108 used cross-host vocabulary phrasing that read as if `polycli` were a portable shell command.
- `docs/assets/readme-header.svg:54`: `$ polycli health --json` → `/polycli:health --json`. Removes the shell-prompt visual cue from the first thing every reader sees.
- `README.md` "What is polycli?" gets a callout: polycli is an in-host plugin, no `polycli` binary on `PATH`, each host adapter exposes the same vocabulary in its own invocation style. Quick-start Copilot row annotated as "skill word — NOT a PATH binary; only inside the copilot prompt" so that line cannot be screenshot-grepped out of context.
- `README.md` adds **`## Outside a supported host`** section listing three honest options for non-Claude-Code/Codex/Copilot/OpenCode agents: (1) install the host adapter for the environment, (2) call the underlying provider CLI directly with explicit trade-offs, (3) escape hatch — `PLUGIN_ROOT=... node scripts/polycli-companion.bundle.mjs ...` marked unstable and internal. Verified against `plugins/polycli-codex/skills/polycli/SKILL.md:11` (uses `${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}`).
- `README.zh-CN.md` and `README.ja.md` get the in-host callout + Quick-start row clarification, but link back to the English `Outside a supported host` section instead of duplicating the full block (translation drift > terse cross-link).
- Docs only — no code, no test changes.

## 2026-05-02 — Claude — gemini timeout multiplier + latency documentation

- `plugins/polycli/scripts/polycli-companion.mjs` introduces `PROVIDER_TIMEOUT_MULTIPLIERS = { gemini: 2 }` and a `resolveTimeoutMs(provider, kind)` helper. Applied to the two prompt-execution code paths (`parsePromptExecution` for ask/rescue, `runReview` for review/adversarial-review). `health` retains the universal 60s budget — gemini's health probe is sentinel-only and does not exercise reasoning.
- Effective ceilings for gemini: `ask` 240s (was 120s), `rescue` 1200s (was 600s), `review` / `adversarial-review` 600s (was 300s). All other providers unchanged.
- Motivation: gemini is a deep-reasoning model that routinely spends 30s–several minutes thinking before emitting visible text (live observation across 2026-04-29 bench + this session: rescue PONG took 44.7s vs qwen 2.9s on identical prompt). Hard-coded 300s `review` ceiling was the closest one to silently masquerade as "polycli broken".
- `plugins/polycli/skills/gemini-cli-runtime/SKILL.md` adds a `## Latency expectations` section explaining the multiplier, listing the new vs old ceilings per kind, and recommending `--background` + `/polycli:status` polling for prompts of unknown duration. Subcommand table updated to reflect the gemini-specific timeouts.
- Background worker (`runJobWorker`) reuses `execution.timeout`, so the multiplier propagates to background jobs as well — no separate code path needed.

## 2026-05-02 — Claude — fix stale `task` subcommand references in 4 cli-runtime SKILLs

- `plugins/polycli/skills/{qwen,gemini,kimi,minimax}-cli-runtime/SKILL.md` referenced a `task` companion subcommand that does not exist on the unified surface (companion exposes `setup`, `health`, `ask`, `rescue`, `review`, `adversarial-review`, `status`, `result`, `cancel`, `timing`). The references were inherited verbatim from the legacy `*-plugin-cc` repos in R8c (commit 193078f) where each plugin had its own companion with a `task` command; on the unified surface that role split into `ask` (120s, one-shot) and `rescue` (600s, multi-step). A `polycli:polycli-provider-agent` subagent that read the SKILL literally would have invoked `task` and crashed with `Unknown subcommand 'task'.`
- Same edit also dropped non-existent `task-resume-candidate` (resumable state lives behind `--resume-last`) and the legacy `write-key` helper from minimax (no longer on the unified surface).
- End-to-end smoke: `polycli-companion.bundle.mjs rescue --provider qwen` returns `ok=true`, `kind=rescue`, response present (real qwen-cli 0.15.6, qwen3.6-plus). `ask --provider qwen` already worked.
- Docs only — no companion / runtime / bundle changes.

## 2026-04-30 — Claude — landscape check + daily watcher for official LLM-provider plugins

- Verified `openai/codex-plugin-cc` (the only LLM-provider-official Claude Code plugin) is at v1.0.4 / `807e03a` and matches the locally installed marketplace clone — no upstream updates since 2026-04-18.
- Surveyed 25+ AI-provider GitHub orgs, the `*-plugin-cc` naming convention, and Anthropic's `claude-plugins-official` (171) + `claude-plugins-community` (1921) marketplaces. Result: as of 2026-04-30, OpenAI is still the **only** LLM provider with an official Claude Code plugin. Google / xAI / Mistral / DeepSeek / Qwen / Kimi / MiniMax / Cohere / Meta / Groq / Zhipu / 01-ai / Perplexity / OpenRouter — all absent. Microsoft has platform skills (`skills-for-fabric`, `power-platform-skills`, `skills-for-copilot-studio`) but no LLM-provider bridge.
- Created daily-running remote routine `trig_01RLU5aqzYkuPFA8LMQKcnzo` (https://claude.ai/code/routines/trig_01RLU5aqzYkuPFA8LMQKcnzo) to watch this signal: 02:00 UTC every day, sonnet-4-6, scans the same orgs/marketplaces and is loud only when a new official provider plugin appears.
- No code changes in polycli itself.

## 2026-04-29 — Claude — capability matrix for workflows with no bare-shell equivalent

- Added `docs/benchmarks/capability-matrix.md` listing workflows where bare-shell has no meaningful equivalent: adversarial-review, background job control, session resume, stop-review-gate hook, 4-state timing, multi-host consistency (Claude Code / Codex / Copilot / OpenCode), provider `health` probe, probing-cost amortization. Companion to `bench-vs-bare-cli-spec.md`. These are presence/absence claims, not byte ratios — forcing them into a token comparison would be dishonest because there's nothing to compare against.
- README "Cost vs raw shell calls" section gets a one-line pointer to the capability matrix.
- Spec followup #3 (Path b disciplined-bare-shell) closed as **permanent deferral**: the (a) vs (c) data already gives a clear directional answer (69–98% reduction across cells, advantage from probing-cost amortization). Cost-benefit (Anthropic SDK dep + ~18 paid API calls per re-run) does not justify the refinement.

## 2026-04-29 — Claude — close CLAUDE.md inheritance investigation + small bench doc fixes

- Investigated the CLAUDE.md inheritance question raised in pilot (parent answered in Chinese, polycli claude in English on the same review task). **Not a bug.** CLAUDE.md inheritance works at the CLI layer (`claude -p`) and the polycli `ask` command — both respect the user's language preference. The English output observed in pilot came from `buildReviewPrompt` (`plugins/polycli/scripts/lib/review.mjs`), whose template is hardcoded English ("You are acting as <provider> inside polycli.", etc.); combined with the English diff payload, models default to English for `review`/`rescue`/`adversarial-review`. Treated as feature, not bug — multi-provider review benefits from a consistent prompt baseline. Spec followup updated.
- README: clarified "Bare-shell + probing" column meaning with a footnote pointing to `probing-cost.json`. The previous header could read as raw response bytes; clarification follows Codex review feedback.
- `docs/benchmarks/results-2026-04-29.md`: added a caveat noting that `qwen` `review` run #2 returned 1 byte at `exitCode: 0` (treated as success because exit code, not body, gates the bench's failure count). Median is unaffected; flagged for transparency.

## 2026-04-29 — Claude — add claude-prompting skill + bench path sanitization

- Added `plugins/polycli/skills/claude-prompting/SKILL.md`. Polycli previously had `gemini-prompting` / `kimi-prompting` / `qwen-prompting` / `minimax-prompting` but no per-provider prompt scaffolding for the `claude` provider. The new skill encodes claude-specific prompting guidance (CLAUDE.md does not propagate, same model family, stateless by default, error-surface notes).
- Hardened `scripts/bench-vs-bare-cli.mjs` with path sanitization: replaces `$HOME` with `~` in all stored stdout/stderr/parsedJson before writing results JSON. Earlier run leaked maintainer-local paths into `results-2026-04-29.json` because qwen rescue output hallucinated absolute paths under the bench cwd; `scripts/tests/open-source-hygiene.test.mjs` caught it.
- Re-sanitized the published `docs/benchmarks/results-2026-04-29.json` retroactively. `npm test` now passes 287/287.

## 2026-04-29 — Claude — first benchmark of polycli vs bare-shell CLI invocation

- Added `scripts/bench-vs-bare-cli.mjs`: N=3 live bench comparing path (a) `Bash(<provider> -p)` and path (c) `polycli-companion` for `gemini`/`qwen` × `ask`/`review`/`rescue`. Outputs `docs/benchmarks/results-<date>.{json,md}`.
- Collected `docs/benchmarks/probing-cost.json` (lower bound: `which` + `--help` only): gemini 3843 B, qwen 8077 B.
- Headline: with probing cost amortized, polycli reduces parent-context bytes by 69-98% across all six scenario × provider cells. Without probing cost, boundary bytes vary by cell with no consistent direction. polycli's token advantage comes from invocation-knowledge encapsulation, not output compression.
- Added README "Cost vs raw shell calls" section pointing at the results.
- Spec lifecycle (`tasks/bench-vs-bare-cli-spec.md`): two rounds of Codex sign-off, post-pilot amendment switching from fixture replay to live CLI calls (fixture replay was erasing probing cost), and a final Codex round-3 review that surfaced three blocks (missing `rescue` scenario, raw stdout not preserved for diagnosis, ±15% noise claim incorrect) — all fixed before publish.
- Path (b) disciplined-bare-shell deferred — needs Anthropic SDK to drive Claude programmatically; pilot data suggests (b) and (c) are close on boundary bytes.
- Followups noted in spec: add `claude-prompting` skill (no per-provider scaffolding for the `claude` provider in polycli today); investigate global CLAUDE.md inheritance into polycli subagent.

## 2026-04-29 — Codex — close post-release maintenance

- Merged all open Dependabot PRs after the v0.6.2 publication: `actions/setup-node` 4 -> 6, `actions/checkout` 4 -> 6, and `zod` 4.1.8 -> 4.3.6.
- Confirmed the public repo has no open PRs, `main` is clean at `fe4c6d6`, the latest release remains `v0.6.2`, and the published npm packages remain aligned with the release notes.
- Re-ran `npm test`, `npm run release:check`, and `npm audit --audit-level=moderate`; all passed, with 287/287 tests and 0 vulnerabilities.
- Confirmed GitHub Actions CI succeeded on the three post-release `main` push runs. GitHub social preview remains a repository settings UI upload using `docs/assets/social-preview.png`; GitHub CLI exposes no social preview image option.

## 2026-04-29 — Codex — finish v0.6.2 public release polish

- Added GitHub Actions CI, README release/OpenCode badges, and a social preview PNG derived from the README header SVG.
- Tightened public package metadata for `@bbingz/polycli-opencode`, `@bbingz/polycli-utils`, and `@bbingz/polycli-timing`.
- Replaced the long `release:check` shell command with `scripts/check-release.mjs`.
- Expanded open-source hygiene scanning to all tracked files and archived historical review/session docs under `docs/archive/`.

## 2026-04-29 — Codex — prepare v0.6.2 open-source hygiene patch

- Prepared host plugin manifests and OpenCode package for `0.6.2`; prepared `@bbingz/polycli-utils` and `@bbingz/polycli-timing` for `1.0.1`.
- Fixed the timing package tarball so `@bbingz/polycli-timing/schema` resolves to a packed `timing.schema.json`.
- Added package-local MIT `LICENSE` files for all public npm packages and open-source packaging tests that verify export targets and license inclusion from real `npm pack --dry-run --json` output.
- Removed the OpenCode adapter dependency on `@opencode-ai/plugin`, replacing it with a tiny local wrapper plus `zod`; `npm audit --audit-level=moderate` now reports 0 vulnerabilities.
- Scrubbed public fixtures and package AGENTS files of maintainer-local paths, host auth metadata, local memory metadata, and provider reasoning signatures; added a hygiene regression test for those patterns.
- Replaced the flaky wall-clock concurrency assertion in the health integration test with fake-provider start/end event overlap verification.
- `npm run release:check` passes end-to-end with 286/286 tests and publish dry-runs for `@bbingz/polycli-opencode@0.6.2`, `@bbingz/polycli-utils@1.0.1`, and `@bbingz/polycli-timing@1.0.1`.

## 2026-04-29 — Claude — v0.6.1 docs/legal patch shipped

- Bumped 6 manifest/package versions from `0.6.0` to `0.6.1`: `plugins/polycli-opencode/package.json`, `.claude-plugin/marketplace.json` (× 2 entries), `.github/plugin/marketplace.json` (× 2 entries), `plugins/polycli-codex/.codex-plugin/plugin.json`, `plugins/polycli/.claude-plugin/plugin.json`, `plugins/polycli-copilot/plugin.json`. `@bbingz/polycli-utils` and `@bbingz/polycli-timing` stay at `1.0.0` (no source changes).
- Drafted [`docs/release-notes-v0.6.1.md`](./docs/release-notes-v0.6.1.md) — docs/legal patch only: README rewrite + i18n (en/zh-CN/ja), root `LICENSE`, dead-absolute-path fix, latent fix specs filed in `tasks/`.
- Updated [`docs/release.md`](./docs/release.md) "Current Release State" to v0.6.1.

---

## 2026-04-29 — Claude — README rewrite + i18n + LICENSE

- Rewrote `README.md` from scratch as international-standard, English-default. Added clear hero pitch, "Why polycli" differentiation (4-state timing honesty, no fake unification, direct CLI passthrough), badges (npm version × 2, MIT license, Node ≥20), and a language switcher.
- Added translations: `README.zh-CN.md` (Simplified Chinese) and `README.ja.md` (Japanese). All three are full peers — not abbreviated versions. Technical terms (`runtime`, `streaming`, `session resume`, `Path B`, `monorepo`) kept in English by convention; Japanese version uses です・ます style.
- Added root `LICENSE` file (MIT, `Copyright (c) 2025 bbingz`) — the sub-packages already declared MIT, the root file was missing. GitHub `licenseInfo` was previously `null`; this fixes the License badge target and makes the project legally complete by community standards.
- Fixed dead links: previous README contained absolute paths like `/home/user/-Code-/polycli/...` that did not work on GitHub. All internal links are now repo-relative. Verified every referenced path exists.
- Restructured: hero → why → hosts/providers → install → quick start → core commands → capability matrix → timing semantics → packages → development → release → contributing → license. Old structure (Who This Is For, Background Jobs, Current Scope) removed or merged.

---

## 2026-04-29 — Claude — provider CLI upgrades + default-model audit

- Upgraded local provider CLIs to upstream latest: `copilot` 1.0.35 → 1.0.39, `kimi-cli` 1.37.0 → 1.40.0, `mini-agent` (git+main) refreshed to 2026-02-14 commit (deps: pydantic 2.13.2 → 2.13.3, uvicorn 0.44 → 0.46, sse-starlette 3.3 → 3.4). Five other CLIs (claude, gemini, qwen, opencode, pi) already at upstream latest.
- Verified kimi 1.40 and refreshed mini-agent stream-json compatibility via live probes. `kimi.test.js` 13/13 still pass; live `runKimiPromptStreaming` extracts response and sessionId correctly. mini-agent live probe parses 48 progress events, strips ANSI, extracts response.
- Ran 8-CLI default-model audit by spawning each provider with a "what model are you" prompt and reading polycli's `result.model`. Surfaced two latent bugs:
  - **`gemini.js:135`** takes `Object.keys(parsed.stats?.models ?? {})[0]` — first *attempted* model, not actually-used. Misleads when gemini-cli auto-falls-back from a 429-throttled preview (e.g. `gemini-3.1-pro-preview` → `gemini-2.5-pro` due to Google server-side preview capacity).
  - **`kimi.js:174`/`:264`** has `readKimiDefaultModel()` reading `~/.kimi/config.toml`, but it's only consumed by `getKimiAuthStatus`, never threaded into `runKimiPromptStreaming` / `runKimiPrompt` results — so `result.model` is null even when config has a default.
- Both fixes drafted as specs in `tasks/model-extraction-fixes.md` for Codex implementation. Non-breaking; target v0.6.x patch or v0.7.
- Memory: added `reference_cli_provider_versions.md` (per-CLI version-check + upgrade commands + gotchas), `reference_default_model_extraction_caveats.md` (which providers' `result.model` is unreliable and why), and `feedback_no_ask_for_nondestructive.md` (skip confirmation gates for sandboxed/read-only ops).

---

## 2026-04-24 — Claude — close R8 bookkeeping post-ship

- Relaxed the CLAUDE.md legacy-repo constraint to a permanent "allow grep, no edits" form (dropped the "R8 期间" conditional now that R8 is complete and R8g was cancelled).
- Updated `project_legacy_repos_reference.md` memory from "R8 convergence targets" to "permanent references; v0.6.0 absorbed their functionality".
- Added two new feedback memory entries: codex-rescue operational quirks (fire-and-forget wrapper, sandbox git-commit block, branch-name misreport) and release-ops gotchas (claude plugin validate Node 25 crash, npm 2FA TTY requirement).

---

## 2026-04-24 — Claude — v0.6.0 shipped

- Pushed `main` and tag `v0.6.0` (tag at `a95e3d8`).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.6.0 with notes from `docs/release-notes-v0.6.0.md`; no tarball asset attached (OpenCode users install from npm).
- Published `@bbingz/polycli-opencode@0.6.0` to npm; confirmed via `npm view @bbingz/polycli-opencode versions`.
- Closes roadmap R8a-R8f. R8g (legacy repo archival) deliberately skipped per user direction ("不用 archive"); four legacy plugin repos remain as read-only references on GitHub without archival status. `@bbingz/polycli-utils@1.0.0` and `@bbingz/polycli-timing@1.0.0` unchanged from v0.5.0; runtime stays private.

---

## 2026-04-24 — Claude — draft v0.6.0 release notes for R8 convergence

- Added `docs/release-notes-v0.6.0.md` covering R8a-R8e deliverables with a full legacy → polycli migration table (slash commands, kimi session flags, gemini approval/effort flags, subagent types, guidance skills, hooks).
- Flagged R8f as done; R8g (legacy repo archival + CLAUDE.md relaxation) still pending.
- Status: draft. Release date and version-bump execution held until user kicks off release prep.

---

## 2026-04-24 — Codex — port stop-time review gate hooks

- Added Claude Code SessionStart / SessionEnd / Stop hook registration for the polycli host plugin, with lifecycle state cleanup and the optional stop-review gate.
- Recorded the last-used ask/rescue provider in workspace state so the gate honors the user's current provider selection, with health-probe fallback when no provider is recorded.
- Added hook tests for lifecycle cleanup, multi-line ALLOW/BLOCK sentinel parsing, timeout skip behavior, and unresolvable-provider skip behavior.

---

## 2026-04-24 — Codex — add R8a/R8d unified flags

- Added Kimi-only `--resume-last` / `--resume <uuid>` / `--fresh` handling on `/polycli:ask` and `/polycli:rescue`, including wrapper-side session validation and resume-mismatch warnings.
- Added Gemini-only `--write` and `--effort low|medium|high` handling on the unified ask/rescue surface.
- Documented and tested unsupported-provider silent-drop notes for the new provider-specific flags.

---

## 2026-04-24 — Claude — open R8 legacy plugin convergence

- Reversed the prior non-goal "No migration of legacy sibling repos into this monorepo" after a capability gap audit against `gemini-plugin-cc` / `kimi-plugin-cc` / `qwen-plugin-cc` / `minimax-plugin-cc`.
- Added R8 to `docs/roadmap.md` with sub-items R8a–R8g: kimi session continuation; session-lifecycle + stop-time review gate hooks; per-provider guidance skills; rescue flag semantics; per-provider subagent types; namespace UX; legacy repo retirement.
- Updated `project_legacy_repos_reference.md` memory to flip the stance from "reference-only, never migrate" to "convergence targets under R8; grep-for-port OK, no edits."
- Narrowed the CLAUDE.md architecture-boundary constraint on legacy repos from "不要 grep、不要编辑" to "不要编辑; R8 期间允许 grep-for-port" (user-confirmed in same session).

---

## 2026-04-24 — Codex — v0.5.1 shipped

- Pushed `main` and tag `v0.5.1` (tag at `0b79c86`).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.5.1 with notes from `docs/release-notes-v0.5.1.md`; no tarball asset attached because OpenCode users install from npm.
- Published `@bbingz/polycli-opencode@0.5.1` to npm and confirmed it appears in `npm view @bbingz/polycli-opencode versions`.

---

## 2026-04-24 — Codex — prepare v0.5.1 release

- Bumped the four host plugin manifests and Claude/Copilot marketplace metadata from `0.5.0` to `0.5.1`.
- Drafted `docs/release-notes-v0.5.1.md` for the Q2/Q3 guardrail patch release.
- Release scope is host/plugin line only: publish `@bbingz/polycli-opencode@0.5.1`; keep utils/timing at `1.0.0` and runtime private.

---

## 2026-04-24 — Codex — close Q2 and Q3 with guardrails

- Closed Q2 by documenting the model fallback policy and adding a host integration test that proves cached setup model metadata is used only as the final `defaultModel` fallback when a provider stream omits model fields.
- Closed Q3 by accepting host-surface asymmetry as the durable design and adding `npm run validate:host-map` to keep `docs/host-command-map.md`, Claude commands, Codex/Copilot skills, OpenCode tools, and the companion dispatcher aligned.
- Refreshed `docs/roadmap.md` to mark R1-R7 and Q1-Q3 closed after v0.5.0.

---

## 2026-04-24 — Claude — v0.5.0 shipped

- Pushed `main` + tag `v0.5.0` (tag at 306c703 — R5 fixture replay pilot commit).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.5.0 (notes from `docs/release-notes-v0.5.0.md`).
- npm: **first public publishes** of `@bbingz/polycli-utils@1.0.0` and `@bbingz/polycli-timing@1.0.0`; `@bbingz/polycli-opencode@0.5.0` also published. All three confirmed via `npm search '@bbingz/'`.
- Closes roadmap R5 (Claude host fixture pilot), R6 (auth-probe transient-error regex named contracts), and Q1 (utils + timing published). Q2 and Q3 remain in "observing" state. Runtime stays private. 256/256 tests pass at release tag.

---

## 2026-04-24 — Claude — prepare v0.5.0 release

- Bumped the four host plugin release manifests and both host marketplace metadata entries from `0.4.2` to `0.5.0`.
- Drafted `docs/release-notes-v0.5.0.md` covering R6 (auth-probe regex contracts), P1/Q1 (utils + timing first public npm publish), and R5 (Claude fixture replay pilot).
- `release:check` passes end-to-end: 256/256 tests, manifest validation, plugin validation, `@bbingz/polycli-opencode@0.5.0` / `@bbingz/polycli-utils@1.0.0` / `@bbingz/polycli-timing@1.0.0` dry-run publishes all succeed.

---

## 2026-04-24 — Codex — pilot claude host integration fixture replay

- Added captured real Claude CLI stream fixtures for host-level `/ask` and `/health` success coverage.
- Added a host integration replay helper that surfaces missing fixture files explicitly and replays captured stream output through the bundled companion without changing other provider tests.
- Converted the Claude `/ask` success path to fixture replay and added a Claude `/health` success integration test that records timing from the replayed stream.

---

## 2026-04-24 — Codex — prepare utils and timing for first npm publish

- Made `@bbingz/polycli-utils` and `@bbingz/polycli-timing` publishable by removing `private: true` and adding npm metadata, package file lists, and public publish config while leaving `@bbingz/polycli-runtime` private.
- Refreshed both package READMEs and rewrote `docs/polycli-v1-public-surface.md` as the live v1 contract for utils + timing only.
- Added `pack:utils` / `pack:timing` scripts, updated manifest validation to require only runtime to stay private, and made `release:check` validate publishable packages repeatably: unpublished versions use `npm publish --dry-run`, already-published versions fall back to `npm pack --dry-run`.

---

## 2026-04-24 — Codex — name auth-probe transient-error regex contracts

- Extracted the transient auth-probe regexes in gemini / qwen / kimi / opencode / pi into provider-local `TRANSIENT_PROBE_ERROR_PATTERNS` exports without changing the existing match behavior.
- Added provider tests that assert the named patterns keep timeout-like probe failures in the `loggedIn=true` / inconclusive path while still treating explicit `401 Unauthorized` errors as genuine auth failures.

---

## 2026-04-24 — Claude — decide Q1 (publish utils/timing); annotate Q2/Q3 as observing

- User directive on 2026-04-24: publish `@bbingz/polycli-utils` and `@bbingz/polycli-timing` to npm ("能用就应该发"). Extended `docs/archive/review-2026-04-24-v0.5.0-spec.md` with a P1 (Q1) section covering manifest fields, README refresh, v1-public-surface rewrite, `pack:utils` / `pack:timing` scripts, and `release:check` extension with dry-run publishes.
- Q2 (model fallback sustainability) and Q3 (four-host surface convergence) marked "observing" in `docs/roadmap.md` per user direction: record the concern, do not act until a signal accumulates.
- Runtime (`@bbingz/polycli-runtime`) stays `"private": true`; this decision applies only to utils + timing.

---

## 2026-04-24 — Claude — close roadmap R4 + R7; refresh roadmap for v0.5.0

- Added `docs/host-command-map.md` — capability × host mapping for all 10 polycli commands across Claude Code / Codex / Copilot / OpenCode plus side-by-side invocation examples. Closes roadmap R4.
- Added `scripts/check-review-cli-drift.mjs` that probes installed provider CLIs and asserts the flags `/review` hard constraints depend on (`--tools` / `--approval-mode` / `--policy` / `--excluded-tools` / `--agent` / `--no-tools`) still exist. Env-var based constraints (MiniMax `MINI_AGENT_CONFIG_PATH`, OpenCode `OPENCODE_CONFIG_CONTENT`) are listed as manual-watch reminders. Wired as `npm run check:review-drift`. Closes roadmap R7.
- Refreshed `docs/roadmap.md`: removed the completed R1 / R2 / R3 / R4 / R7 entries, updated Current state to v0.4.2 / 250 tests, narrowed v0.5.0 scope to R5 + R6 + optional Q1/Q2/Q3 decisions.

---

## 2026-04-24 — Claude — v0.4.2 shipped

- Pushed `main` + tag `v0.4.2` (tag at 5c7f709 — R2 runtime fix commit).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.4.2 (notes from `docs/release-notes-v0.4.2.md`).
- npm: `@bbingz/polycli-opencode@0.4.2` published.
- Closes roadmap R1 (p2-p3-backlog merged; 511fceb dropped as superseded by 12d9ca9), R2 (minimax capability matrix + review.mjs YAML hardening + tmp cleanup), and R3 (v1 surface doc superseded). 250/250 tests pass at release tag.

---

## 2026-04-24 — Claude — prepare v0.4.2 release

- Bumped the four host plugin release manifests and both host marketplace metadata entries from `0.4.1` to `0.4.2`.
- Drafted `docs/release-notes-v0.4.2.md` covering the R1 (spawn cancellation / arg parsing / stream JSON scalars / performance.now timing) and R2 (review.mjs YAML scalar + tmp cleanup) roadmap closures.
- `release:check` passes end-to-end: 250/250 tests, manifest validation, plugin validation, `@bbingz/polycli-opencode@0.4.2` dry-run publish.

---

## 2026-04-24 — Codex — harden review config parsing and temp cleanup

- Replaced MiniMax review config scalar extraction with a small private parser that supports plain, single-quoted, and double-quoted scalars while rejecting unsupported block/folded and malformed YAML forms.
- Registered review temp files for best-effort cleanup on process exit so generated per-review config directories do not accumulate across long-running hosts.
- Added regression coverage for supported scalar forms, unsupported block scalars, malformed config lines, comment handling, and child-process exit cleanup.

## 2026-04-24 — Codex — land P2/P3 runtime backlog hardening

- Landed the surviving `p2-p3-backlog` runtime commits as one squash: `spawnStreamingCommand` now supports AbortSignal cancellation, stdout decoder overflow protection, stdin drain handling, and post-settle output suppression.
- Hardened runtime reliability around MiniMax log-read failures, provider exit error formatting, and registry timing by switching prompt duration measurement to monotonic `performance.now()`.
- Tightened shared utility and timing edge cases: argument parsing rejects malformed empty booleans / unterminated quotes, stream JSON parsing recognizes arrays and bare scalar values, and timing validation rejects invalid numeric bounds.

## 2026-04-24 — Claude — add provider capability matrix and supersede v1 surface doc

- Added a provider capability matrix to root `README.md` (streaming / sessionResume / structuredOutput / ttft / gen / tail / tool) sourced from `packages/polycli-runtime/src/registry.js`. Surfaces `minimax`'s session-resume / structured-output / streaming-timing limits in the root doc instead of only in `plugins/polycli-opencode/README.md`, and explains why `qwen`'s `tool: "missing"` is semantically distinct from the other seven providers' `tool: "unsupported"`.
- Prepended a Superseded banner to `docs/polycli-v1-public-surface.md` (v0.3 snapshot) pointing to the live surface sources (`README.md`, `registry.js`, `timing.js`, `CHANGELOG.md`, `docs/roadmap.md`). Content below the banner is preserved as historical reference.
- Updated `CLAUDE.md` Must-read list: added `docs/roadmap.md`, relabeled the v1 surface doc as a v0.3 snapshot / not a live constraint. Closes roadmap R3 (Path B) and R2 (minimax matrix).

---

## 2026-04-24 — Claude — v0.4.1 shipped

- Pushed `main` + tag `v0.4.1` (HEAD at eaddbbd).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.4.1 (notes from `docs/release-notes-v0.4.1.md`).
- npm: `@bbingz/polycli-opencode@0.4.1` published. Earlier suspicion that v0.4.0 had never reached npm was a token-expired false positive; `npm view` confirms 0.3.0 / 0.4.0 / 0.4.1 all present.
- Closes the review loop that began with `docs/archive/review-2026-04-24.md`. All 8 bugs from `docs/archive/review-2026-04-24-bugs.md` (B1–B8) plus FU1–FU3 release-prep follow-ups landed. 221/221 tests pass at release tag.

---

## 2026-04-24 — Codex — lift ask response model to top level for all providers

- Six provider runtimes (claude / gemini / kimi / minimax / opencode / pi) now populate the top-level `model` field on ask results, matching qwen and copilot.
- Added a `defaultModel` pass-through in the registry so the host companion can supply a cached `getAuthStatus` value as a final fallback when the provider's own events do not carry a model.
- Per-provider fixture and fallback assertions lock the new contract; integration smoke tests assert non-null `model` for all 8 providers.

---

## 2026-04-24 — Codex — fix observed host-companion bugs

- Normalized provider CLI availability details to the first non-empty line so multi-line version banners no longer break `setup` text rendering.
- Made `--json` errors structured for argument and lookup failures, added subcommand `--help` short-circuiting, and validated `timing --provider` / `--history` inputs.
- Aligned `cancel` no-op exit behavior and flattened `result --json` so completed job payloads expose `response`, `ok`, `sessionId`, and `timing` at the top level while retaining `job` metadata.

---

## 2026-04-24 — Codex — prepare v0.4.1 release

- Bumped the four host plugin release manifests and host marketplace metadata from `0.4.0` to `0.4.1`, while keeping internal workspace packages on the `1.0.0` line.
- Marked `@bbingz/polycli-utils` and `@bbingz/polycli-timing` as private internal bundler inputs, matching `@bbingz/polycli-runtime`.
- Removed the Copilot adapter from the Claude marketplace now that Copilot has its own marketplace, and kept release manifest validation wired into `release:check`.

## 2026-04-24 — Codex — fix pi duplicate terminal text and pin default model

- Fixed the pi JSON stream parser so visible assistant text is sourced from `text_delta` when present, with terminal `message_end` / `turn_end` / `agent_end` text only used as a fallback; this removes the repeated final-answer concatenation seen in live pi runs and saved fixtures.
- Pinned the default pi model to `openai-codex/gpt-5.4` so host-driven `ask` calls no longer depend on whatever ambient pi config happens to select.
- Updated pi fixture expectations and added focused regression coverage for both the duplicate-terminal-summary case and the default-model invocation contract.

## 2026-04-24 — Codex — harden ask-path visibility for qwen and kimi

- Added prompt-runtime constraints for prompt-bearing commands so `ask` now applies the missing host-level visibility guards: `kimi` gets `--no-thinking --max-steps-per-turn 1`; `qwen` gets `--max-session-turns 1` plus a forced visible-final-answer system prompt.
- Added focused regression coverage for those ask-path constraints and the shared helper that computes them, closing the gap where `/review` was hardened but `/ask` was still unconstrained.
- Extended fake provider integration fixtures so qwen/kimi can simulate thought-only output when constraints are absent; this makes the failure mode observable in CI instead of only via live session history.
- Verification on `main`: `npm test` passed `191/191`; live non-Claude smoke (`gemini`, `kimi`, `qwen`, `minimax`, `copilot`, `opencode`, `pi`) all returned successful `setup` + `ask`, with `qwen`/`kimi` now producing visible final `OK` through `polycli`.

## 2026-04-22 — Claude — v0.4.0 shipped

- Pushed `main` + tag `v0.4.0` (HEAD at 08f84c3).
- GitHub release live at https://github.com/bbingz/polycli/releases/tag/v0.4.0 (notes from `docs/release-notes-v0.4.0.md`).
- npm: `@bbingz/polycli-opencode@0.4.0` published; `npm view` confirms no propagation lag.
- Closes the review loop that began with `docs/archive/review-2026-04-22.md`. All P0/P1 from that review plus P3 fixture migration landed. 185/185 tests pass at release tag.

## 2026-04-22 — Claude — Group 4 / 5 / release specs for Codex

- Appended three spec sections to [docs/archive/review-fb64b1e.md](docs/archive/review-fb64b1e.md):
  - Group 4: P2 host-plugin hygiene (appendPreview O(n²), previewText emoji, auto-scope shallow-clone diagnostics) — one-commit batch.
  - Group 5: real-CLI saved-stdout fixture migration (per-provider capture list, replay helper design, scope guards against running capture in CI).
  - Release checklist: v0.4.0 step-by-step with explicit Codex / user / Claude role split for each step.
- Created [tasks/lessons.md](tasks/lessons.md) with the "stay in reviewer role" correction — do not slip into implementation mode when the division of labor is Claude-reviews-Codex-implements.

## 2026-04-22 — Claude — Verdict on commit 95b003c (Group 2 + 3 complete)

- Appended verdict A to [docs/archive/review-fb64b1e.md](docs/archive/review-fb64b1e.md): atomic-save durability + `/review` CLI hard constraints both landed; `npm test` 171/171.
- Codex's Phase 1 research ([docs/archive/review-cli-flags.md](docs/archive/review-cli-flags.md)) corrected 4 of 6 CLI-flag hypotheses from the original review against locally installed CLIs + primary sources.
- Non-overridable review constraint decision documented and enforced via `assertNoReviewConstraintOverride`.
- Original review P0/P1 scope now 100% closed. P2/P3 move to release backlog.

## 2026-04-22 — Claude — Verdict on commit 6636b7a + Group 2/3 instructions

- Appended verdict to [docs/archive/review-fb64b1e.md](docs/archive/review-fb64b1e.md): Group 1 landed cleanly (P1-C / P1-D / P1-E / registry gemini branch), 152/152 tests passing.
- Group 2 (atomic-save durability) and Group 3 (/review CLI hard constraints) now have concrete per-file fix specs appended to the same doc, including test plans and scope guards.
- Group 3 requires a Phase 1 research pass (per-provider CLI flag verification) before Phase 2 code changes; suggested output is a short memo at `docs/archive/review-cli-flags.md`.

## 2026-04-22 — Claude — Follow-up review of commit fb64b1e

- Authored [docs/archive/review-fb64b1e.md](docs/archive/review-fb64b1e.md): verdict A- on Codex's fix batch.
- All 6 P0 items fixed with correct semantics + 23 new regression tests (npm test: 146/146).
- P1 fixed: A (transient probe), B (session-id fall-through), G (jobs/<id>.json locking), H (stdout-as-error paths).
- P1 deferred for next batch: C (generic event.text fallback), D (copilot/opencode type:"error" capture), E (gemini hasVisibleText), F (atomic-save fsync), I (/review CLI hard constraints), plus registry `isTerminalSummaryEvent` gemini branch.
- Recommended next-commit grouping: Group 1 (streaming parser consistency = C+D+E+registry); Group 2 (atomic-save durability = F); Group 3 (/review constraints = I).

## 2026-04-22 — Claude — Full implementation review (for Codex handoff)

- Authored [docs/archive/review-2026-04-22.md](docs/archive/review-2026-04-22.md): 4-agent parallel review across utils+timing, runtime core, 8 provider adapters, and host plugin (~5,200 LoC source, ~117 raw findings).
- Report is structured as P0 (6 ship blockers) → P1 (9 high-risk themes) → P2 (parser / timing / process / host grouped) → P3 (gaps and nits).
- Flagged one runtime-core agent recommendation to REJECT: `timing.js:66, 73` hardcoding `cold` / `retry` as `unsupported` is correct per the documented project decision; do not change to `missing`.
- No source code touched; review doc only.

## 2026-04-22 — Claude — Repo onboarding scaffolding

- Added `CLAUDE.md` at repo root: thin Claude-Code-specific patches layered on top of `AGENTS.md` (architecture boundary, test command priority, provider gotchas).
- Added this `CHANGELOG.md` to satisfy cross-AI collaboration convention from the user's global rules.
- Seeded project memory under `~/.claude/projects/-Users-bing--Code--polycli/memory/` with `MEMORY.md` index and layered entries (user / project / feedback / reference).
- No source code touched; no tests run (docs/infra only).
