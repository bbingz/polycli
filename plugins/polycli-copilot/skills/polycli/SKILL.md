---
name: polycli
description: Run the shared polycli companion from this repository to health-check provider setup, ask questions, manage background jobs, and query timing history.
---

Interpret `$ARGUMENTS` as raw companion arguments.

Resolve the installed plugin root and run the bundled companion with Node:

```bash
PLUGIN_ROOT_DIR="${PLUGIN_ROOT:-${COPILOT_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}}"
[ -n "$PLUGIN_ROOT_DIR" ] || { echo "PLUGIN_ROOT is not set"; exit 1; }
node "$PLUGIN_ROOT_DIR/scripts/polycli-companion.bundle.mjs" $ARGUMENTS
```

Supported subcommands:

- `setup [--provider <claude|copilot|opencode|pi|cmd|agy|gemini|kimi|qwen|minimax|grok>] [--probe-auth] [--json]`
- `health [--provider <provider>] [--model <model>] [--timeout-ms <ms>] [--json]`
- `ask --provider <provider> [--model <model>] [--background] [--json] <prompt>`
- `rescue --provider <provider> [--model <model>] [--background] [--json] <prompt>`
- `review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [--json] [focus ...]`
- `adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--max-diff-bytes <n>] [--json] [focus ...]`
- `status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]`
- `result [job-id] [--json]`
- `cancel [job-id] [--json]`
- `timing [--provider <provider>] [--history <count>] [--json]`
- `debug <runs|show <run-id>|explain <run-id>> [--json]`
- `sessions [list] | purge [--confirm] [--json]`

Rules:

- Preserve stdout directly.
- If `--json` is present, do not summarize or paraphrase the payload.
- Run `health` once after installing, logging in, changing provider config, or when provider state is unknown; it returns the `healthyProviders` list.
- Use `health --provider <provider>` only when diagnosing one provider.
- Do not run `setup` or `health` before every normal `ask`, `review`, or `rescue`; after a provider has passed health, invoke the requested command directly.
- Use `setup` for install and status-only auth inspection. It skips auth checks that would send a model prompt unless the caller explicitly passes `--probe-auth`.
- Do not auto-run follow-up commands after `status`, `result`, `cancel`, or `timing`.
