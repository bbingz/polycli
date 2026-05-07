# polycli v0.6.11

Patch release that drops the unilateral 200 KB diff cap from `review` / `adversarial-review` and exposes the cap as an opt-in flag instead. No provider runtime semantics or upstream CLI behavior changed.

## What changed

### Default: no diff truncation

`plugins/polycli/scripts/lib/review.mjs` previously hardcoded `DEFAULT_MAX_DIFF_BYTES = 200_000`. Every `review` and `adversarial-review` call truncated the git diff at 200 KB before sending it to any provider, and inserted a `Diff truncated to 200000 bytes before sending to provider.` line into the prompt. With provider context windows now routinely 1M-2M tokens, that hardcoded cap was an artificial cost ceiling that prevented honest end-to-end review of larger PRs and ran counter to the Path B "no fake unification" stance.

`DEFAULT_MAX_DIFF_BYTES` is now `null`. By default `collectReviewContext` returns the full diff verbatim and sets `truncated: false` / `truncationNotice: null`. Callers that explicitly pass a positive numeric `maxDiffBytes` still get the existing truncate-and-notify behavior. Zero, negative, or null are all treated as "no cap" (identical paths).

### Opt-in `--max-diff-bytes <n>` flag

`review` and `adversarial-review` now accept `--max-diff-bytes <n>` so AI assistants can opt in to a byte-cap when their own context budget is tight. The flag is validated like `--history`: digit-only regex, anything else rejected with structured error code `invalid_max_diff_bytes`. Help text on the wrapper updated. Skill grammar in `polycli-codex` and `polycli-copilot` updated to expose the flag to those host adapters.

### Backward-compatibility notes

- The `truncated` and `truncationNotice` fields on `collectReviewContext` results are unchanged — they still exist, just default to `false` / `null`. Any consumer relying on them keeps working.
- Callers that need the old behavior can pass `--max-diff-bytes 200000` explicitly (or library callers `collectReviewContext({ maxDiffBytes: 200_000 })`).
- The `buildReviewPrompt` truncation guidance text (the "The diff was not truncated." vs "Important: Diff truncated to N bytes" line) is unchanged — it just renders the not-truncated branch by default now.

## Verification targets

- `node --test plugins/polycli/scripts/tests/review.test.mjs`
- `npm test`
- `npm run release:check`

## Publish notes

Same 6 release artifacts as `v0.6.10`:

- GitHub release `v0.6.11`
- npm `@bbingz/polycli-opencode@0.6.11`
- npm `@bbingz/polycli@0.6.11`
- Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.

See `docs/release.md` for the full sequence.
