# polycli OpenCode Plugin

OpenCode adapter for the shared `polycli` companion.

## Status

This host is provided as an OpenCode plugin package plus a local project plugin entrypoint.

- Publish target: npm package `@bbingz/polycli-opencode`
- Local entrypoint: `.opencode/plugins/polycli.mjs`
- Local dependency manifest: `.opencode/package.json`

## Install

```bash
opencode plugin @bbingz/polycli-opencode
```

## Tools

- `polycli_run`
- `polycli_timing`

Both tools run the bundled companion at `plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs`.
