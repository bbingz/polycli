# polycli v0.6.12

Standardize the permission default across all 9 providers: every provider that exposes a YOLO-equivalent flag now passes it by default for `ask` / `rescue`. `review` / `adversarial-review` remain locked to conservative / read-only / plan mode for every provider.

## What changed

### Behavior change: `ask` / `rescue` default to YOLO across the board

Until v0.6.11, polycli's permission stance for `ask` / `rescue` was an asymmetric mix:

- `copilot` and `opencode` already ran full YOLO (`--allow-all-*` and `--dangerously-skip-permissions` respectively).
- `claude` defaulted to `acceptEdits` (auto-accepts edits, still respects other prompts).
- `qwen` defaulted to `auto-edit`; `gemini` defaulted to `plan` (read-only).
- `kimi` and `cmd` passed no permission flag, falling back to upstream interactive defaults that prompt.
- `pi` and `mini-agent` had no permission gate either way.

This asymmetry surprised harnessed-agent users who expected polycli to behave the same way across providers. v0.6.12 standardizes the surface — every provider that has a YOLO-equivalent flag passes it by default, and the new behavior is documented as a stable v1 surface in `docs/polycli-v1-public-surface.md`. Providers without a permission flag (pi, mini-agent) are unchanged because their tools were already auto-running.

| Provider | Default for `ask` / `rescue` |
|---|---|
| `claude` | `--permission-mode bypassPermissions` (was `acceptEdits`) |
| `gemini` | `--approval-mode yolo` (was `plan`) |
| `qwen` | `--approval-mode yolo` (was `auto-edit`) |
| `kimi` | `--yolo` (newly added; was no flag) |
| `cmd` | `--yolo` (newly added; was no flag) |
| `copilot` | `--allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user` (unchanged) |
| `opencode` | `--dangerously-skip-permissions` (unchanged) |
| `pi` | (no flag; tools default-enabled upstream) |
| `mini-agent` | (config-driven via `~/.mini-agent/config/config.yaml`) |

Callers that need a non-YOLO stance pass it explicitly: `permissionMode: "plan"` for claude, `approvalMode: "plan"` for gemini/qwen, `yolo: false` for kimi/cmd, `skipPermissions: false` for opencode.

The legacy `unsafeFlag` / `background` guard in qwen that was there to gate yolo opt-in has been dropped — YOLO is now the default and no special flag is needed for background runs. `unsafeFlag` and `background` parameters on `buildQwenInvocation` are still accepted (no signature break) but no longer change behavior.

### review / adversarial-review unchanged in spirit, hardened against the new YOLO defaults

Every provider's review path is forced back to a conservative stance:

- `claude` — `--max-turns 1 --tools ""` (existing) plus `permissionMode: "plan"` (new override against `bypassPermissions`)
- `gemini` — `approvalMode: "plan"` (existing)
- `qwen` — `maxSteps: 1` + `appendSystem` (existing) plus `approvalMode: "plan"` (new override against `yolo`)
- `kimi` — `--no-thinking --max-steps-per-turn 1` (existing) plus `yolo: false` (new override)
- `cmd` — `--permission-mode plan` (existing) plus `yolo: false` (new override)
- `copilot` — `--excluded-tools <list>` (unchanged)
- `opencode` — `skipPermissions: false` + `--agent plan` + `permission: deny` config (unchanged)
- `pi` — `--no-tools` (unchanged)
- `mini-agent` — tools-disabled config (unchanged)

`assertNoReviewConstraintOverride` was extended to refuse downstream callers re-introducing the new YOLO flags into a review invocation (`yolo` for kimi/cmd, `permissionMode != "plan"` for claude, `approvalMode != "plan"` for qwen).

### Public-surface documentation

`docs/polycli-v1-public-surface.md` adds a "Provider Permission Defaults" section that documents the per-provider default and the review override behavior. This is now part of the v1 public contract.

## Verification targets

- `node --test packages/polycli-runtime/test/{claude,gemini,qwen,kimi,cmd}.test.js plugins/polycli/scripts/tests/review.test.mjs`
- `npm test`
- `npm run release:check`

## Publish notes

Same 6 release artifacts as `v0.6.11`:

- GitHub release `v0.6.12`
- npm `@bbingz/polycli-opencode@0.6.12`
- npm `@bbingz/polycli@0.6.12`
- Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.

## Migration / safety note

If you were relying on polycli's previous mid-/conservative defaults to act as a safety net (e.g. claude prompting on edits, gemini being read-only), upgrade carefully: ask/rescue will now auto-execute everything. Pass the explicit opt-out parameters above, or use `review` / `adversarial-review` instead, which remain conservative by design.
