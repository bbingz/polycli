# Provider Paths

Snapshot: 2026-06-15. Review monthly, before release, and whenever a provider CLI or local default model changes.

This table is a routing reference for humans and host adapters. It is not an automatic routing oracle. `opencode`, `pi`, and `cmd` are model routers, so their "best path" depends on the user's authenticated local model set.

## Current best paths

| Model family / need | Primary Polycli provider path | Secondary path | Notes |
|---|---|---|---|
| Claude Code / Anthropic coding agent | `claude` | `opencode` Anthropic models | Default polycli `ask`/`review` now uses official headless `claude -p` with plan/no-tools/no-MCP constraints, returning synchronous JSON/stream JSON output. Detached tmux TUI remains available in runtime for explicit/internal callers that need an interactive Claude Code session. |
| Gemini | `gemini` | none | Official CLI headless `-p`, `--approval-mode plan`, JSON/stream JSON. Keep isolated cwd and disabled extensions/MCP for review. |
| Qwen Code / Qwen Coding Plan | `qwen` | `opencode` Alibaba Coding Plan models | Official Qwen Code default `maxSessionTurns=-1` means do not force ask to one turn. Polycli ask uses a bounded `maxSteps=20`, `approvalMode=plan`, and `--exclude-tools`; review uses the same no-tool stance. SDK `canUseTool` is a better future path if Polycli moves beyond CLI wrapping. |
| Kimi coding | `kimi` (kimi-code v0.6.0) | `opencode` Kimi For Coding models | The `-p` one-shot runner is non-interactive and rejects `--plan`/`--auto`/`--yolo`, so ask uses a plain `-p` invocation and review is prompt-only (like minimax). Default model from `~/.kimi-code/config.toml`. |
| MiniMax text / multimodal | `minimax` via `mmx-cli` | `opencode` MiniMax Coding Plan models | Use official `mmx text chat --message ... --output json --non-interactive`; this replaces `mini-agent` log scraping. |
| OpenCode Go / Xiaomi MiMo / Alibaba / multi-provider routing | `opencode` | `pi` for Xiaomi MiMo | Local `opencode auth list` is the source of truth; `~/.config/opencode/opencode.json` can show an empty provider object even when credentials and models exist. Current local OpenCode includes Xiaomi Token Plan, Alibaba Coding Plan, Kimi, MiniMax, Anthropic, and OpenCode Go routes. |
| Xiaomi MiMo-V2.5-Pro | `opencode` with OpenCode Go/Xiaomi Token Plan | `pi` default Xiaomi route | Screenshot state is consistent with OpenCode using Xiaomi Token Plan / OpenCode Go, not an empty provider. |
| DeepSeek V4 Pro | `cmd` | `opencode-go/deepseek-v4-pro` | User's current Command Code setup routes `cmd` to DeepSeek V4 Pro. Keep `cmd` ask/review in `--permission-mode plan`; rescue may use broader agent mode. |
| Antigravity coding agent | `agy` | none | Ask/rescue use Antigravity's session mode with `--dangerously-skip-permissions` because the CLI has no enforceable non-interactive plan/read-only mode. `/review` is intentionally unsupported until the upstream CLI exposes a safe review mode. |
| xAI Grok Build CLI | `grok` | none | Uses Grok one-shot JSON/streaming JSON mode. `ask` uses `--always-approve`; `review` composes the one-shot path with `--permission-mode plan`. |
| Copilot / Codex-backed fallback | `copilot` | OpenAI Responses API / Agents SDK for new direct integrations | Keep Copilot provider as a fallback, but Polycli ask/review must not pass allow-all tool/path/url flags. Use restricted `--excluded-tools` and retain `--no-ask-user` only for programmatic execution. |
| OpenAI GPT / Codex direct programmatic work | not a Polycli CLI provider today | OpenAI Responses API, Agents SDK | For new stateless direct integrations, official SDK/API is more appropriate than wrapping another CLI. |

## Review procedure

Run the automated review-flag subset first, then the manual provider-path probes:

```bash
npm run check:provider-paths
opencode auth list
opencode models --refresh
cmd --version && cmd --help
qwen --help
kimi --help
gemini --help
claude --help
copilot --help
mmx text chat --help
pi --help
agy --help
grok --help
```

`npm run check:provider-paths` currently aliases `check-review-cli-drift`; it verifies the automatable review hard-constraint flags only. The remaining commands in this section are the manual provider-path review.

If a CLI is not installed locally, record it as skipped rather than failing the release. If a checked flag disappears, update `plugins/polycli/scripts/lib/review.mjs`, `plugins/polycli/scripts/lib/prompt-runtime.mjs`, tests, and this table in the same change.

## Official references checked

- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code permission modes: https://code.claude.com/docs/en/permission-modes
- Gemini CLI headless / CLI docs: https://google-gemini.github.io/gemini-cli/docs/cli/
- Qwen Code approval mode: https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/
- Qwen Code SDK tool callback: https://qwenlm.github.io/qwen-code-docs/en/developers/sdk-python/
- OpenCode CLI / agents docs: https://opencode.ai/docs/cli/ and https://opencode.ai/docs/agents/
- GitHub Copilot CLI command reference: https://docs.github.com/copilot/reference/cli-command-reference
- GitHub Copilot CLI modes/autopilot: https://docs.github.com/copilot/concepts/agents/copilot-cli/about-copilot-cli
- MiniMax CLI docs: https://platform.minimax.io/docs/token-plan/minimax-cli and https://github.com/MiniMax-AI/cli
- xAI Grok Build CLI docs: https://docs.x.ai/docs/grok-build/introduction
- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses/create
