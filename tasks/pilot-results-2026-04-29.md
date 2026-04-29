# Pilot results: native Agent vs polycli claude

Date: 2026-04-29
Spec: `tasks/bench-vs-bare-cli-spec.md`
Status: pilot data, awaiting Codex validation

## Setup

- **Task**: review a fixed ~30-line JS snippet with known defects (SQL injection, off-by-one, missing await ×2, weak password check, indentation, semicolons)
- **Path X**: `Agent(subagent_type="general-purpose", prompt=<task>)`
- **Path Y**: `Agent(subagent_type="polycli:polycli-provider-agent", prompt="--provider claude\n<task>")`
- **Prompt**: identical body, no per-path tuning. Aligned only (no natural variant — polycli has no `claude-prompting` skill, so aligned == natural for this provider)
- **Provider model**: not pinned. Whatever each path defaults to.
- **Runs per path**: 1 (pilot, single-shot)

## Raw measurements

| Metric | Path X (native) | Path Y (polycli) | Δ |
|---|---|---|---|
| Boundary bytes | 2807 | 2708 | -3.5% |
| Boundary chars | 1755 | 2690 | +53% |
| Findings count (severity buckets) | 11 | 6 | -45% |
| Wall-clock | ~22s | ~43s | +95% |
| Output language | Chinese | English | confound |

## Quality cross-check

Both paths caught the same 4 critical/high issues:
- Line 4 SQL injection
- Line 4 missing `await` / N+1
- Line 12-13 off-by-one
- Lines 19-20 missing `await` × 2

Path X added more low-severity findings (semicolons, indentation, return-shape suggestions). Path Y bundled some of these into a single bullet ("missing semicolons in several places"). Finding-count delta likely reflects granularity choice, not skip-vs-cover.

## Observations (and what they suggest)

1. **Boundary bytes nearly identical.** 3.5% in noise range. Polycli's wrapper layer does not visibly compress output at the subagent boundary on this task.
2. **Wall-clock 2× slower for polycli.** Companion script + subagent boundary + claude CLI spawn add ~21s of overhead for a 22s baseline task.
3. **No prompt engineering boost from polycli on claude provider.** No `claude-prompting` skill exists. Native Agent and polycli ran the same prompt against the same model family.
4. **Result-handling skill did not visibly summarize.** The `gemini-result-handling.md` file says "preserve verdict, summary, findings, next-steps structure" — implementation appears to honor "preserve" without "summarize". Output is full review, not condensed.

## Confounds (must address before formal bench)

1. **Output language differs.** Native Agent inherited global CLAUDE.md's "always respond in Chinese" rule; polycli subagent ran in English. UTF-8 byte counts collide — Chinese is ~3 bytes/char, English ~1 byte/char. This masks any real boundary-bytes difference.
2. **Global CLAUDE.md inheritance unclear.** Either polycli companion strips it, runs from a different cwd, or claude CLI spawn doesn't see it. Pilot can't tell which.
3. **Model not pinned.** Both paths use defaults but defaults may differ (Claude Code main model vs whatever `claude` CLI defaults to today).
4. **N=1.** Single run per path. Wall-clock difference could be cold-start variance.

## Tentative conclusion (low confidence)

Pilot data suggests polycli's value on the claude provider is **not boundary-byte savings**. It may still be:
- Standardized invocation pattern (slash commands, job control)
- Per-provider prompting scaffolding (only when the skill exists — not for claude today)
- Result format consistency across providers

If formal bench confirms this, the README and positioning need to stop implying token economy as polycli's main value, and instead emphasize ergonomics + multi-provider consistency.

## Questions for Codex

1. Is this pilot directionally trustworthy enough to inform spec changes, or is N=1 + language confound fatal?
2. The "compress at subagent boundary" hypothesis appears falsified for claude provider. Should we (a) repeat for gemini provider where prompting skill exists, (b) accept the result and rewrite positioning, or (c) something else?
3. Is the wall-clock 2× cost actually news, or expected given subagent + companion + CLI spawn? Worth instrumenting in formal bench?
4. Confound #1 (output language) — is the right fix to force English output in both paths via prompt, or to fix polycli's CLAUDE.md inheritance first?
