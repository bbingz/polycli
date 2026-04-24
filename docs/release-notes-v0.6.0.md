# Release Notes Draft - v0.6.0

Status: draft covering R8 legacy plugin convergence. Release date target: TBD.

Scope: absorb the four sibling per-provider Claude Code plugins (`gemini-plugin-cc` / `kimi-plugin-cc` / `qwen-plugin-cc` / `minimax-plugin-cc`) into the polycli host plugin surface. Users now install one plugin instead of five for the same functionality. Minor version bump justified by new surface area (per-provider guidance skills, lifecycle hooks, stop-time review gate, and provider-specific flags) and by the deprecation of the legacy namespace UX.

## Highlights

- **`/polycli:ask` and `/polycli:rescue` now carry provider-specific flags previously exclusive to the legacy plugins**: Kimi session continuation (`--resume-last`, `--resume <uuid>`, `--fresh`) and Gemini approval / reasoning-budget (`--write`, `--effort low|medium|high`). Unsupported flag + provider combinations emit a single-line note and continue without it — no silent misbehavior.
- **Session-lifecycle and stop-time review gate hooks now ship with polycli**. Opt-in per workspace (`stopReviewGate` flag, togglable via `/polycli:setup --enable-review-gate` / `--disable-review-gate`). The gate honors the user's current provider (last-used ask/rescue provider with health-probe fallback), not a pinned reviewer.
- **12 namespaced per-provider guidance skills** (`polycli:kimi-prompting`, `polycli:gemini-result-handling`, etc.) ported from the legacy plugins preserving their prompt-engineering content verbatim, including all references subdocs (antipatterns, recipes, prompt-blocks, command-render docs).
- **One generic `polycli:polycli-provider-agent` subagent** replaces the four per-provider subagents. Callers pass `--provider <name>` in the prompt.
- **Unified namespace UX**: `/kimi:ask` → `/polycli:ask --provider kimi`. See the migration guide below. The four legacy plugins become redundant with this release.

## Migration Guide

All legacy slash commands have a one-to-one polycli equivalent. Replace the provider prefix with `/polycli:` and pass `--provider <name>` as a flag.

### Slash commands

| Legacy                             | polycli                                          |
|------------------------------------|--------------------------------------------------|
| `/<provider>:ask <prompt>`         | `/polycli:ask --provider <provider> <prompt>`    |
| `/<provider>:rescue <prompt>`      | `/polycli:rescue --provider <provider> <prompt>` |
| `/<provider>:review`               | `/polycli:review --provider <provider>`          |
| `/<provider>:adversarial-review`   | `/polycli:adversarial-review --provider <provider>` |
| `/<provider>:setup`                | `/polycli:setup --provider <provider>`           |
| `/<provider>:status`               | `/polycli:status`                                |
| `/<provider>:cancel`               | `/polycli:cancel`                                |
| `/<provider>:result`               | `/polycli:result`                                |
| `/<provider>:timing`               | `/polycli:timing --provider <provider>`          |

`<provider>` ∈ `{gemini, kimi, qwen, minimax}` (plus the four already-unified providers `claude / copilot / opencode / pi`).

### Kimi session continuation

| Legacy                         | polycli                                                     |
|--------------------------------|-------------------------------------------------------------|
| `/kimi:continue <prompt>`      | `/polycli:ask --provider kimi --resume-last <prompt>`       |
| `/kimi:resume <uuid> <prompt>` | `/polycli:ask --provider kimi --resume <uuid> <prompt>`     |
| (implicit fresh session)       | `/polycli:ask --provider kimi --fresh <prompt>`             |

Same flags apply to `/polycli:rescue --provider kimi`. Pre-spawn session validation and post-spawn resume-mismatch warnings are preserved verbatim from the legacy kimi plugin (guards against the kimi-cli ghost-session bug).

### Gemini approval and reasoning budget

| Legacy behavior                       | polycli flag                                |
|---------------------------------------|---------------------------------------------|
| `/gemini:rescue --write`              | `/polycli:rescue --provider gemini --write` |
| `/gemini:rescue --effort low`         | `/polycli:rescue --provider gemini --effort low` |
| `/gemini:rescue --effort medium`      | `/polycli:rescue --provider gemini --effort medium` |
| `/gemini:rescue --effort high`        | `/polycli:rescue --provider gemini --effort high` |

