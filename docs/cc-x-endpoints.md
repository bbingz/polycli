# cc-X endpoint recipes (no native CLI cluster)

Snapshot: 2026-06-19. Reference only — not a routing oracle, and **not a polycli runtime**. Review monthly, before release, and whenever a vendor endpoint changes. The machine-readable source of truth is [`cc-x-recipes.json`](./cc-x-recipes.json); this page is its human narration. Re-verify any row against its `source` URL before relying on it.

## What cc-X is

"cc-X" is the pattern of pointing a top-tier agentic-coding harness at a domestic LLM vendor's **Anthropic-compatible** endpoint with three standard environment variables:

```bash
export ANTHROPIC_BASE_URL="https://api.<vendor>/anthropic"
export ANTHROPIC_AUTH_TOKEN="<your vendor key>"   # BYOK
export ANTHROPIC_MODEL="<vendor model id>"
```

The harness is **Claude Code** for vendors with no competitive native coding CLI, or **opencode** when the target is an OpenAI-compatible model. cc-X wins for the no-native-CLI cluster because it is the best-AVAILABLE, co-designed, and 5-18x-cheaper scaffold — **not** because Claude Code is the highest-scoring harness (controlled ablations show other open models score higher under other harnesses; that nuance lives in the vendor system cards, not here, per the `docs/roadmap.md` Q7 source discipline that forbids citing un-sourced benchmark scores).

Provider grouping:

- **No competitive native coding CLI → cc-X is the path:** MiniMax, DeepSeek, Zhipu/GLM, StepFun.
- **Has a native CLI → cc-X is a choice, not a default:** Moonshot (Kimi Code), Alibaba (Qwen Code), ByteDance (Trae / trae-agent), Baidu (Comate Zulu-CLI), Tencent (CodeBuddy Code), Xiaomi (MiMo Code).

## How this rides existing polycli runtimes

cc-X is **not** a polycli provider, adapter, or runtime, and this PR adds none. The recipe runs through the EXISTING `claude` runtime (BYOK env, no vendor CLI) or `opencode` (OpenAI-compatible models). polycli already forwards `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`:

- On the default headless `claude -p` path, the runtime inherits the full `process.env`, so all three (and the `CLAUDE_CODE_*` knobs below) pass through unchanged.
- On the explicit/internal tmux TUI path, the runtime forwards only an `ANTHROPIC_*` allowlist (`CLAUDE_TMUX_ENV_EXACT` in `packages/polycli-runtime/src/claude.js`). The three `ANTHROPIC_*` vars pass through there too, **but `CLAUDE_CODE_AUTO_COMPACT_WINDOW` / `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` are NOT in that allowlist and will not reach a tmux session.** Set those two knobs on the default `claude -p` path, or export them inside the tmux session itself.

There is no code to add: set the env vars and run `claude` (or polycli's `claude` provider) normally.

## Operational gotchas (durable)

These are the hard-won knobs the recipes encode. Per-entry specifics (base URLs, model-id families, per-vendor context window) live in `cc-x-recipes.json`.

1. **Prompt caching is silently degraded on shim endpoints.** Claude Code's single cache-breakpoint produces a near-zero hit rate against MiniMax / Kimi shims, so the system prompt + tool schemas get re-billed every turn. Mitigation: use a dual cache-breakpoint and verify the gateway does not gate caching on whether the model is literally named `claude`. **DeepSeek is the exception** — it does automatic server-side prefix caching, so no client mitigation is needed.
2. **Pin a known-good Claude Code version and set `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`.** Claude Code auto-attaches experimental `anthropic-beta` headers that periodically 400 third-party endpoints on upgrade.
3. **Set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to the model's real context** or Claude Code compacts prematurely. Per-model values are in `cc-x-recipes.json` (`autoCompactWindow`): e.g. DeepSeek 128000, Kimi 262144, MiniMax-M3 512000. `null` means we deliberately did not pin one.
4. **Marketplace endpoints have no stable model identity.** See the next section.

## Marketplace endpoints: honest-default refusal to pin

Baidu Qianfan and Tencent's coding gateway are **resale/marketplace** endpoints (`marketplace: true`, `status: "marketplace-unstable"`). One `ANTHROPIC_MODEL` string can silently resolve to a different vendor or version, there is no client-side version pinning, and 2026 price hikes mean model identity is not stable over time. The recipe file deliberately leaves `autoCompactWindow: null` and ships no pinned model id for these entries — fabricating a stable pin would repeat exactly the "attempted vs used model" dishonesty already documented for gemini in [`docs/model-fallback-policy.md`](./model-fallback-policy.md). Treat the model string you send as a *request*, not a guarantee.

## Data sovereignty is a separate gate

PRC data-residency and Entity-List exposure are a **separate** decision from harness choice. The levers are intl endpoints, zero-retention terms, or self-hosted open weights (GLM-5.x MIT, Kimi mod-MIT, Qwen Apache-2.0) — not anything polycli does. China ToS does **not** make cc-X fragile: BYOK + a non-Anthropic base URL is documented and supported by Anthropic. The residual risk is indirect (export-screening could kill the native-Claude fallback; Anthropic could later gate the client), not a ToS trap.

## Not the same as the polycli `minimax` provider

polycli already has a `minimax` provider that calls official `mmx-cli` (`mmx text chat --output json --non-interactive`). That is a **stateless text/media call**, not the MiniMax cc-X coding path. If you want MiniMax-M2/M3 as a coding agent, use the cc-X recipe above (Claude Code against `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`), not the `minimax` provider. The `MiniMax text / multimodal` row in [`provider-paths.md`](./provider-paths.md) is the stateless-call path; this page is the coding-agent path.

## Official references checked

Each recipe entry in `cc-x-recipes.json` carries its own `source` URL + date. Re-verify there before relying on a base URL or model id.
