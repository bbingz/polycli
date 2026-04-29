# Follow-up Spec — B6 `ask` response `model` lifting

**Status (2026-04-24):** ✅ implemented by Codex and shipped in commit `eaddbbd fix: lift provider models into ask results`. Folded into the v0.4.1 release scope (not deferred to v0.4.2 as this spec originally anticipated). Retained as retrospective documentation — the scope guards, `defaultModel` threading, and per-provider test expectations below describe what actually shipped. `npm test` reports **221/221** pass after the change (up from 219 during the review pass).

Reviewer verdict against the spec:

- ✅ Only the six listed providers (claude / gemini / kimi / minimax / opencode / pi) touched; `qwen.js` and `copilot.js` untouched (host bundle files rebuilt, but source unchanged).
- ✅ `registry.js` threads `defaultModel` through both `runProviderPrompt` and `runProviderPromptStreaming`; fallback order is `result.model || defaultModel` (event-based extraction first, fallback only on miss).
- ✅ Host companion implements `cacheProviderModel(...)` during `inspectProvider` and feeds the cached value through `execution.defaultModel` into ask / review / health.
- ✅ Per-provider fixture assertions + `registry.test.js` fallback-path test added; integration smoke covers all 8 providers.
- ✅ Live 8-provider ask smoke (real CLIs, not fixtures) confirmed every provider now reports a real model:
  - gemini → `gemini-3.1-pro-preview`
  - kimi → `kimi-code/kimi-for-coding`
  - qwen → `qwen3.6-plus`
  - minimax → `MiniMax-M2.7-highspeed`
  - claude → `claude-opus-4-7[1m]`
  - copilot → `gpt-5.4`
  - opencode → `opencode-go/mimo-v2-pro`
  - pi → `openai-codex/gpt-5.4`
- Additional coverage beyond the original spec: OpenCode's stream does not carry model, so Codex pulls it from `opencode export <session>` session metadata. Kimi's auth.model now falls back to the local default model from kimi config. Pi falls back to its pinned default `openai-codex/gpt-5.4` when the event has no model.

---

Original spec (authored before Codex executed) follows. It was the second-pass Codex handoff after commit `150ce3e fix: harden companion error and result handling` closed 7 of 8 bugs from `docs/archive/review-2026-04-24-bugs.md`. B6 was the remaining one.

## Context

Running `ask --provider <p> --json "..."` against all 8 providers on 2026-04-24 showed:

| provider | `response.model` (top-level) | `resultEvent` / `stats` / `meta` contains model? |
|----------|------------------------------|--------------------------------------------------|
| claude   | `null`                       | yes — stream-json `init` event emits `model` |
| copilot  | `"gpt-5.4"` ✓               | already lifted |
| gemini   | `null`                       | yes — `result.stats.models` has one key |
| kimi     | `null`                       | yes — result event emits model when present |
| qwen     | `"qwen3.6-plus"` ✓          | already lifted |
| minimax  | `null`                       | yes — `meta.model` |
| opencode | `null`                       | yes — `resultEvent.model` |
| pi       | `null`                       | yes — `resultEvent.model` |

Six of eight providers emit a model identifier **somewhere** in the ask response, but only two lift it to the top-level `model` field. Consumers wanting "who answered" have to probe provider-specific paths.

`setup --json` already reports a model for more providers than this (for example, `gemini-3.1-pro-preview`, `MiniMax-M2.7-highspeed`) because the auth-probe layer extracts it. The ask-response path has not kept pace.

## Scope

Target the six provider modules that currently return `model: null` at the top level:

- `packages/polycli-runtime/src/claude.js`
- `packages/polycli-runtime/src/gemini.js`
- `packages/polycli-runtime/src/kimi.js`
- `packages/polycli-runtime/src/minimax.js`
- `packages/polycli-runtime/src/opencode.js`
- `packages/polycli-runtime/src/pi.js`

Leave `qwen.js` and `copilot.js` alone — they already populate the field correctly and we want to preserve their behavior as the reference.

## Proposed fix

For each of the six providers' `runXxxPrompt` **and** `runXxxPromptStreaming` paths, extract the model from the most reliable source in the emitted events and include it in the returned object as a top-level `model` field. Preferred extraction sources per provider (listed in priority order; first match wins):

- **claude**: `resultEvent.model` (emitted in the final `result` event) → else the `model` field from the `init` / `system` event captured at stream start.
- **gemini**: `Object.keys(resultEvent.stats?.models ?? {})[0]` — gemini reports models as an object keyed by name.
- **kimi**: `resultEvent.model` if the kimi result event emits it; else `null`.
- **minimax**: `meta.model` or `resultEvent.model` — both appear on the log-replay path.
- **opencode**: `resultEvent.model` (opencode emits it on the final event).
- **pi**: `resultEvent.model` (pi emits it on the `turn_end` or `agent_end` event).

