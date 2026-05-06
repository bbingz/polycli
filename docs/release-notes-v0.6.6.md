# polycli v0.6.6

Review and host-adapter hardening patch on top of `v0.6.5`.

## What changed

- OpenCode adapter now returns structured companion JSON errors from stdout instead of throwing away the payload when the companion exits nonzero.
- Background review runtime options for OpenCode and MiniMax no longer persist the full parent environment into job config files; execution rehydrates from the live process environment plus the minimal review override.
- Command Code headless invocation now matches the standalone runtime contract by ignoring resume flags instead of emitting unsupported `--resume` or `--continue` arguments.

## Verification targets

- `node --test plugins/polycli/scripts/tests/host-packaging.test.mjs plugins/polycli/scripts/tests/review.test.mjs packages/polycli-runtime/test/cmd.test.js`
- `node --test plugins/polycli/scripts/tests/integration.test.mjs`
- `npm run release:check`
- `npm run check:review-drift`
