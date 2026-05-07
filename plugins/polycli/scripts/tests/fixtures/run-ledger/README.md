# Run Ledger Fixtures

These sanitized fixtures capture real provider failure shapes used by the run-ledger tests.

- `cmd-health-ask-failure.meta.json`: `cmd` health can pass while prompt-bearing `ask` is not usable.
- `pi-health-failure.meta.json`: `pi` health can fail and should become a skipped provider decision.

Fixtures must not include full prompts, full stdout/stderr, environment variables, API keys, tokens, or local-only secrets.

`stdoutBytes` and `stderrBytes` are recorded as captured. The current health
JSON shape does not surface those byte counts, so the `pi` fixture stores
`null` for them; the `cmd` ask envelope does surface them and is preserved as
captured.
