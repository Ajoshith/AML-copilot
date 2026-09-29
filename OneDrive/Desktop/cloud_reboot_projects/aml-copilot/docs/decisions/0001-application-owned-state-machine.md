# 0001. The workflow is an application-owned state machine

**Status:** Accepted

## Context

An AML investigation has a fixed legal shape: gather evidence, assess the customer, check sanctions, map
red flags, verify, draft, and hand to a human. The blueprint (§7) says to "prefer an application-owned
workflow/state machine for the system of record" and never to encode analyst approval only in a prompt.
An autonomous agent loop would decide its own next step, which makes the gates probabilistic and hard to
audit.

## Decision

The orchestrator (`src/orchestrator/pipeline.ts`) runs a fixed sequence of steps. An explicit transition
table (`src/orchestrator/state.ts`) lists every legal move and throws on anything else. The pipeline halts
at `AWAITING_ANALYST`, `ESCALATED_SANCTIONS` or `BLOCKED_VERIFICATION`. It has no code path beyond those.

## Consequences

- Every gate is ordinary code that tests can assert structurally (`tests/hardStop.test.ts`).
- The audit log is a complete record of transitions with reasons.
- Adding a step means editing the table and the pipeline deliberately. That is a feature here, not friction.
- The model can't adapt the investigation, for example by fetching extra data it decides it needs. Missing
  information becomes a declared data gap for a human to research.