If none of the above is available for a given provider on a given run, fall back to the value cached from the most recent `getAuthStatus({ cache: true })` call for that provider. Do not call `getAuthStatus` synchronously from the ask path — it is slow. Instead:

- At registry dispatch time (`runProviderPromptStreaming` / `runProviderPrompt` in `registry.js`), accept an optional `defaultModel` arg — the host passes whatever it has cached from its last `inspectProvider` call.
- The provider module uses `defaultModel` only as the final fallback when all event-based extraction fails.

This keeps the provider runtimes event-driven while still giving consumers a non-null model in practice.

### Important non-goals

- Do not change `TIMING_SUPPORT` or `RUNTIMES.capabilities` in `registry.js`.
- Do not change the provider CLIs' invocation arguments.
- Do not introduce a shared "model extractor" abstraction — each provider has its own emission shape, keep the extraction inlined in the provider module. The fallback to `defaultModel` is the only cross-provider mechanism.
- Do not touch `qwen.js` or `copilot.js`. They are the reference; any behavioral change in them would be a regression.

## Test plan

### New per-provider assertions (fixture-replay)

For each of the six provider test files (`claude.test.js`, `gemini.test.js`, `kimi.test.js`, `minimax.test.js`, `opencode.test.js`, `pi.test.js`):

1. Identify the existing `stream-success` fixture that already captures a real CLI run.
2. Add one assertion after the existing "response equals expected text" assertion: `assert.ok(result.model && typeof result.model === "string" && result.model.length > 0, \`${provider} ask result must carry a non-empty model\`);`
3. If the fixture does not emit a model anywhere, the test must fail **with a clear message** pointing to the provider module — this is the signal that either the fixture needs re-capture, or the provider CLI does not emit a model (in which case the `defaultModel` fallback path must be tested separately — see below).

### Fallback-path test (one place, covers the policy)

In `packages/polycli-runtime/test/registry.test.js`, add a test that:

1. Calls `runProviderPromptStreaming` with `defaultModel: "fallback-model"` for a provider whose fixture was stripped of its model fields.
2. Asserts the returned `result.model === "fallback-model"`.

This locks the contract: "event-based extraction first, defaultModel only on miss".

### Integration smoke test

Extend the parameterized provider smoke test in `plugins/polycli/scripts/tests/integration.test.mjs` to assert `result.model` is a non-empty string for each of the 8 providers. This is the end-to-end regression guard.

## Delivery order (single focused commit)

1. Update the six provider modules (claude / gemini / kimi / minimax / opencode / pi) to lift `model`.
2. Update `registry.js` to thread `defaultModel` through `runProviderPrompt*`.
3. Update host companion dispatch (`plugins/polycli/scripts/polycli-companion.mjs`) to pass the cached `auth.model` from `inspectProvider` into the dispatch call.
4. Add the tests (six per-provider + one fallback-path + one integration).
5. `npm test` must stay at ≥217 passing.
6. Bump host plugin manifests from `0.4.1` → `0.4.2` in a follow-up release-prep commit (keep scope split: fix commit + release commit, as `c4922a4` / `150ce3e` demonstrated for v0.4.1).

## CHANGELOG entry

When committing, append to root `CHANGELOG.md` (reverse chronological, in English):

```
## 2026-MM-DD — Codex — lift ask response model to top level for all providers

- Six provider runtimes (claude / gemini / kimi / minimax / opencode / pi) now populate the top-level `model` field on ask results, matching qwen and copilot.
- Added a `defaultModel` pass-through in the registry so the host companion can supply a cached `getAuthStatus` value as a final fallback when the provider's own events do not carry a model.
- Per-provider fixture assertions lock the new contract; integration smoke test asserts non-null `model` for all 8 providers.
```

## Scope guard summary

| Allowed to touch | Not allowed to touch |
|------------------|----------------------|
| `packages/polycli-runtime/src/{claude,gemini,kimi,minimax,opencode,pi}.js` | `packages/polycli-runtime/src/{qwen,copilot}.js` |
| `packages/polycli-runtime/src/registry.js` (add `defaultModel` threading) | `packages/polycli-runtime/src/timing.js` |
| `packages/polycli-runtime/test/{claude,gemini,kimi,minimax,opencode,pi}.test.js` | Timing four-state semantics — unrelated |
| `packages/polycli-runtime/test/registry.test.js` (fallback test) | Host companion beyond `defaultModel` plumbing |
| `plugins/polycli/scripts/polycli-companion.mjs` (pass cached `auth.model`) | Any `docs/*.md` except `CHANGELOG.md` |
| `plugins/polycli/scripts/tests/integration.test.mjs` (per-provider smoke) | Any plugin manifest until the separate release-prep commit |
