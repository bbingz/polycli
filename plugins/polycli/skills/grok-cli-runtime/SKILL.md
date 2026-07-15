---
name: grok-cli-runtime
description: Internal helper contract for calling the polycli companion runtime for Grok (xAI Grok Build CLI) from Claude Code
---

# grok-cli-runtime

polycli wraps the local **Grok Build** CLI (`grok`, xAI; v0.2.x verified). Call it through the
polycli companion (`/polycli:ask|rescue|review --provider grok`), never by spawning `grok` directly.
The runtime contract (`packages/polycli-runtime/src/grok.js`) is authoritative; this is a summary.

## Invocation shape
- One-shot, non-interactive: `grok -p <prompt> --output-format <json|streaming-json>`. `-p` prints
  the answer and exits. Unlike kimi-code, `-p` composes with the flags below (verified).
- `--output-format json` → a single object `{text, stopReason, sessionId, requestId, thought}`
  (used for `ask`/`rescue`/`review`). `--output-format streaming-json` → line events
  `{type:"thought",data}` (reasoning) / `{type:"text",data}` (answer) / `{type:"end",stopReason,sessionId,requestId}`.
- Model: `-m <model>`. Current local default: `grok-4.5`; `grok-composer-2.5-fast` is also available.
- Effort: grok accepts `--effort low|medium|high|xhigh|max` natively; polycli's `--effort` is gemini-only and is **not** forwarded to grok.
- **YOLO** (ask/rescue): `--always-approve`. **Review** read-only: `--permission-mode plan`.
- Resume: `--resume <id>` / `-r <id>` (resume a session), `-c` / `--continue` (last for cwd).

## Gotchas
- **stderr noise on success**: grok prints transient `ERROR worker quit ... UnexpectedContentType`
  lines to stderr even on a successful run. Success is judged ONLY by exit 0 + a valid stdout JSON
  envelope with visible text — stderr content is never treated as failure.
- **session id is structured** (json `sessionId`, streaming `end.sessionId`, a UUIDv7). Never scan
  prose for a UUID.
- **Auth** is inferred from `grok models` (prints "You are logged in with grok.com." + the default
  model) — zero LLM/token cost. `grok login` / `grok logout` manage credentials.
- **Session purge**: grok sessions live under `~/.grok/sessions/<url-encoded cwd>/`; the exact
  per-session filename is not derivable from the id alone, so `polycli sessions purge` honest-skips grok.
