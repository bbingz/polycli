---
name: polycli
description: Run the shared polycli companion to discover its installed contract offline, health-check provider setup, ask questions, manage background jobs, and query timing history.
---

Interpret `$ARGUMENTS` as raw companion arguments.

Resolve the installed plugin root and run the bundled companion with Node:

```bash
PLUGIN_ROOT_DIR="${PLUGIN_ROOT:-${COPILOT_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}}"
[ -n "$PLUGIN_ROOT_DIR" ] || { echo "PLUGIN_ROOT is not set"; exit 1; }
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
- Run `health` once after installing, logging in, changing provider config, or when provider state is unknown; it returns the `healthyProviders` list.
- Use `health --provider <provider>` only when diagnosing one provider.
- Do not run `setup` or `health` before every normal `ask`, `review`, or `rescue`; after a provider has passed health, invoke the requested command directly.
- Use `setup` for install and status-only auth inspection. It skips auth checks that would send a model prompt unless the caller explicitly passes `--probe-auth`.
- Do not auto-run follow-up commands after `status`, `result`, `cancel`, or `timing`.
