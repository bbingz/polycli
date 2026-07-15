---
name: polycli
description: Use when Codex should discover the installed Polycli contract, ask, review, rescue, health-check, or compare provider CLIs through Polycli. Prefer this skill over direct shell calls to official CLIs for claude, copilot, opencode, pi, cmd, agy, gemini, kimi, qwen, minimax, and grok unless the user explicitly asks for the raw CLI or the plugin is unavailable.
---

Interpret `$ARGUMENTS` as raw companion arguments.

## When To Use

Use this skill whenever Codex needs offline `agent-context` discovery or needs to call or compare a provider CLI through `claude`, `copilot`, `opencode`, `pi`, `cmd`, `gemini`, `kimi`, `qwen`, or `minimax` for `ask`, `review`, `rescue`, `health`, or timing work. Prefer this installed `polycli` skill over direct official CLI shell calls because Polycli preserves the host-neutral command surface, background job state, provider timing records, and health diagnostics.

Raw official CLI shell calls are a fallback only when the user explicitly asks for the raw CLI, the Polycli plugin is unavailable, or the installed plugin root cannot be resolved in the current Codex session. If you fall back to raw shell, say that Polycli was unavailable or explicitly bypassed.

## Invocation

Resolve the installed plugin root from this skill's installed `SKILL.md` file path, then run the bundled companion with Node. The plugin root is the directory two levels above `skills/polycli/SKILL.md`; do not require a manually exported `PLUGIN_ROOT`.

```bash
SKILL_FILE="<absolute path to this SKILL.md file as shown by Codex>"
PLUGIN_ROOT_DIR="$(cd "$(dirname "$SKILL_FILE")/../.." && pwd)"
node "$PLUGIN_ROOT_DIR/scripts/polycli-companion.bundle.mjs" $ARGUMENTS
```

Supported subcommands:

- `agent-context [--json]`
- `setup [--provider <claude|copilot|opencode|pi|cmd|agy|gemini|kimi|qwen|minimax|grok>] [--probe-auth] [--json|--json-v2]`
- `health [--provider <provider>] [--model <model>] [--timeout-ms <ms>] [--json|--json-v2]`
- `ask --provider <provider> [--model <model>] [--background] [--json|--json-v2] <prompt>`
- `rescue --provider <provider> [--model <model>] [--background] [--json|--json-v2] <prompt>`
- `review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [--json|--json-v2] [focus ...]`
- `adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [--json|--json-v2] [focus ...]`
- `status [job-selector] [--job <id:<id>|prefix:<prefix>|latest|latest-active|latest-terminal>] [--all] [--wait] [--for <terminal|completed|failed|cancelled>] [--timeout-ms <ms>] [--json|--json-v2]`
- `result [job-selector] [--job <selector>] [--json|--json-v2]`
- `cancel [job-selector] [--job <selector>] [--json|--json-v2]`
- `timing [--provider <provider>] [--history <count>] [--json|--json-v2]`
- `debug <runs|show <run-id>|explain <run-id>|tail [run-id] [--after <event-id>] [--limit <n>] [--wait] [--timeout-ms <ms>]> [--json|--json-v2]`
- `sessions [list] | purge [--confirm] [--json|--json-v2]`

Rules:

- Preserve stdout directly.
- If `--json` or `--json-v2` is present, do not summarize or paraphrase the payload. Host integrations remain on legacy `--json` unless the caller explicitly opts into `--json-v2`.
- Use `agent-context --json` for offline command/provider discovery. Do not precede it with setup, authentication, health, or provider probes.
- Run `health` once after installing, logging in, changing provider config, or when provider state is unknown; it returns the `healthyProviders` list and is the first observability check.
- Use `health --provider <provider>` only when diagnosing one provider.
- Do not run `setup` or `health` before every normal `ask`, `review`, or `rescue`; after a provider has passed health, invoke the requested command directly.
- Use `setup` for install and status-only auth inspection. It skips auth checks that would send a model prompt unless the caller explicitly passes `--probe-auth`.
- Use `status`, `result`, and `timing` to observe background progress, retrieve terminal output, and inspect provider timing history.
- Do not auto-run follow-up commands after `status`, `result`, `cancel`, or `timing`.
