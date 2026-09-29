# 0004. Model calls are content-addressed and recorded for replay

**Status:** Accepted

## Context

Tests and demos must be deterministic, free and offline. Model-risk review needs to reconstruct exactly
what a model saw and said. Caching by case ID or agent name alone would silently serve stale output after a
prompt or policy change.

## Decision

Every model call is keyed by the SHA-256 of a stable, recursively key-sorted serialisation of: model ID,
system prompt, messages, schema name, `POLICY_VERSION`, `PROMPT_VERSION` and effort (`src/llm/cassette.ts`).
`AML_LLM_MODE` chooses `record`, `replay` (the default) or `live`. In `replay`, a missing cassette is an
error, never a silent live call.

## Consequences

- Replay reproduces a byte-identical packet (`tests/replay.test.ts`).
- Changing a prompt, the policy corpus, the model or the input data invalidates exactly the affected
  cassettes. Replay then fails loudly until someone re-records.
- Recorded cassettes are gitignored because they are large and model-specific. A fresh clone must record or
  seed before demoing.
- The placeholder seeding script writes to the same keys as real recordings and overwrites them.
- A bug in the stable serialiser once collapsed distinct prompts to one key. `tests/llmCassette.test.ts`
  now guards against it.
