# 0002. Code computes, AI explains, humans decide; agents have no tools

**Status:** Accepted

## Context

Totals, ratios, counterparty counts and sanctions name-matching each have one correct answer, and they must
be reproducible and auditable. An LLM is slower, non-deterministic and unauditable at those tasks. Other
tasks, such as narrating varied evidence, comparing free-text profiles with behaviour, or reading regulator
prose against a case, are judgement work that rule engines handle poorly. Giving agents tools would widen
the prompt-injection attack surface.

## Decision

- All numbers and the sanctions screen are deterministic SQL in `src/analytics/`, which must not import LLM
  code (enforced by a test).
- The orchestrator fetches data and runs computations **before** each agent call and passes a pre-assembled
  context. Each agent is a single structured call with no tools and no loop (`src/agents/base.ts`).
- Agents may only interpret facts they are given. Their outputs must cite sources and fit closed schemas,
  including a closed recommendation enum.
- The disposition belongs to a human.

## Consequences

- Every figure an agent is given comes from a `Computation` that the verifier recomputes. Numbers the agents
  write into prose are checked only by the Verifier model, which is a known gap.
- Prompt injection has nothing to hijack: no agent can invoke anything.
- An agent can't ask for more data mid-investigation. Gaps must be declared instead.
- The model's value is concentrated where a template would fail: case-specific narrative, profile-mismatch
  reasoning, red-flag judgement and counter-hypotheses.
