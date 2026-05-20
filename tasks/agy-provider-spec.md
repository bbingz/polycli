# Add `agy` provider (Google Antigravity CLI 1.0.0) — implementation spec

Status: spec ready for Codex implementation. Standard-tier adapter
(registry + spawn + capabilities + auth/version probe + tests + plugin
host map + release-check). User-approved scope on 2026-05-20.

## Why

User asked: "增加 antigravity cli 也就是 agy 的选项, gemini cli 后续官方
不更新了". The Antigravity CLI is Google's new desktop-app-bundled coding
agent. Binary lives at `~/.local/bin/agy` (134 MB Mach-O arm64, Go-compiled).
Adding agy here gives a polycli-managed alternative once gemini-cli upstream
slows down. agy is NOT a drop-in for gemini — output is text-only, no
streaming JSON.

## Upstream probe (already done, 2026-05-20)

- Version: `agy changelog | head -1` → `1.0.0: Initial release of the
  Antigravity CLI.` There is no `--version` flag. `-v` errors with
  "flag needs an argument".
- Help (`agy --help`):
  ```
    --add-dir                       Add a directory to the workspace (repeatable)
    -c / --continue                 Continue the most recent conversation
    --conversation <id>             Resume a previous conversation by ID
    --dangerously-skip-permissions  Auto-approve all tool permission requests
    -i / --prompt-interactive       Interactive initial prompt + continue
    --log-file <path>               Override CLI log file path
    -p / --print / --prompt <p>     Run a single prompt non-interactively
    --print-timeout 5m0s            Timeout for print mode
    --sandbox                       Terminal-restricted sandbox
  Subcommands: changelog | help | install | plugin(s) | update
  ```
- Non-interactive output shape (verified with `agy -p "..."`):
  - **stdout**: pure assistant text (no JSON, no session id, no model field,
    no token counts). Trailing newline.
  - **stderr**: occasional informational line `Shell cwd was reset to <dir>`.
    Not an error. Empty otherwise.
  - **exit code**: 0 on success.
- `-c` (continue last conversation) verified to work: a follow-up
  `agy -c -p "Did you remember the previous answer?"` returned context-aware
  answer.
- Config dirs probed: `~/Library/Application Support/Antigravity/`,
  `~/Library/Logs/Antigravity/`. No CLI-readable session id or token file.
- Auth probe: agy has NO `status`-like subcommand. The only way to detect
  logged-out state is to run a real prompt and check for an explicit auth
  error in stderr / non-zero exit.

## Adapter contract (mirror `cmd.js` + `claude.js` patterns)

### New file: `packages/polycli-runtime/src/agy.js`

