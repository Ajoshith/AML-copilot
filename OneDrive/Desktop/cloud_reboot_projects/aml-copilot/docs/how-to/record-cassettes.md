# How to record cassettes against the live model

Record real model output so the pipeline, the UI and evaluation can replay it offline.

## You need

- An API key for the provider in use (`ANTHROPIC_API_KEY` for the default Anthropic provider) in `.env`.
- Budget for the run. The last full recording of all eight cases made 32 model calls and used
  561,485 input and 128,811 output tokens.

## Steps

1. Set the mode to `record` for this command only. Leave `.env` on `replay` so later demos cannot
   make paid calls by accident.
2. Record one cheap case first as a smoke test:

   ```bash
   AML_LLM_MODE=record bun run scripts/record-cases.ts C-006
   ```

3. Record the rest. Pass case IDs to record a subset, or none for all eight:

   ```bash
   AML_LLM_MODE=record bun run scripts/record-cases.ts
   ```

   The script prints each case's end state, token usage and latency, and exits non-zero listing any
   cases that failed so you can retry just those.

4. Confirm the recording replays cleanly:

   ```bash
   bun run replay C-001
   ```

## When you must re-record

A cassette key is a hash of the model ID, system prompt, full message content, output schema name,
`POLICY_VERSION`, `PROMPT_VERSION` and effort level. Existing cassettes stop matching, and replay
fails loudly rather than silently reusing stale output, whenever you:

- change any agent's system prompt, and bump `PROMPT_VERSION` in `src/config.ts`
- change the typology corpus, and bump `POLICY_VERSION`
- switch provider or model ([how](switch-llm-provider.md))
- change the source data an agent sees

## Notes

- Recorded cassettes live in `fixtures/cassettes/` and are gitignored. Share them out of band if a
  teammate needs the same recorded output.
- `bun run scripts/seed-demo-cassettes.ts` writes hand-written placeholders to the **same keys**. It
  overwrites real recordings. Don't run it once you have recorded output.
- High effort with adaptive thinking can exceed ten minutes per call, so the Anthropic client always
  streams (`src/llm/client.ts`). A long pause on one agent is normal.
