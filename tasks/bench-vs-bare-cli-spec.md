# Bench: polycli vs bare-CLI invocation

Status: approved + amended post-pilot (2026-04-29). Ready for implementation.

## Why

User observed that capable agents (e.g. Codex CLI) can directly shell-invoke `gemini -p` / `qwen -p` without going through polycli, raising the question: is the plugin redundant?

This benchmark answers that with data. If the answer turns out to be "yes, redundant for this use case" — that is also a valid result and we adjust positioning accordingly.

## Null hypothesis

> Under matched answer quality and acceptable latency, polycli does not significantly reduce parent-Claude-context growth versus a *disciplined* bare-shell workflow.

Falsification condition: in `review` and `rescue` scenarios, polycli shows < 20% reduction in boundary output volume against the disciplined bare-shell path.

If falsified, the conclusion is "polycli's value is not token economy, it is operator ergonomics" — still a valid product positioning, just not the one we currently advertise.

## Scope: what this bench measures

Three-way path comparison, **not** two-way (this is the key correction from Codex review):

| Path | Description |
|---|---|
| (a) naive bare-shell | Claude runs `Bash(gemini -p "...")`, full stdout enters parent context |
| (b) disciplined bare-shell | Claude runs CLI, then summarizes stdout itself before continuing |
| (c) polycli subagent | `polycli-provider-agent` digests raw output, returns summary across subagent boundary |

Comparing only (a) vs (c) is a strawman — an experienced user would never do (a). The honest question is (b) vs (c).

### Probing cost (post-pilot correction)

A naive baseline accounting hides polycli's largest token advantage. Before Claude can run *any* `Bash(gemini -p ...)` it does not yet know how to invoke, it must:

1. probe binary presence (`which gemini`)
2. read help output (`gemini --help`)
3. possibly try a small invocation to confirm flags
4. decide on `-p` vs `chat` vs `--output-format json` etc.

Every one of those probe turns dumps stdout/stderr into parent context. Polycli skips this entirely — `polycli-provider-agent` already encodes provider invocation. **The bench MUST account for probing cost on paths (a) and (b)** or it systematically under-reports polycli's advantage.

Operationalization: each provider × scenario run starts in a "cold" Claude conversation that has not previously invoked that provider. Probe turns count toward boundary bytes for paths (a)/(b). Path (c) gets zero probing cost (polycli encapsulates it).

This is the single most important amendment from pilot.

### Measuring probing cost

The bench runner is a Node script and cannot itself drive Claude through a probing conversation. So:

- **Probing cost is collected once per provider, manually**, by running a fresh Claude Code conversation with no prior knowledge of `<provider>`, asking it to perform `ask`/`review`/`rescue` against that provider via shell, and recording the total stdout/stderr bytes it pulled into context before reaching the actual CLI invocation.
- The collected number is stored in `docs/benchmarks/probing-cost.json` (per-provider) and added as a constant to the boundary-bytes total for paths (a) and (b) in every report.
- Re-collect probing cost when the upstream CLI's help output or invocation surface changes materially.

This is approximate but defensible: the alternative (driving Claude programmatically via Anthropic SDK from the bench script) is correct but multiplies implementation work. Start with manual probe cost; upgrade if the answer hinges on it.

## Scenario matrix

| Scenario | Why included |
|---|---|
| `ask` | short Q&A — predicted small gap, useful as floor |
| `review` | structured findings, long output — predicted large gap |
| `rescue` | long-context investigation — tests whether subagent boundary holds under volume |

Providers: `gemini`, `qwen` (most-used pair; expand later if signal warrants).

**`rescue` task scoping**: don't issue open-ended "investigate this codebase" prompts (variance too high). Use a fixed bug-fix task with a known reproducer — e.g. "given this 50-line file with one `await` missing on line N, identify and propose the fix". This makes quality assertion tractable. If runs vary >15% on this scenario, annotate "high variance, more samples needed" rather than dropping.

## Out of scope for this bench (separate artifact)

`adversarial-review`, `background job`, `session resume`, `stop-review-gate`, `4-state timing` have **no bare-shell equivalent**. Forcing them into a token comparison is dishonest — there is nothing to compare against. These ship as a separate `docs/benchmarks/capability-matrix.md` listing presence/absence per workflow, not quantified.

## Measurements

**Primary metric: boundary output bytes**

Measure the bytes crossing into the parent Claude context:
- Path (a): `len(raw stdout)`
- Path (b): `len(Claude's self-summary)` — captured from a scripted disciplined-summary prompt
- Path (c): `len(subagent return value)` — captured at the polycli-provider-agent boundary

This avoids the unsolved problem of measuring per-turn parent context token delta from Claude Code CLI directly. `chars / 4` token estimation is biased on code/CJK/tool-metadata; reporting bytes (with an estimated-token annotation) keeps the relative ranking robust.

**Secondary metrics**:
- End-to-end wall-clock (from invocation to result available in parent context)
- Output finding count (for `review`) / answer length (for `ask`/`rescue`) — quality proxy
- Per-path retry count and error rate

