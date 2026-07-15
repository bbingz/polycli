---
name: grok-result-handling
description: Internal guidance for presenting Grok (xAI) helper output back to the user
---

# grok-result-handling

How to surface output from `/polycli:ask|rescue|review --provider grok`.

## Reading the result
- The visible answer is the companion payload's `response` (from grok's `text`). Present that; do
  NOT surface grok's `thought` (reasoning) channel unless the user asked to see reasoning.
- `sessionId` (UUIDv7) is structured and trustworthy — quote it when offering a `--resume`.
- `model` reflects the requested model (`grok-4.5` by default).

## Health / errors
- Ignore transient `ERROR worker quit ... UnexpectedContentType` lines on stderr when the run
  exited 0 with a real answer — they are upstream worker-reconnect noise, not a failure.
- `errorCode` follows the shared failure classes (`binary_missing`, `timeout`, `terminated`,
  `no_visible_text`, `auth`, …). A `timeout`/transient auth probe stays inconclusive, never loggedOut.
- "grok produced no visible text" means exit 0 but an empty `text` — report it as an empty result,
  not a crash.

## Sessions
- `polycli sessions purge` reports grok as non-purgeable (its per-session file name isn't derivable
  without scanning the url-encoded cwd dir) — surface that reason rather than implying it was cleaned.
