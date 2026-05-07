# polycli v0.6.10

Patch release that fixes two related pi (`@mariozechner/pi-coding-agent`) probe issues. No provider runtime semantics, capability matrix, or upstream CLI behavior changed.

## What changed

### Pi: stop forcing `--model openai-codex/gpt-5.4` in every probe

`packages/polycli-runtime/src/pi.js` previously hardcoded `DEFAULT_PI_MODEL = "openai-codex/gpt-5.4"` and `buildPiInvocation` always injected `--model openai-codex/gpt-5.4` when no model was passed. Users on other pi backends (Xiaomi, etc.) had a token that did not authorize gpt-5.4, so polycli health probes WebSocket-failed silently with empty assistant content and reported `error: "pi produced no visible text"` even though pi itself was working.

Fix: `DEFAULT_PI_MODEL` is now `null`. `buildPiInvocation` skips the `--model` flag when no model is passed, letting pi auto-route to its configured backend. Honors the already-stated repo principle that every provider uses the underlying CLI default model unless `--model` is explicit. Callers that pass an explicit `model` argument are unaffected.

### Pi: surface real provider error messages

When pi's backend did fail (auth invalid, transport failure, capacity exhausted), `parsePiStreamText` only saw empty `content[]` arrays and returned the generic `"pi produced no visible text"`. Pi actually emits `message.errorMessage` and `message.stopReason="error"` when this happens — they were ignored.

Fix: `parsePiStreamText` now extracts a new `providerError` field from `event.message.errorMessage`, falling back to a `"pi reported stopReason=error with no errorMessage"` placeholder when the stop reason is `"error"` but no message text is given. `runPiPrompt` and `runPiPromptStreaming` surface that as `result.error` in preference to the `"no visible text"` fallback. Health and probe outputs now show the real failure cause (e.g. `"Your authentication token has been invalidated. Please try signing in again."`).

### Pi: extract model from `event.message.model`

Pi emits the model it actually used at `event.message.model` in the `message_start` envelope. Previously the parser only looked at `event.model`, `event.session.model`, and `event.result.model`, so auto-routed pi calls reported the wrong model in `result.model`. Added `event.message.model` to the extraction paths so reporting stays accurate when `--model` is not forced.

## Verification targets

- `node --test packages/polycli-runtime/test/pi.test.js`
- `npm test`
- `npm run release:check`

## Live verification

Real `polycli health --provider pi --json` against a Xiaomi-backed pi (`mimo-v2.5-pro`):

| Build | `ok` | reported model | error |
|---|---|---|---|
| v0.6.9 | `false` | `openai-codex/gpt-5.4` | `pi produced no visible text` |
| v0.6.10 | `true` | `mimo-v2.5-pro` | `null` |

## Publish notes

Same 6 release artifacts as `v0.6.9`:

- GitHub release `v0.6.10`
- npm `@bbingz/polycli-opencode@0.6.10`
- npm `@bbingz/polycli@0.6.10`
- Utility packages stay on independent v1.x cadence (`@bbingz/polycli-utils@1.0.1`, `@bbingz/polycli-timing@1.0.1`); `@bbingz/polycli-runtime` remains internal.

See `docs/release.md` for the full sequence.
