# 0003. No SAR filing or adverse-action capability exists

**Status:** Accepted

## Context

Filing a SAR, closing an account or blocking funds are legal, often irreversible decisions that a person
must own. A permission check that forbids a model from using such a tool can be misconfigured or bypassed.
A prompt telling the model not to use it is weaker still.

## Decision

No such tool exists. The tool registry (`src/tools/registry.ts`) has no filing, submission or
adverse-action entry. The `ADVERSE` permission class is always denied and has no members. There is no
filing-shaped API route. The only way out of `AWAITING_ANALYST` is `POST /cases/:id/analyst/decision`,
which needs the `analyst` role and an analyst identity. After a `CONSIDER_SAR` decision, the case hands off
to a stub representing the bank's own SAR workflow.

## Consequences

- The guarantee is structural: `grep -ri "fileSar\|submitSar" src/tools/` returns nothing, and
  `tests/api.test.ts` confirms filing-shaped routes return 404.
- No jailbreak or injection can reach a capability that isn't there.
- Integrating with a real SAR system would need a new, human-triggered path outside the agent pipeline and
  a new ADR.
