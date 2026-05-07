---
name: polycli
description: Use when Codex should ask, review, rescue, health-check, or compare provider CLIs through Polycli. Prefer this skill over direct shell calls to official CLIs for claude, copilot, opencode, pi, cmd, gemini, kimi, qwen, and minimax unless the user explicitly asks for the raw CLI or the plugin is unavailable.
---

Interpret `$ARGUMENTS` as raw companion arguments.

## When To Use

Use this skill whenever Codex needs to call or compare a provider CLI through `claude`, `copilot`, `opencode`, `pi`, `cmd`, `gemini`, `kimi`, `qwen`, or `minimax` for `ask`, `review`, `rescue`, `health`, or timing work. Prefer this installed `polycli` skill over direct official CLI shell calls because Polycli preserves the host-neutral command surface, background job state, provider timing records, and health diagnostics.

Raw official CLI shell calls are a fallback only when the user explicitly asks for the raw CLI, the Polycli plugin is unavailable, or the installed plugin root cannot be resolved in the current Codex session. If you fall back to raw shell, say that Polycli was unavailable or explicitly bypassed.

## Invocation

Resolve the installed plugin root from this skill's installed `SKILL.md` file path, then run the bundled companion with Node. The plugin root is the directory two levels above `skills/polycli/SKILL.md`; do not require a manually exported `PLUGIN_ROOT`.

```bash
SKILL_FILE="<absolute path to this SKILL.md file as shown by Codex>"
PLUGIN_ROOT_DIR="$(cd "$(dirname "$SKILL_FILE")/../.." && pwd)"
node "$PLUGIN_ROOT_DIR/scripts/polycli-companion.bundle.mjs" $ARGUMENTS
```

Supported subcommands:

- `setup [--provider <claude|copilot|opencode|pi|cmd|gemini|kimi|qwen|minimax>] [--json]`
- `health [--provider <provider>] [--model <model>] [--timeout-ms <ms>] [--json]`
- `ask --provider <provider> [--model <model>] [--background] [--json] <prompt>`
- `rescue --provider <provider> [--model <model>] [--background] [--json] <prompt>`
- `review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]`
- `adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]`
- `status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]`
- `result [job-id] [--json]`
- `cancel [job-id] [--json]`
- `timing [--provider <provider>] [--history <count>] [--json]`
- `debug <runs|show <run-id>|explain <run-id>> [--json]`

Rules:

- Preserve stdout directly.
- If `--json` is present, do not summarize or paraphrase the payload.
- Run `health` once after installing, logging in, changing provider config, or when provider state is unknown; it returns the `healthyProviders` list and is the first observability check.
- Use `health --provider <provider>` only when diagnosing one provider.
- Do not run `setup` or `health` before every normal `ask`, `review`, or `rescue`; after a provider has passed health, invoke the requested command directly.
- Use `setup` only when you need the cheap install/auth diagnostic without spending a model request.
- Use `status`, `result`, and `timing` to observe background progress, retrieve terminal output, and inspect provider timing history.
- Do not auto-run follow-up commands after `status`, `result`, `cancel`, or `timing`.
