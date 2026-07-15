# Model Fallback Policy

`ask`, `rescue`, `review`, `adversarial-review`, `health`, `status`, and `result`
should expose a top-level `model` when the provider CLI makes one knowable.

The preferred source is always the provider's own current run output:

1. Parse model metadata from the provider's stdout/stderr event stream.
2. If the current run omits model metadata, use the host companion's cached
   provider model as `defaultModel`.
3. Populate that cache only from explicit user model selection, status-only
   auth inspection, `health`, or explicit `setup --probe-auth` output. The
   default `setup` path deliberately skips model-based auth probes and may not
   yield a model.

This is intentionally a final fallback, not a shared model-extraction framework.
Provider modules keep their own parser logic because upstream event shapes differ.
The registry only threads `defaultModel` through once every provider-specific
parser has had the first chance to report a model.

## Guardrail

`plugins/polycli/scripts/tests/integration.test.mjs` includes an integration test
that runs `setup` against a fake provider which reports a model, then runs `ask`
against a stream that deliberately omits every model field. The expected result
is that `ask --json` still returns the cached setup model.

That test is the sustainability signal for Q2. If it fails, fix the cache/fallback
contract or update this policy before changing provider-specific fallbacks.