```js
import { binaryAvailable, runCommand } from "@bbingz/polycli-utils/process";
import { resolveSessionId } from "@bbingz/polycli-utils/session-id";
import { classifyProviderFailure, formatProviderExitError } from "./errors.js";
import { spawnStreamingCommand } from "./spawn.js";

const AGY_BIN = process.env.AGY_CLI_BIN || "agy";
const DEFAULT_AGY_MODEL = null; // agy never surfaces a model id
const DEFAULT_TIMEOUT_MS = 900_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const AGY_EXPLICIT_AUTH_ERROR_RE = /\b(unauthenticated|unauthorized|not authenticated|not authorized|login required|log in|sign in|invalid api key|missing api key|api key required|token expired|invalid token|credential(?:s)? (?:missing|invalid|expired)|permission denied|access denied|forbidden|401|403)\b/i;
export const TRANSIENT_PROBE_ERROR_PATTERNS = [
  /\b(timed out|timeout|429|rate limit|no capacity available|temporar(?:y|ily)|service unavailable|overloaded|try again|econnreset|econnrefused|enotfound|network|socket hang up)\b/i,
];

// Informational stderr lines that are NOT errors:
const AGY_BENIGN_STDERR_RE = /^Shell cwd was reset/i;

export function buildAgyInvocation({
  prompt,
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  printTimeoutSeconds = null,
  extraArgs = [],
  bin = AGY_BIN,
} = {}) {
  const args = [];
  if (yolo) args.push("--dangerously-skip-permissions");
  if (sandbox) args.push("--sandbox");
  if (resumeConversationId) {
    args.push("--conversation", resumeConversationId);
  } else if (continueLast) {
    args.push("--continue");
  }
  for (const dir of addDirs) {
    args.push("--add-dir", dir);
  }
  if (printTimeoutSeconds && Number.isFinite(printTimeoutSeconds)) {
    args.push("--print-timeout", `${Math.max(1, Math.round(printTimeoutSeconds))}s`);
  }
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push("-p", String(prompt ?? ""));
  return { bin, args };
}

export function extractAgyText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "text_delta" && typeof event.delta === "string") return event.delta;
  if (event.type === "result" && typeof event.text === "string") return event.text;
  return "";
}

function textEventsFromStdout(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .map((line) => ({ type: "text_delta", delta: line }));
}

export function parseAgyTextResult(stdout) {
  const response = String(stdout ?? "").trim();
  const events = textEventsFromStdout(stdout);
  return { response, events };
}

function stripBenignStderr(stderr) {
  return String(stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !AGY_BENIGN_STDERR_RE.test(line.trim()))
    .join("\n");
}

export function getAgyAvailability(cwd) {
  // agy has no --version flag; --help exits 0 and prints usage to stdout.
  return binaryAvailable(AGY_BIN, ["--help"], { cwd });
}

function buildAgyAuthStatus(result) {
  if (result.ok) {
    return { loggedIn: true, detail: "authenticated", model: DEFAULT_AGY_MODEL };
  }
  const detail = String(result.error ?? "").trim() || "agy auth probe failed";
  if (AGY_EXPLICIT_AUTH_ERROR_RE.test(detail)) {
    return { loggedIn: false, detail };
  }
  if (TRANSIENT_PROBE_ERROR_PATTERNS.some((p) => p.test(detail))) {
    return { loggedIn: true, detail: `auth probe inconclusive: ${detail}`, model: DEFAULT_AGY_MODEL };
  }
  return { loggedIn: false, detail };
}

export function getAgyAuthStatus(cwd, { promptRunner = runAgyPrompt } = {}) {
  const result = promptRunner({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
    yolo: true,
  });
  return buildAgyAuthStatus(result);
}

export function runAgyPrompt({
  prompt,
  model = null,         // accepted for API parity; agy ignores it
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  env = process.env,
  extraArgs = [],
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  defaultModel = null,
  bin = AGY_BIN,
} = {}) {
  // Add a print-timeout slightly less than the harness timeout so agy
  // surfaces a timeout itself rather than being killed silently.
  const printTimeoutSeconds = Math.max(5, Math.floor((timeout - 5_000) / 1000));
  const invocation = buildAgyInvocation({
    prompt,
    yolo,
    continueLast,
    resumeConversationId,
    sandbox,
    addDirs,
    printTimeoutSeconds,
    extraArgs,
    bin,
  });

  const result = runCommand(invocation.bin, invocation.args, { cwd, timeout, env });
  if (result.error) {
    const error = result.error.code === "ETIMEDOUT"
      ? `agy timed out after ${Math.round(timeout / 1000)}s`
      : result.error.message;
    return {
      ok: false,
      error,
      errorCode: classifyProviderFailure(error, { provider: "agy" }),
    };
  }

  const parsed = parseAgyTextResult(result.stdout);
  const resolvedSession = resolveSessionId({
    stdout: result.stdout,
    stderr: result.stderr,
    priority: ["stdout", "stderr", "file"],
  });
  const filteredStderr = stripBenignStderr(result.stderr);
  const hasVisibleText = Boolean(parsed.response.trim());
  const error = result.status === 0
    ? (hasVisibleText ? null : "agy produced no visible text")
    : (filteredStderr.trim() || formatProviderExitError("agy", result.status));

  return {
    ok: result.status === 0 && hasVisibleText,
    response: parsed.response,
    events: parsed.events,
    sessionId: resolvedSession.sessionId,  // expected to always be null
    model: model ?? defaultModel ?? DEFAULT_AGY_MODEL,
    error,
    errorCode: classifyProviderFailure(error, { provider: "agy" }),
    status: result.status,
  };
}

export function runAgyPromptStreaming({
  prompt,
  model = null,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  env = process.env,
  extraArgs = [],
  yolo = true,
  continueLast = false,
  resumeConversationId = null,
  sandbox = false,
  addDirs = [],
  defaultModel = null,
  onEvent = () => {},
  bin = AGY_BIN,
  spawnImpl,
} = {}) {
  const printTimeoutSeconds = Math.max(5, Math.floor((timeout - 5_000) / 1000));
  const invocation = buildAgyInvocation({
    prompt,
    yolo,
    continueLast,
    resumeConversationId,
    sandbox,
    addDirs,
    printTimeoutSeconds,
    extraArgs,
    bin,
  });

  return spawnStreamingCommand({
    bin: invocation.bin,
    args: invocation.args,
    cwd,
    env: { ...env },
    timeout,
    spawnImpl,
    onStdoutLine(line) {
      const trimmed = line.trimEnd();
      if (!trimmed.trim()) return;
      onEvent({ type: "text_delta", delta: trimmed });
    },
  }).then((result) => {
    const parsed = parseAgyTextResult(result.stdout);
    const resolvedSession = resolveSessionId({
      stdout: result.stdout,
      stderr: result.stderr,
      priority: ["stdout", "stderr", "file"],
    });
    const filteredStderr = stripBenignStderr(result.stderr);
    const hasVisibleText = Boolean(parsed.response.trim());
    const error = result.ok
      ? (hasVisibleText ? null : "agy produced no visible text")
      : (filteredStderr.trim() || result.error);
    return {
      ...result,
      ...parsed,
      sessionId: resolvedSession.sessionId,
      model: model ?? defaultModel ?? DEFAULT_AGY_MODEL,
      ok: result.ok && hasVisibleText,
      error,
      errorCode: classifyProviderFailure(error, { provider: "agy" }),
    };
  });
}
```

