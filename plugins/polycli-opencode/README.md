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
{"argv":["setup","--provider","qwen","--json"]}
```

Then:

```json
{"argv":["ask","--provider","qwen","Reply with OK only.","--json"]}
```

Then either:

- call `polycli_timing` with `{"provider":"qwen","history":1,"json":true}`
- or call `polycli_run` with `{"argv":["timing","--provider","qwen","--history","1","--json"]}`

## Command Surface

`polycli_run` accepts the same subcommands as the other hosts:

- `setup`
- `ask`
- `rescue`
- `review`
- `adversarial-review`
- `status`
- `result`
- `cancel`
- `timing`

## Operator Notes

- `--provider` is still required on prompt-bearing commands.
- `setup` is the fastest way to separate package/plugin problems from provider CLI problems.
- `minimax` is currently the one integrated provider without session resume support.
