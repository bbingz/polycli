# @bbingz/polycli

Terminal CLI for the same Polycli companion behavior used by the Claude Code, Codex, Copilot CLI, and OpenCode host adapters.

```bash
polycli health --json
POLYCLI_RUN_ID=review-20260507 polycli ask --provider qwen --json "Return exactly POLYCLI_HEALTH_OK"
POLYCLI_RUN_ID=review-20260507 polycli debug explain review-20260507
```

The terminal package does not expose provider runtime internals as a public framework.
