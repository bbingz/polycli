# Default-model extraction fixes

Two latent bugs in polycli's `result.model` extraction, surfaced by the 2026-04-29 8-CLI default-model audit. Non-breaking accuracy improvements. Target v0.6.x patch or v0.7.

Owner: Codex (per `feedback_claude_reviews_codex_implements` memory).

---

## Fix 1 — gemini extracts attempted, not used model

**Site:** `packages/polycli-runtime/src/gemini.js:135`

```js
// current
model: Object.keys(parsed.stats?.models ?? {})[0] || defaultModel,
```

**Bug:** `gemini-cli` auto-falls-back when the requested preview returns 429 (`"No capacity available for model X on the server"` — Google server-side preview capacity, not user quota). `parsed.stats.models` is a dict keyed by every model attempted; `Object.keys(...)[0]` returns the *first attempted*, which is the throttled one.

**Reproduced 2026-04-29:** gemini 0.40 default attempted `gemini-3.1-pro-preview`, server returned 429, CLI fell back to `gemini-2.5-pro` and continued. polycli reported `gemini-3.1-pro-preview`.

**Options (need a real `--output-format json` payload from a fallback session to pick):**
- (a) `Object.keys(parsed.stats?.models ?? {}).at(-1)` — last attempted (cheapest, may be wrong if there are >2 fallbacks)
- (b) Detect `Falling back` / `429` in stderr, prefer the post-fallback name
- (c) Iterate `parsed.stats.models` and pick the entry with non-zero output token count (= the one that actually generated)

(c) is most semantically correct. Capture a fallback session's stats payload first to confirm schema shape.

**Test:** add a fixture in `gemini.test.js` where `stats.models` has ≥2 entries (one throttled with 0 output tokens, one used with non-zero). Verify `result.model` matches the used one.

---

## Fix 2 — kimi `readKimiDefaultModel` not threaded into streaming result

**Sites:**
- `packages/polycli-runtime/src/kimi.js:174` — `readKimiDefaultModel()` defined
- `kimi.js:264` — only consumed by `buildKimiAuthStatus`
- `kimi.js:347` (`runKimiPrompt`) and `:404` (`runKimiPromptStreaming`) — fallback chain stops at `defaultModel` (caller-supplied), never reads config

**Bug:** kimi 1.40 stream-json events are `{role, content[]}` with no top-level `model` field, so `parsed.model` is null. `runKimiPromptStreaming({...})` returns `result.model: null` even when `~/.kimi/config.toml` has `default_model = "kimi-code/kimi-for-coding"`.

**Proposed fix:**

```js
// kimi.js:347 (runKimiPrompt) and :404 (runKimiPromptStreaming)
const configModel = readKimiDefaultModel();
return {
  ...result,
  model: parsed.model ?? model ?? defaultModel ?? configModel,
};
```

Compute `configModel` once at result-assembly time (not per event). The current `readKimiDefaultModel()` does sync `fs.readFileSync` — fine for a one-shot at the end of a run; do NOT hot-path it inside `parseKimiStreamText` or `onEvent`.

**Test:** in `kimi.test.js`, mock `~/.kimi/config.toml` with a known `default_model`, run `runKimiPromptStreaming` against a stream fixture with no model field, verify `result.model === <config value>`. Also verify `getKimiAuthStatus.model` agrees with `result.model` (both should land on the config value).

---

## Out of scope (upstream / config quirks, not polycli bugs)

- `pi --help` says default is `google` but actual default comes from `~/.pi/agent/settings.json` (`defaultProvider` / `defaultModel`).
- `mini-agent` doesn't expose model in stream-json — no PyPI release, vendor-level "Mini-Agent (powered by MiniMax)" only. `result.model` will stay `null` until upstream adds the field.
- `qwen` LLM self-reports the CLI product name ("qwen-code") instead of model ID when asked. Adapter's `event.model` extraction is correct; LLM self-report is unreliable.