### Registry / constants / exports

1. `packages/polycli-runtime/src/constants.js`: append `"agy"` to
   `PROVIDER_IDS`. Keep order stable; add it at the end to minimize churn
   in downstream tests that iterate the list.
2. `packages/polycli-runtime/src/registry.js`:
   - Add the four imports from `./agy.js`.
   - `TIMING_SUPPORT.agy = { ttft: true, gen: true, tail: true, tool: false, runtimePersistence: "session" }`.
     Justification: line-by-line stdout streaming gives us real first-text
     and last-text marks; `--continue`/`--conversation` keep server-side
     session state. `tool: false` because agy emits no tool boundaries to
     stdout. NOTE: the `sessionId` field will always be `null` because
     agy never surfaces it — `buildTimingMeta` will correctly stamp
     `sessionIdMissing: true` on every run, which is honest and matches
     project memory `project_observability_state_root_failure_classification`.
   - `RUNTIMES.agy = { id: "agy", capabilities: { streaming: true, sessionResume: true, structuredOutput: false, operations: PROVIDER_OPERATION_NAMES }, getAvailability, getAuthStatus, runPrompt, runPromptStreaming }`.
     `structuredOutput: false` is the honest signal — no JSON event stream.
   - `isTerminalSummaryEvent`: no agy clause needed (we never emit a
     terminal-summary event; ttft/tail come from text_delta events directly).
3. `packages/polycli-runtime/src/index.js`: export the new agy functions
   matching the existing barrel pattern.

### Plugin host (`plugins/polycli/`)

1. `plugins/polycli/scripts/lib/preview.mjs`: add an agy branch to the
   provider-specific preview (mirror the `pi` branch). Text-only.
2. `plugins/polycli/scripts/lib/prompt-runtime.mjs`:
   - In the ask/rescue path, default `yolo: true` for agy (matches
     YOLO-standard memory `project_yolo_standard.md`: every provider's
     ask/rescue auto-approves).
3. `plugins/polycli/scripts/lib/review.mjs`:
   - **IMPORTANT JUDGMENT CALL.** agy has no `plan` / `--approval-mode`
     flag. Options:
     a) Refuse `/review --provider agy` with a clear error
        (`agy does not expose a non-interactive plan mode; /review
        cannot enforce read-only constraints`).
     b) Pass `--sandbox` + drop `--dangerously-skip-permissions` and
        accept that the model can still attempt tool calls (interactive
        prompt would hang in non-interactive mode).
   - **Implement option (a).** Add an `agy()` constraint builder that
     throws via `assertNoReviewConstraintOverride` is the wrong primitive;
     instead surface the rejection earlier — either:
     (i) Add `agy` to a `REVIEW_UNSUPPORTED_PROVIDERS` set checked at the
         top of `buildReviewRuntimeOptions`, throwing a clear message; OR
     (ii) Mirror the pattern used elsewhere if there is one — search
         `review.mjs` for `unsupported`/`refus` first.
   - If neither pattern exists, add the `REVIEW_UNSUPPORTED_PROVIDERS`
     set and the throw; document the gap in `docs/host-command-map.md`.
4. `plugins/polycli/scripts/polycli-companion.mjs` and
   `plugins/polycli/scripts/polycli-companion.bundle.mjs`: any provider
   listing / dispatch table needs an `agy` row. Search for occurrences
   of `"cmd"` and `"pi"` to find every place.