Same flags apply to `/polycli:ask --provider gemini`. `--effort` maps to the gemini `--thinking-budget` tiers: `low → auto`, `medium → balanced`, `high → thorough`.

### Subagents

| Legacy                        | polycli                            |
|-------------------------------|------------------------------------|
| `kimi:kimi-agent`             | `polycli:polycli-provider-agent` with `--provider kimi` in the prompt |
| `gemini:gemini-agent`         | `polycli:polycli-provider-agent` with `--provider gemini` in the prompt |
| `qwen:qwen-rescue`            | `polycli:polycli-provider-agent` with `--provider qwen` in the prompt |
| `minimax:minimax-agent`       | `polycli:polycli-provider-agent` with `--provider minimax` in the prompt |

Usage example (from another agent / loop context):

```js
Agent({
  subagent_type: "polycli:polycli-provider-agent",
  prompt: "--provider kimi --resume-last Refactor the session cache module. Context: ..."
})
```

### Guidance skills

Legacy skill ids are prefixed with `polycli:` under the unified plugin. Content is preserved verbatim (including the `references/*.md` subdocs); only path and slash-command references are rewritten to the unified surface.

| Legacy                               | polycli                                   |
|--------------------------------------|-------------------------------------------|
| `kimi:kimi-prompting`                | `polycli:kimi-prompting`                  |
| `kimi:kimi-result-handling`          | `polycli:kimi-result-handling`            |
| `kimi:kimi-cli-runtime`              | `polycli:kimi-cli-runtime`                |
| `gemini:gemini-prompting`            | `polycli:gemini-prompting`                |
| `gemini:gemini-result-handling`      | `polycli:gemini-result-handling`          |
| `gemini:gemini-cli-runtime`          | `polycli:gemini-cli-runtime`              |
| `qwen:qwen-prompting`                | `polycli:qwen-prompting`                  |
| `qwen:qwen-result-handling`          | `polycli:qwen-result-handling`            |
| `qwen:qwen-cli-runtime`              | `polycli:qwen-cli-runtime`                |
| `minimax:minimax-prompting`          | `polycli:minimax-prompting`               |
| `minimax:minimax-result-handling`    | `polycli:minimax-result-handling`         |
| `minimax:minimax-cli-runtime`        | `polycli:minimax-cli-runtime`             |

### Hooks

`SessionStart`, `SessionEnd`, and `Stop` hooks ship automatically with the polycli plugin. Opt-in the stop-time review gate per workspace:

```bash
# Enable in the current workspace
/polycli:setup --enable-review-gate

# Disable (default)
/polycli:setup --disable-review-gate
```

The gate spawns `/polycli:adversarial-review` with the user's current provider (`lastUsedProvider` from workspace state, falling back to the first healthy provider). Budget: 15 minutes. On timeout or unresolvable provider, the gate skips cleanly rather than blocking.

### What's NOT ported

- **`/minimax:task-resume-candidate`** — legacy informational command (v0.1 only). Use `/polycli:status` instead for job-state inspection.

## User-Facing Changes

