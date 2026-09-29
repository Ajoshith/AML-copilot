# How to switch the LLM provider or model

Every agent reaches the model through LangChain in `src/llm/client.ts`. No agent, orchestrator or API
module imports a provider SDK, so switching is configuration only.

## Switch to Groq

1. Put `GROQ_API_KEY=...` in `.env`.
2. Set the provider:

   ```bash
   AML_LLM_PROVIDER=groq bun run dev:api
   ```

   Or set `AML_LLM_PROVIDER=groq` in `.env`.

3. Re-record cassettes. The model ID is part of every cassette key, so cassettes recorded with
   Claude never replay under Groq ([how](record-cassettes.md)).

## Use a different model

Set `AML_MODEL_ID` to override the provider default:

```bash
AML_MODEL_ID=claude-opus-5 bun run dev:api
```

Then re-record cassettes for the same reason.

## What differs between providers

| | Anthropic (default) | Groq |
|---|---|---|
| Default model | `claude-sonnet-5` | `openai/gpt-oss-120b` |
| Structured output | Native JSON schema | OpenAI-compatible strict `json_schema` |
| Reasoning control | Adaptive thinking + `effort` (low → max) | `reasoningEffort` (low / medium / high) |
| Refusal detection | `stop_reason: "refusal"` | None |

`AGENT_EFFORT` is written on Anthropic's scale and clamped for Groq (`xhigh` and `max` become `high`).
Output schemas, the verifier and the cassette layer are identical for both providers.
