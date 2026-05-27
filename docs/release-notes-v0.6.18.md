# polycli v0.6.18

Patch on top of `v0.6.17` that fixes correctness issues in the `agy` (Google Antigravity CLI) provider surfaced by a multi-round code review.

## What changed

- **No fabricated session id.** `packages/polycli-runtime/src/agy.js` no longer feeds `result.stdout` to `resolveSessionId`. agy stdout is pure assistant prose, so the UUID scan could capture any UUID in an answer as a fake `sessionId` — violating the "sessionId always null / do not fabricate" contract and suppressing `buildTimingMeta`'s `sessionIdMissing: true`. `sessionId` is now hard-`null` on both the sync and streaming paths.
- **Hardened auth probe.** `buildAgyAuthStatus` now inspects combined `error` + `response` text, so a logged-out agy that prints sign-in guidance to stdout and exits 0 is correctly reported as logged out. A clean `status: 0` with no auth signal is treated as authenticated even when the probe produced no visible text, fixing the empty-output false-negative where the visible-text gate leaked into auth classification. Transient (timeout/429) probe errors still resolve to inconclusive-authenticated.
- **Review hints corrected.** `agy` removed from the `--provider` argument hint in `commands/review.md` and `commands/adversarial-review.md`; the runtime rejects agy review, so the hints no longer advertise an unsupported choice.
- **Drift watcher made effective.** `scripts/check-review-cli-drift.mjs` agy row had `expect: []`, a no-op that could only detect expected flags disappearing — never a new plan-mode flag appearing. Added a `forbid` list (`--approval-mode` / `--permission-mode` / `--policy` / `--plan` / `--agent`); the checker now reports DRIFT (exit 2) if any appear so `/review` support can be re-evaluated.

No other provider behavior, host command grammar, timing schema, or session persistence changed.

## Verification

- `node --test packages/polycli-runtime/test/agy.test.js` (18/18, including 5 new regression cases)
- `npm test`
- `node scripts/check-review-cli-drift.mjs`
- `npm run release:check`

## Release artifacts

- GitHub release `v0.6.18`
- npm `@bbingz/polycli-opencode@0.6.18`
- npm `@bbingz/polycli@0.6.18`

Utility packages stay on the independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`). No schema or utility changes in this slice.
