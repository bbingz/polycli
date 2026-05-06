# Review CLI Hard-Constraints Research

Date: 2026-04-22; updated 2026-05-06 for `cmd` / Command Code

Scope: `claude`, `gemini`, `copilot`, `opencode`, `pi`, `cmd`, `minimax`

Goal: find a provider-specific way to make `/review` one-shot and tool-disabled, or record that no direct CLI flag exists and a one-shot config/policy override is required instead.

Test rule for this memo:

- "Confirmed" means the flag/config knob exists in the current locally installed CLI and was checked with `--help`, `--version`, local installed source, or official primary docs.
- "Hard no-tools" means the model should not see or invoke tools at all, not just "write tools ask for approval".
- Hypotheses from `docs/archive/review-fb64b1e.md` were treated as starting points only. Several were wrong or incomplete.

## Versions checked

| Provider | Local version | Verification |
|---|---:|---|
| claude | `2.1.117` | `claude --version` |
| gemini | `0.38.2` | `gemini -v` |
| copilot | `1.0.34` | `copilot --version` |
| opencode | `1.14.20` | `opencode -v` |
| pi | `0.68.1` | `pi -v` |
| cmd / Command Code | `0.25.2` | `cmd --version`, official CLI reference |
| minimax / mini-agent | `0.1.0` | `mini-agent -v` |

## Findings

| Provider | Finding | Recommended `/review` constraint |
|---|---|---|
| claude | Direct flag exists. `--tools ""` disables all tools; `--max-turns 1` keeps the run single-turn. | `--max-turns 1 --tools ""` |
| gemini | `--approval-mode plan` is only read-only mode, not no-tools. Official policy engine supports `toolName="*"` + `decision="deny"` and says global deny hides tools from model memory. | Keep `--approval-mode plan`, plus `--policy <deny-all-policy.toml>` |
| copilot | No direct "disable all tools" flag. `--available-tools=''` is not usable: current local parser filters empty strings and treats the option as absent. Official docs confirm `--excluded-tools` hides tools from the model. | Exhaustive `--excluded-tools=...` denylist over all documented tool-availability values; keep `--no-ask-user`; do not rely on empty allowlist |
| opencode | No direct no-tools CLI flag. `--agent plan` is restricted but only downgrades permissions to `ask`; with current runtime `--dangerously-skip-permissions` that is not safe. Official docs support one-shot config override through `OPENCODE_CONFIG_CONTENT` / `OPENCODE_CONFIG`, and `permission: "deny"` disables all actions. | Remove `--dangerously-skip-permissions` for review runs, set `--agent plan`, inject one-shot config with `permission: "deny"` |
| pi | Direct flag exists. `--no-tools` disables built-in and extension tools. | `--no-tools` |
| cmd | Direct documented permission mode exists. Command Code plan mode can read/search/analyze but cannot modify files, run shell commands, or apply patches. | `--permission-mode plan` |
| minimax | No no-tools CLI flag. Local installed source shows config YAML booleans for every tool family and `MINI_AGENT_CONFIG_PATH` selects the config file. | Generate one-shot config YAML with every tool family disabled, point `MINI_AGENT_CONFIG_PATH` at it |

## Provider Notes

### Claude

Local `claude --help` shows:

- `--max-turns <n>`
- `--tools <tools...>` with help text: use `""` to disable all tools

Local parser check:

- `claude --tools '' --help` exits `0`

Conclusion:

- The earlier `--disallowed-tools <exhaustive list>` hypothesis is unnecessary.
- The stronger and simpler constraint is `--tools ""`.

### Gemini

Local `gemini --help` confirms:

- `--approval-mode <default|auto_edit|yolo|plan>`
- `--policy`

Official Gemini CLI docs confirm:

- `--approval-mode plan` is read-only mode, not no-tools. Plan Mode still allows a limited set of read/search/subagent tools.
- Policy Engine global `deny` rules hide tools from model memory.
- Wildcard `toolName = "*"` matches any tool.

Practical conclusion:

- `--approval-mode plan` alone is insufficient for `/review`.
- Strongest one-shot constraint is a temporary TOML policy file:

```toml
[[rule]]
toolName = "*"
decision = "deny"
priority = 999
interactive = false
```

- Passing that file with `--policy <file>` gives true no-tools behavior in headless review runs.
- Keeping `--approval-mode plan` on top is still reasonable as a second safety layer.

### Copilot

Local `copilot --help` and `copilot help permissions` confirm:

- `--available-tools`
- `--excluded-tools`
- tool availability filtering is distinct from allow/deny permission prompts

Official GitHub Docs confirm:

- `--available-tools` restricts the visible tool set
- `--excluded-tools` removes tools from the visible set
- filtered-out tools stay unavailable even if permissions are otherwise broad

Important local-source finding:

- Current installed source (`/opt/homebrew/lib/node_modules/@github/copilot/app.js`) normalizes `availableTools` by filtering out empty strings and returning `undefined` if nothing remains.
- Therefore `--available-tools=''` does **not** create an empty allowlist. It becomes "no filter".

Conclusion:

- The "empty allowlist" hypothesis is false on the current CLI.
- The safe review implementation is an exhaustive `--excluded-tools` list covering every documented tool-availability value:

