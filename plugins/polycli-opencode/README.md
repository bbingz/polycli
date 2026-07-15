# polycli OpenCode Plugin

OpenCode adapter for the shared `polycli` companion.

## Install

```bash
opencode plugin @bbingz/polycli-opencode
```

## What Gets Installed

This host ships as:

- npm package: `@bbingz/polycli-opencode`
- plugin entrypoint: `index.mjs`
- bundled companion: `scripts/polycli-companion.bundle.mjs`

In this repository there is also a local project entrypoint at `.opencode/plugins/polycli.mjs` for repo-local development.

## Tools

- `polycli_run`
- `polycli_timing`

Both tools execute the bundled companion. `polycli_run` is the general entrypoint; `polycli_timing` is a narrow convenience wrapper.

## First Run

Run `polycli_run` with:

```json
{"argv":["health","--json"]}
```

Then either:

- call `polycli_timing` with `{"provider":"qwen","history":1,"json":true}`
- or call `polycli_run` with `{"argv":["timing","--provider","qwen","--history","1","--json"]}`

## Command Surface

`polycli_run` accepts the same subcommands as the other hosts:

- `agent-context`
- `setup`
- `health`
- `ask`
- `rescue`
- `review`
- `adversarial-review`
- `status`
- `result`
- `cancel`
- `timing`
- `debug`
- `sessions`

Operational commands retain legacy `--json` as the host default and offer opt-in `--json-v2` envelopes. Job commands accept `--job id:<id>|prefix:<prefix>|latest|latest-active|latest-terminal`; `status --wait --for <state>` is typed. Incremental redacted observation uses `polycli_run({"argv":["debug","tail","--after","evt_abc","--limit","100","--wait","--json-v2"]})`.

## Operator Notes

- `--provider` is still required on prompt-bearing commands.
- `health` is the canonical end-to-end provider check after install, login, or provider config changes. With no provider it probes every integrated provider and reports `healthyProviders`; use `--provider` only for single-provider diagnosis. Do not run `setup` or `health` before every normal provider call.
- `setup` separates package/plugin problems from provider CLI problems with install and status-only auth checks. It skips model-based auth probes unless its `argv` explicitly includes `--probe-auth`.
- `minimax` and `cmd` are currently the integrated providers without session resume support. `cmd` uses documented Command Code headless mode, where each invocation is a standalone session.