- **New flags** on `/polycli:ask` and `/polycli:rescue`: `--resume-last`, `--resume <uuid>`, `--fresh` (kimi-only); `--write`, `--effort low|medium|high` (gemini-only). Unsupported combinations emit a single-line stderr note and continue.
- **New flags** on `/polycli:setup`: `--enable-review-gate`, `--disable-review-gate` (toggles the stop-time review gate in the current workspace's state file).
- **New automatically-installed hooks** (`SessionStart`, `SessionEnd`, `Stop`). The Stop hook is opt-in and no-ops until the gate is enabled.
- **New skills** under the `polycli:` namespace (12 per-provider trios: prompting / result-handling / cli-runtime).
- **New subagent**: `polycli:polycli-provider-agent`.

No breaking changes to existing polycli slash commands — every pre-v0.6.0 invocation continues to work.

## Changes Since v0.5.1

- `packages/polycli-runtime/src/kimi.js` — `resolveKimiResumeSession` wrapper performs pre-spawn UUID validation and session-existence check; post-spawn mismatch detection emits a warning when the returned session id differs from the requested one.
- `packages/polycli-runtime/src/gemini.js` — `buildGeminiInvocation` maps `--write` to `--approval-mode auto_edit` and `--effort low|medium|high` to `--thinking-budget auto|balanced|thorough`. New test coverage in `packages/polycli-runtime/test/{kimi,gemini,exports}.test.js`.
- `plugins/polycli/scripts/polycli-companion.mjs` — new top-level flag parsing for the R8a/R8d flags; silent-drop layer emits per-provider notes from the legacy `drop silently + brief note` template; `--enable-review-gate` / `--disable-review-gate` on setup.
- `plugins/polycli/scripts/lib/state.mjs` — new `lastUsedProvider` field persisted on every successful ask/rescue, plus `readLastUsedProvider` / `writeLastUsedProvider` / `resolveWorkspaceRoot` helpers. Atomic write + lock inlined, not via polycli-utils (matches the Path B boundary).
- `plugins/polycli/hooks/hooks.json` — new; registers SessionStart (60s budget), SessionEnd (60s budget), and Stop (910s = 15min + buffer) hooks.
- `plugins/polycli/scripts/session-lifecycle-hook.mjs` — new; lifecycle state cleanup, running-job survival across sessions.
- `plugins/polycli/scripts/stop-review-gate-hook.mjs` — new; multi-line ALLOW/BLOCK sentinel parse (kimi prose-preamble-tolerant), 15-min timeout that skips cleanly, provider resolution chain (`lastUsedProvider` → first healthy → skip).
- `plugins/polycli/prompts/stop-review-gate.md` — new; stop-gate prompt template.
- `plugins/polycli/skills/` — new; 12 `SKILL.md` files plus 19 `references/*.md` subdocs.
- `plugins/polycli/agents/polycli-provider-agent.md` — new; generic forwarder subagent.
- `plugins/polycli/commands/ask.md`, `rescue.md`, `setup.md` — updated with new flag documentation.

## Test Coverage

- `npm test`: **277/277** pass (up from 257 at v0.5.1). Breakdown of the 20 new tests:
  - 3 kimi runtime tests (resume session validation, mismatch warning, invalid-id rejection).
  - 1 gemini runtime test (`--write` / `--effort` mapping).
  - 1 runtime exports snapshot update.
  - 4 host integration tests (gemini flag parsing, kimi resume flag parsing, unsupported-flag silent-drop note, kimi mismatch warning).
  - 1 host integration test (foreground ask records `lastUsedProvider`).
  - 10 hook tests (hooks.json registration shape, SessionStart/SessionEnd lifecycle, sentinel parse with prose preamble, timeout skip, provider resolution chain).
- No existing test modified in behavior.

## Notes for Maintainers

- Four legacy plugin repos (`gemini-plugin-cc` / `kimi-plugin-cc` / `qwen-plugin-cc` / `minimax-plugin-cc`) become redundant with this release and should be archived (roadmap R8g). Do **not** delete the repos — they remain useful for diff archaeology.
- After shipping v0.6.0, relax the CLAUDE.md legacy-repo constraint from the current "`不要编辑`; R8 期间允许 grep-for-port" back to a permanent "`不要编辑`" only. R8's grep exception was scoped to this release cycle.
- The `polycli:polycli-provider-agent` subagent has a doubled namespace by Claude Code's plugin-prefix convention. If this reads awkwardly in practice, revisit naming in a later minor release.
- The hooks manifest registers on workspaces that have polycli installed even if the user never configured the stop-gate. The lifecycle hooks are cheap (60s budget); the Stop hook fast-paths out when `stopReviewGate` is false, so the default install should not be perceptible.

## Non-Goals / Intentionally Deferred

- **No auto-migration tooling.** Users adapt command invocations by hand using the migration table above. A one-off `polycli migrate` helper is not worth the maintenance cost given the regular pattern of the rewrite.
- **No per-provider subagent shim types** (no `polycli:kimi`, `polycli:gemini`, etc.). Decision locked in the 2026-04-24 planning session: one generic subagent keeps the plugin small; callers that wired against the legacy `kimi:kimi-agent` namespace update their `subagent_type` and include `--provider` in the prompt.
- **No per-provider command namespace shims** (no `/polycli:kimi:ask`, etc.). Decision locked in the same session: the unified `/polycli:ask --provider kimi` surface is the target; muscle-memory cost is accepted.
- **`/minimax:task-resume-candidate` not ported.** Legacy informational-only command; superseded by `/polycli:status`.
- **Runtime package stays private.** `@bbingz/polycli-runtime` unchanged from v0.5.0; still bundled into host plugins, not published.
- **No timing schema changes.** The four-state contract (`measured` / `zero` / `missing` / `unsupported`) is unchanged; no new `cold` / `retry` metrics.
