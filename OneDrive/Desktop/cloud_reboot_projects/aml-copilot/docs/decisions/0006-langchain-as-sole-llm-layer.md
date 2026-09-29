# 0006. LangChain is the only LLM access layer

**Status:** Accepted

## Context

Provider availability and credit changed during development, and a bank may mandate a particular model
vendor. If agent code imported a provider SDK directly, switching providers would touch every agent.

## Decision

Agents call `src/llm/call.ts`, which calls `src/llm/client.ts`. That file is the only place a provider is
chosen, using LangChain's `ChatAnthropic` or `ChatGroq`, selected by `AML_LLM_PROVIDER`. Structured output
uses `withStructuredOutput(schema, { method: "jsonSchema" })` for both. The Anthropic client always
streams, because long high-effort calls are rejected otherwise.

## Consequences

- Switching provider or model is configuration only ([how](../how-to/switch-llm-provider.md)).
- Schemas, the verifier and cassettes are provider-independent. Cassettes are still model-specific by key.
- Provider-specific features are normalised or dropped. Groq has no refusal signal, and effort is clamped
  to Groq's coarser scale.
