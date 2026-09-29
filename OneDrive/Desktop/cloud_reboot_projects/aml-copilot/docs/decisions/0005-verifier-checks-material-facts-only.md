# 0005. The verifier fails closed on material facts only

**Status:** Accepted. Supersedes the verifier scope in prompt version 1.0.0.

## Context

The blueprint says the packet "fails closed if material facts cannot be verified" (§5, step 6), and
separately that incomplete data should become a research task, not a blocked packet (§9). The first live
recording at prompt version 1.0.0 blocked **all seven** AML cases. Investigation showed two causes. The
verifier treated the typology agent's required, honest data-gap statements as contradictions. And it was
never shown the deterministic computations, so it flagged correct references to computed values as
unsupported.

## Decision

- The verifier's model pass is scoped to **material facts**. Declared data gaps are required, not
  contradictions. Strength calibration is not a verifiable fact. The default verdict is PASS, and a wrong
  FAIL is treated as a serious failure in itself.
- The verifier receives the deterministic computations it is asked to check against.
- The deterministic pass is unchanged: amounts, citations and clause IDs are still recomputed and resolved
  in code, and any mismatch still fails closed.
- `PROMPT_VERSION` was bumped to `1.1.0` and all cases were re-recorded.

## Consequences

- The false block rate went from 7 of 7 to 0 of 7, and every AML case now reaches the analyst.
- Missing information shows up as blocking gaps on the recommendation, which is where the blueprint puts it.
- An over-strict safety check fails as badly as a lax one. Block rate and block reasons are now standing
  evaluation metrics.
