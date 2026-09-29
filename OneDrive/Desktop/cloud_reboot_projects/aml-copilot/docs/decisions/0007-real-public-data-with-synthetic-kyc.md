# 0007. Real public data, with a labelled synthetic KYC overlay

**Status:** Accepted

## Context

Invented example data would make the demo unconvincing and the evaluation meaningless. The blueprint also
forbids inventing policy. But real KYC profiles, alerts and analyst notes are private by definition, and no
public equivalent exists.

## Decision

- Transactions come from IBM AMLworld HI-Small, a published benchmark with laundering labels. Sanctions
  come from the real U.S. Treasury OFAC SDN list. Red flags come from the regulator-published FFIEC BSA/AML
  Manual, Appendix F.
- Cases are **mined** from the real data by structure and label (`scripts/select-cases.ts`), not written by
  hand.
- Alerts are raised by monitoring rules over the real transactions (`src/analytics/alertRules.ts`).
- KYC profiles and notes are generated (`scripts/build-overlay.ts`). Every one carries an
  `:overlay:` source ID, and the UI shows those citations in amber rather than green.
- Only a small derived slice of the transactions is committed, to respect the CDLA-Sharing licence and keep
  the repository small.

## Consequences

- Every citation is either a real record or visibly synthetic.
- Results can be compared with real ground truth. The label must then be kept away from the agents, both
  directly (the per-transaction label is allowlisted out) and by proxy (the KYC `riskRating` is scored from
  onboarding attributes, never from the label). Both are test-enforced. See the
  [system card](../explanation/system-card.md#known-limitations).
- Synthetic profiles are cruder than real ones and can make mismatches easier to spot.
- Re-mining or refreshing data needs the full download ([how](../how-to/refresh-source-data.md)).
