# @bbingz/polycli

Terminal CLI for the same Polycli companion behavior used by the Claude Code, Codex, Copilot CLI, and OpenCode host adapters.

```bash
polycli health --json
POLYCLI_RUN_ID=review-20260507 polycli ask --provider qwen --json "Return exactly POLYCLI_HEALTH_OK"
POLYCLI_RUN_ID=review-20260507 polycli debug explain review-20260507
```

The terminal package does not expose provider runtime internals as a public framework.

### TUI inspector

```bash
polycli tui
polycli tui --run-id run_abc123
```

The TUI is read-only. It renders recent run-ledger data from the same debug commands used by `polycli debug runs/show/explain`. Jobs with `started` or `attempt_started` but no terminal result are shown as `unfinished` / `unknown`.
