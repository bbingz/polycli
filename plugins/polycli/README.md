# polycli Claude Plugin

Repo-local Claude Code plugin entry for `polycli`.

## Location

- Plugin root: `plugins/polycli`
- Manifest: `plugins/polycli/.claude-plugin/plugin.json`
- Companion CLI: `plugins/polycli/scripts/polycli-companion.mjs`

## Commands

- `/polycli:setup`
- `/polycli:ask`
- `/polycli:rescue`
- `/polycli:review`
- `/polycli:adversarial-review`
- `/polycli:status`
- `/polycli:result`
- `/polycli:cancel`
- `/polycli:timing`

## Install

```bash
claude plugin marketplace add bbingz/polycli
claude plugin install polycli@polycli-hosts
```

## Command Model

This plugin is multi-provider. Pass the provider explicitly:

- `--provider gemini`
- `--provider kimi`
- `--provider qwen`
- `--provider minimax`

Examples:

```text
/polycli:setup --provider qwen
/polycli:ask --provider kimi Explain this stack trace
/polycli:rescue --provider qwen --background Audit the flaky test and explain the root cause
/polycli:review --provider gemini --scope staged
/polycli:adversarial-review --provider minimax --scope branch auth middleware
/polycli:status
/polycli:result pr-1234abcd
/polycli:cancel pr-1234abcd
/polycli:timing --provider qwen
```

## What It Supports

This plugin is built on top of `@bbingz/polycli-runtime` and now covers both foreground and background flows:

- provider setup/auth inspection
- one-shot ask
- long-running rescue prompts
- review on current git diff
- adversarial review on current git diff
- background job orchestration with persisted state under `CLAUDE_PLUGIN_DATA`
- job polling via `/polycli:status`
- stored output retrieval via `/polycli:result`
- active job cancellation via `/polycli:cancel`
- timing history persistence and aggregate queries via `/polycli:timing`

## Background Flow

For long-running prompts, reviews, or rescue work:

1. Start with `--background`.
2. Poll `/polycli:status` until the job leaves `queued` / `running`.
3. Read the stored result with `/polycli:result <jobId>`.
4. Stop an active run with `/polycli:cancel <jobId>`.