5. `plugins/polycli/scripts/tests/`: extend `providers.test.mjs`,
   `prompt-runtime.test.mjs`, `run-ledger.test.mjs`, `review.test.mjs`,
   `integration.test.mjs` to cover agy. The review test should assert
   the unsupported-provider rejection.

### Release / docs

1. `scripts/check-review-cli-drift.mjs`: add an `agy` entry. Since agy
   has no plan-mode flag, set `expect: []` and `notes: "agy has no
   plan-mode flag; /review is unsupported for this provider."` — this
   keeps the drift watcher honest while documenting the gap.
2. `docs/host-command-map.md`: add an agy column or row. For `review`,
   mark "unsupported (no plan mode)". For `ask`, `health`, `timing`,
   `status`, `result`, `cancel`, `debug` — supported.
3. `README.md` (and zh/ja variants if present): add agy to the provider
   listing.
4. `CHANGELOG.md`: prepend a new reverse-chronological entry. Suggested:
   ```
   ## v0.6.16 — 2026-05-20

   - **feat(provider):** add `agy` (Google Antigravity CLI 1.0.0) as a
     polycli provider. Text-only output (no streaming JSON), YOLO via
     `--dangerously-skip-permissions`, session resume via `--continue`
     /`--conversation`. `/review` is explicitly unsupported because
     agy has no plan-mode flag.
   - **chore:** drift-check entry for agy with `expect: []` to track
     when upstream adds a plan-mode flag.
   - Verification: `npm test` exit 0; `npm run release:check` exit 0
     (bundles, fixtures, manifests, host-map, codex-adapter, claude
     plugin validate, npm pack dry-runs).
   ```

### Tests (`packages/polycli-runtime/test/agy.test.js`)

Mirror `cmd.test.js` and `pi.test.js`. Coverage targets:

1. `buildAgyInvocation` arg ordering (YOLO default, sandbox, addDirs,
   conversation id vs --continue, extraArgs).
2. `buildAgyInvocation` with `yolo: false` (review hard path).
3. `parseAgyTextResult` collects stdout lines as text_delta events.
4. `stripBenignStderr` removes "Shell cwd was reset" but preserves a
   real error line.
5. `getAgyAvailability` uses `--help` (NOT `--version`).
6. `getAgyAuthStatus` returns `loggedIn:true` when prompt runner returns
   `ok:true`.
7. `getAgyAuthStatus` returns `loggedIn:false` on explicit auth-error
   stderr.
8. `getAgyAuthStatus` returns `loggedIn:true` + inconclusive detail on
   transient (timeout/429/etc).
9. `runAgyPrompt` with a fake binary that prints "hello world" — assert
   ok, response, events length, status:0, sessionId: null.
10. `runAgyPrompt` with a fake binary that exits 1 + writes an auth
    error to stderr — assert ok:false, error contains the stderr text,
    errorCode set.
11. `runAgyPromptStreaming` calls onEvent for each non-empty line.
12. `runAgyPromptStreaming` ignores benign "Shell cwd was reset" stderr.

Use `withFakeAgyBin(source, fn)` helper modeled on `withFakePiBin` /
`withFakeCmdBin` (script that prints to stdout then exits with given
code).

### Test wiring

- `packages/polycli-runtime/test/registry.test.js`: assert RUNTIMES has
  `agy` entry with the documented capability shape and timing-support
  flags.
- `packages/polycli-runtime/test/exports.test.js`: assert the index
  barrel exports `runAgyPrompt`, `getAgyAvailability`, etc.

## Hard constraints / non-goals

- **Do NOT** fabricate session ids, model strings, or tool boundaries.
  agy doesn't expose them. The four-state timing semantics
  (`measured` / `zero` / `missing` / `unsupported`) must not be folded.
  Where agy lacks a signal, return `null`/`unsupported` honestly.
- **Do NOT** commit any code from inside the Codex sandbox (per project
  memory `feedback_codex_rescue_operational.md`). The human will commit
  after verifying.
- **Do NOT** edit legacy plugin repos (`gemini-plugin-cc`, etc.) — they
  are permanent references.
- After all edits, run:
  ```
  node --test packages/polycli-runtime/test/agy.test.js
  npm test
  npm run release:check    # if it can be reached without publishing
  ```
  Report exit codes verbatim. Do not paper over failures.

## Hand-off

This file is the canonical spec. The user is on `main`. Branch off
`main` for this change; do NOT push or open a PR (human gates the
release).