**Disclaimer to include in every report**: byte ranking does not equal token ranking. Code, CJK text, and tool metadata tokenize at different rates. The relative byte ratio is robust; absolute token estimates are not.

## Source of CLI output

**Live CLI calls** for paths (a) and (b); **live polycli subagent** for path (c).

Earlier draft proposed fixture replay. Pilot exposed this as wrong: fixture replay erases the probing cost on paths (a)/(b) (Claude doesn't need to discover how to invoke a CLI when the fixture already contains its output). That under-reports polycli's advantage by exactly the amount the spec is trying to measure.

Cost of going live:
- Provider variance and auth flakiness — mitigate with N=3 runs per cell, take median
- Network latency — affects wall-clock secondary metric, not boundary-bytes primary
- Real money for API calls — accept this; bench is published once per release, not in CI

Tasks must be deterministic enough that quality variance across runs is low. Use closed-form review/ask tasks with stable expected outputs (e.g. review a fixed code blob with known defects).

## Disciplined-summary prompt for path (b)

Path (b) requires a fixed prompt template that Claude uses to self-summarize bare CLI stdout. Without this, (b) is undefined and the comparison drifts. Proposed template (refine during implementation):

> "The above is raw output from `<provider>`. Summarize it preserving: verdict, top 3 findings by severity, file paths and line numbers. Drop boilerplate, repeated context, and findings below `medium` severity. Plain prose, no headers."

This must be applied uniformly across all (b) runs.

**Model pinning**: paths (b) and (c) both perform a summarization step. They must run on the same Claude model so the diff measures path structure, not model capability. Record the model version in the results JSON `meta` field for reproducibility.

## Deliverables (this PR)

1. `scripts/bench-vs-bare-cli.mjs` — runs paths (a) naive-bare-shell and (c) polycli-companion live; emits `docs/benchmarks/results-<date>.json` + `.md` summary
2. `docs/benchmarks/probing-cost.md` — manual-collected probing-cost transcripts per provider, summed into report
3. README pointer: short paragraph + link to the most recent results doc

**Path (b) deferred**: requires driving Claude programmatically (Anthropic SDK) to run the disciplined-summary step. The repo currently has no Anthropic SDK dep and pilot data suggests (b) and (c) will be close (polycli's compression at the boundary appears minimal — the dominant advantage is probing cost). Add (b) in a follow-up if (a) vs (c) leaves the question open.

## Follow-up (separate PR, different cadence)

`docs/benchmarks/capability-matrix.md` — non-quantified bare-shell-has-no-equivalent workflows. Split out because bench needs data runs to publish, capability matrix can be written immediately. Different release cadence; bundling them couples a fast deliverable to a slow one.

## Reporting format

Markdown table per scenario:

```
Scenario: review (provider: gemini)
| Path                    | Boundary bytes | Wall-clock ms | Findings | Notes |
| (a) naive bare-shell    | 4,820          | 1,210         | 7        | full stdout |
| (b) disciplined bare    | 1,140          | 1,510         | 7        | +1 summary turn |
| (c) polycli subagent    | 380            | 1,430         | 7        | subagent boundary |
```

Plus a one-line headline per scenario: "polycli reduces boundary bytes by X% vs disciplined bare-shell."

## Resolved (Codex round-2)

1. **Boundary bytes is publishable.** Add disclaimer that byte ranking ≠ token ranking due to code/CJK/tool-metadata tokenization variance. No need to chase actual Claude Code parent-context token delta.
2. **Model pinning required** between paths (b) and (c). Both must run on the same Claude model; record the version in results JSON.
3. **Keep `rescue`**, scope its fixture to the final tool-return stdout only (not full session traces). Annotate variance > 15% rather than dropping.
4. **Split capability matrix into a follow-up PR.** Different release cadence — bench needs data runs, matrix can ship immediately.

## Non-goals

- Measuring polycli's own internal overhead (subagent spawn cost, JSON parse cost) — separate concern
- Cross-model quality comparison (that's `benchmark-models` skill's job)
- Live CLI smoke tests — those exist as `health` workflow already

## Followups identified during pilot (2026-04-29)

- **Add `claude-prompting` skill.** polycli currently has gemini/kimi/qwen/minimax-prompting but no claude-prompting. Means the claude provider path gets no per-provider prompt scaffolding. User flagged this during pilot. Tracked here so it doesn't drop.
- **Investigate CLAUDE.md inheritance into polycli subagent.** Pilot showed native Agent responded in Chinese (inherited global CLAUDE.md) while polycli claude responded in English. **Resolved 2026-04-29: not a bug, by design.** CLAUDE.md inheritance works correctly at the CLI layer (`claude -p`) and at the polycli `ask` command. The English output came from `buildReviewPrompt` in `plugins/polycli/scripts/lib/review.mjs`, whose template is hardcoded English ("You are acting as <provider> inside polycli.", "Run a code review...", etc.). Combined with the English git diff payload, the model defaults to English for `review`/`rescue`/`adversarial-review`. `ask` remains language-neutral (passes through user prompt verbatim). Treating this as a feature, not a bug — multi-provider review outputs benefit from a consistent prompt baseline.
