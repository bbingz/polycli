# Codex Adapter Operability

This document defines the expected Codex behavior for `polycli-codex`. It exists because Codex otherwise has a tempting fallback path: shell out to the official provider CLIs directly.

## Expected Routing

When the `Polycli` plugin is installed and visible in the Codex session, provider work should use the plugin or its bundled `polycli` skill:

```text
Choose Polycli with @, then ask it to run: <command> ...
```

Use that path for `claude`, `copilot`, `opencode`, `pi`, `cmd`, `gemini`, `kimi`, `qwen`, and `minimax` whenever the user asks for `ask`, `review`, `rescue`, `health`, background jobs, or timing history.

Raw official CLI shell calls are acceptable only when:

- the user explicitly asks for raw shell or a specific provider CLI command
- the Codex plugin is unavailable in the current session
- `PLUGIN_ROOT` is missing and the installed plugin root cannot be resolved

When falling back to raw shell, say why Polycli was bypassed.

## First-Run Check

After `codex plugin marketplace add bbingz/polycli`, open `/plugins` in the Codex TUI, choose the `polycli-hosts` marketplace, install `Polycli`, then start a new thread. Confirm the skill appears in `codex debug prompt-input 'probe'` or in the session's available skills.

After install, run:

```text
Choose Polycli with @, then ask it to run: health
```

`health` spends a real short provider request and reports `healthyProviders`. Do not run it before every normal `ask`, `review`, or `rescue`; use it after install, login, provider config changes, or unknown provider state.

For a single-provider check:

```text
Choose Polycli with @, then ask it to run: health --provider qwen
```

## Normal Use

```text
Choose Polycli with @, then ask it to run: ask --provider qwen "explain this stack trace"
Choose Polycli with @, then ask it to run: review --provider gemini --scope staged
Choose Polycli with @, then ask it to run: rescue --provider kimi --background "debug this failure"
```

Prompt-bearing commands should include `--provider`. Do not use `setup` as a routine preflight; `setup` is only the cheap install/auth diagnostic when a model request is not appropriate.

## Observability

Use the companion control plane rather than ad hoc shell state:

```text
Choose Polycli with @, then ask it to run: status --wait
Choose Polycli with @, then ask it to run: result pr-1234abcd
Choose Polycli with @, then ask it to run: timing --provider qwen --history 20 --json
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
- Codex skill examples for daily commands, with no fake slash-command surface

The guard is included in `npm run release:check` and CI.
