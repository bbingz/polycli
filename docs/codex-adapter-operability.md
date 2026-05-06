# Codex Adapter Operability

This document defines the expected Codex behavior for `polycli-codex`. It exists because Codex otherwise has a tempting fallback path: shell out to the official provider CLIs directly.

## Expected Routing

When the `polycli-codex` skill is installed and visible in the Codex session, provider work should use:

```text
/polycli-codex:polycli <command> ...
```

Use that path for `claude`, `copilot`, `opencode`, `pi`, `gemini`, `kimi`, `qwen`, and `minimax` whenever the user asks for `ask`, `review`, `rescue`, `health`, background jobs, or timing history.

Raw official CLI shell calls are acceptable only when:

- the user explicitly asks for raw shell or a specific provider CLI command
- the Codex plugin is unavailable in the current session
- `PLUGIN_ROOT` is missing and the installed plugin root cannot be resolved

When falling back to raw shell, say why Polycli was bypassed.

## First-Run Check

After install, run:

```text
/polycli-codex:polycli health
```

`health` spends a real short provider request and reports `healthyProviders`. Do not run it before every normal `ask`, `review`, or `rescue`; use it after install, login, provider config changes, or unknown provider state.

For a single-provider check:

```text
/polycli-codex:polycli health --provider qwen
```

## Normal Use

```text
/polycli-codex:polycli ask --provider qwen "explain this stack trace"
/polycli-codex:polycli review --provider gemini --scope staged
/polycli-codex:polycli rescue --provider kimi --background "debug this failure"
```

Prompt-bearing commands should include `--provider`. Do not use `setup` as a routine preflight; `setup` is only the cheap install/auth diagnostic when a model request is not appropriate.

## Observability

Use the companion control plane rather than ad hoc shell state:

```text
/polycli-codex:polycli status --wait
/polycli-codex:polycli result pr-1234abcd
/polycli-codex:polycli timing --provider qwen --history 20 --json
```

- `status` shows background progress and recent jobs.
- `result` retrieves terminal output.
- `timing` reports provider timing history and the four-state metric contract.
- `--json` output should be preserved, not summarized or reshaped.

## Regression Guard

`npm run validate:codex-adapter` checks the Codex manifest, Codex skill, Codex README, root README, and host command map for:

- provider trigger terms for every runtime provider
- explicit preference for Polycli over direct official CLI shell calls
- bounded raw-CLI fallback language
- observable `health`, `status`, `result`, and `timing` guidance
- Codex slash examples for daily commands

The guard is included in `npm run release:check` and CI.
