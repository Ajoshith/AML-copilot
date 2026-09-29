# Architecture Decision Records

Each record captures one significant decision, in Michael Nygard's format: **Context** (the forces at
play), **Decision** (what we chose), **Consequences** (what follows, good and bad). Records are never
edited to change a decision. A new record supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-application-owned-state-machine.md) | The workflow is an application-owned state machine, not an autonomous agent | Accepted |
| [0002](0002-code-computes-ai-explains.md) | Code computes, AI explains, humans decide; agents have no tools | Accepted |
| [0003](0003-no-sar-filing-capability.md) | No SAR filing or adverse-action capability exists anywhere | Accepted |
| [0004](0004-content-addressed-cassettes.md) | Model calls are content-addressed and recorded for replay | Accepted |
| [0005](0005-verifier-checks-material-facts-only.md) | The verifier fails closed on material facts only; data gaps are not failures | Accepted |
| [0006](0006-langchain-as-sole-llm-layer.md) | LangChain is the only LLM access layer | Accepted |
| [0007](0007-real-public-data-with-synthetic-kyc.md) | Real public data, with a labelled synthetic KYC overlay | Accepted |

To add one, copy the newest record, take the next number, and link it here.
