# polycli v0.6.13

Patch on top of `v0.6.12` extending the YOLO/auto-approve stance to cover gemini-cli's separate workspace-trust gate. Without this, the first `gemini`-backed `ask` / `rescue` / `review` call in any new workspace would fail or hang on a trust prompt that polycli's non-interactive surface cannot answer.

## What changed

### Default `GEMINI_CLI_TRUST_WORKSPACE=true` for every gemini run

`packages/polycli-runtime/src/gemini.js` adds a new `buildGeminiEnv(parentEnv = process.env)` helper. It returns a copy of `parentEnv` with `GEMINI_CLI_TRUST_WORKSPACE` defaulted to `"true"`, but **preserves any explicit upstream value** the caller already set (so `GEMINI_CLI_TRUST_WORKSPACE=false ./script.sh` still wins). `runGeminiPrompt` and `runGeminiPromptStreaming` now spawn gemini with this env. The streaming path previously already passed `env: { ...process.env }`; the sync path now also passes env explicitly instead of inheriting silently.

### Why this is consistent with v0.6.12

Workspace trust is just another interactive prompt that gemini-cli would normally raise. v0.6.12 standardized the rule: every provider that has a YOLO-equivalent flag now passes it by default for `ask` / `rescue` so polycli's non-interactive surface can run end-to-end. Workspace trust is one more such gate; this release closes the gap. Reviewers who want a stricter posture pass `GEMINI_CLI_TRUST_WORKSPACE=false` in their environment before calling polycli.

`review` / `adversarial-review` are unaffected by this change in the sense that `--approval-mode plan` is still the review override, and `--no-tools` / `--allow-tools` semantics are unchanged. The trust env var just unblocks gemini from refusing to start in a fresh checkout.

## Verification targets

- `node --test packages/polycli-runtime/test/gemini.test.js`
- `npm test`
- `npm run release:check`

## Publish notes

Same 6 release artifacts as `v0.6.12`:

- GitHub release `v0.6.13`
- npm `@bbingz/polycli-opencode@0.6.13`
- npm `@bbingz/polycli@0.6.13`
- Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.
