---
name: polycli
description: Run the shared polycli companion from this repository to health-check provider setup, ask questions, run rescue/review flows, manage background jobs, or query timing history.
---

Interpret `$ARGUMENTS` as raw companion arguments.

Resolve the installed plugin root and run the bundled companion with Node:

```bash
PLUGIN_ROOT_DIR="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
[ -n "$PLUGIN_ROOT_DIR" ] || { echo "PLUGIN_ROOT is not set"; exit 1; }
node "$PLUGIN_ROOT_DIR/scripts/polycli-companion.bundle.mjs" $ARGUMENTS
```

Supported subcommands:

- `setup [--provider <claude|copilot|opencode|pi|gemini|kimi|qwen|minimax>] [--json]`
- `health [--provider <provider>] [--model <model>] [--timeout-ms <ms>] [--json]`
- `ask --provider <provider> [--model <model>] [--background] [--json] <prompt>`
- `rescue --provider <provider> [--model <model>] [--background] [--json] <prompt>`
- `review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]`
- `adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]`
- `status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]`
- `result [job-id] [--json]`
- `cancel [job-id] [--json]`
- `timing [--provider <provider>] [--history <count>] [--json]`

Rules:

- Preserve stdout directly.
- If `--json` is present, do not summarize or paraphrase the payload.
- Run `health` once after installing, logging in, changing provider config, or when provider state is unknown; it returns the `healthyProviders` list.
- Use `health --provider <provider>` only when diagnosing one provider.
- Do not run `setup` or `health` before every normal `ask`, `review`, or `rescue`; after a provider has passed health, invoke the requested command directly.
- Use `setup` only when you need the cheap install/auth diagnostic without spending a model request.
- Do not auto-run follow-up commands after `status`, `result`, `cancel`, or `timing`.