`bash,read_bash,write_bash,stop_bash,list_bash,powershell,read_powershell,write_powershell,stop_powershell,list_powershell,view,create,edit,apply_patch,task,read_agent,list_agents,grep,glob,web_fetch,skill,ask_user`

Notes:

- `--no-ask-user` should remain.
- `--allow-all-tools` becomes irrelevant once the model-visible tool set is empty, but review should not rely on that interaction staying stable forever.

### OpenCode

Local `opencode run --help` confirms:

- `--agent <name>`
- `--dangerously-skip-permissions`
- no direct `--no-tools` / `--read-only` flag

Official OpenCode docs confirm:

- built-in `plan` agent is restricted, but only via permissions set to `ask` for file edits and bash
- config supports `permission: "deny"` to block all actions
- one-shot config override can be injected with `OPENCODE_CONFIG` or `OPENCODE_CONFIG_CONTENT`

Conclusion:

- `--agent plan` alone is not a hard no-tools guarantee.
- Current runtime default `--dangerously-skip-permissions` must not be present on review runs.
- Review should inject a one-shot config override such as:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "deny"
}
```

- Recommended review mode:
  - omit `--dangerously-skip-permissions`
  - add `--agent plan`
  - pass `OPENCODE_CONFIG_CONTENT=<json>`

### Pi

Local `pi --help` confirms:

- `--no-tools` disables all tools by default
- `--tools <tools>` is an allowlist when read-only or partial access is desired

Local parser check:

- `pi --no-tools --help` exits `0`

Conclusion:

- `--no-tools` is the correct `/review` hard constraint.
- The earlier "maybe pi has no tool support" hypothesis is false. Pi exposes `read`, `bash`, `edit`, `write`, and extension tools.

### Command Code

Official Command Code CLI reference confirms:

- `-p`, `--print [query]` runs in headless mode, writes the response to stdout, and exits.
- `--skip-onboarding` skips taste onboarding for automated runs.
- `--permission-mode <mode>` accepts `standard`, `plan`, and `auto-accept`.
- `cmd status` is the documented auth-status subcommand.

Official plan-mode docs confirm:

- Plan mode can read the codebase, search files, analyze architecture, and propose plans.
- Plan mode cannot modify files, run shell commands, or apply patches.

Conclusion:

- `/review` should pass `--permission-mode plan`.
- Normal `ask` / `rescue` should use headless mode without `--yolo`, relying on Command Code's documented default headless behavior that denies file writes, file edits, and shell commands.
- Headless mode documents each invocation as a standalone session, so runtime capability should not advertise session resume.

### MiniMax / mini-agent

Local `mini-agent --help` exposes no tool-control CLI flag.

Local installed source confirms:

- `mini_agent/config.py` has:
  - `tools.enable_file_tools`
  - `tools.enable_bash`
  - `tools.enable_note`
  - `tools.enable_skills`
  - `tools.enable_mcp`
- `MINI_AGENT_CONFIG_PATH` selects the YAML config file consumed by the CLI

Conclusion:

- `/review` needs a one-shot generated config file rather than a CLI flag.
- Minimal review config should preserve the active LLM settings but disable every tool family:

```yaml
api_key: "..."
api_base: "..."
model: "..."
provider: "..."
tools:
  enable_file_tools: false
  enable_bash: false
  enable_note: false
  enable_skills: false
  enable_mcp: false
```

## Phase 2 implementation decision

Decision: review hard constraints are **non-overridable**.

Rationale:

- `/review` is explicitly a constrained safety-sensitive flow.
- Silent user override defeats the purpose of Phase 1.
- Some providers need config or env overrides rather than plain argv merging, so "prepend constraints and let user args win" is not coherent across providers.

Implementation shape:

- Add a `REVIEW_HARD_CONSTRAINTS` mapping in `polycli-companion.mjs`.
- For providers that need config or policy files (`gemini`, `opencode`, `minimax`), generate ephemeral files and/or env overrides before dispatch.
- Reject conflicting review `runtimeOptions.extraArgs` if any future callsite tries to punch through the constraint set.

## Primary sources used

- GitHub Copilot CLI docs:
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/allowing-tools
  - https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-command-reference
- Gemini CLI docs:
  - https://geminicli.com/docs/cli/plan-mode/
  - https://geminicli.com/docs/reference/policy-engine/
- OpenCode docs:
  - https://opencode.ai/docs/tools
- Command Code docs:
  - https://commandcode.ai/docs/reference/cli
  - https://commandcode.ai/docs/core-concepts/headless
  - https://commandcode.ai/docs/core-concepts/plan-mode
  - https://opencode.ai/docs/permissions
  - https://opencode.ai/docs/agents/
  - https://opencode.ai/docs/config/

Local verification artifacts:

- `claude --help`, `gemini --help`, `copilot --help`, `copilot help permissions`, `opencode run --help`, `pi --help`, `mini-agent --help`
- Local installed source:
  - `/opt/homebrew/lib/node_modules/@github/copilot/app.js`
  - `/home/user/.local/share/uv/tools/mini-agent/lib/python3.11/site-packages/mini_agent/config.py`
