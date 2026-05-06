# polycli v0.6.5

Command Code provider release.

## What changed

- Added `cmd` as a ninth provider runtime backed by the official Command Code CLI.
- Uses documented Command Code headless mode: `cmd --skip-onboarding -p <prompt>`.
- Keeps normal headless calls non-mutating by default; `/review` adds `--permission-mode plan` as a hard constraint.
- Reports `cmd` timing as request-scoped ephemeral runtime persistence because Command Code headless mode documents each invocation as a standalone session.
- Adds `cmd` to host docs, Codex trigger validation, Claude command hints, capability matrices, and release drift checks.

## Verification targets

- `node --test packages/polycli-runtime/test/cmd.test.js packages/polycli-runtime/test/registry.test.js packages/polycli-runtime/test/exports.test.js`
- `npm run release:check`
