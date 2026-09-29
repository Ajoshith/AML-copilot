# Glossary

## AML and compliance terms

| Term | Meaning |
|---|---|
| **AML** | Anti-Money Laundering. The laws, controls and teams that stop criminal proceeds moving through the financial system |
| **Alert** | A flag raised by a bank's transaction-monitoring rules on an account. The starting point of an investigation |
| **Transaction monitoring (TM)** | Automated rules that scan transactions and raise alerts |
| **KYC** | Know Your Customer. Verifying who a customer is |
| **CDD / EDD** | Customer Due Diligence: what the bank records about a customer's occupation, business and expected activity. Enhanced Due Diligence is the deeper review for higher-risk customers |
| **SAR** | Suspicious Activity Report. The confidential filing a U.S. bank makes to FinCEN when it suspects illicit activity. The decision is a human, legal judgement |
| **SAR confidentiality** | The legal requirement that the existence and content of a SAR are not disclosed, including to the customer |
| **OFAC / SDN list** | The U.S. Treasury's Office of Foreign Assets Control publishes the Specially Designated Nationals list of blocked people and entities |
| **FFIEC** | Federal Financial Institutions Examination Council. Its BSA/AML Examination Manual is the examiner's handbook; Appendix F lists money-laundering red flags |
| **BSA** | Bank Secrecy Act, the core U.S. AML law |
| **Typology** | A recognised pattern of money laundering, such as structuring or layering |
| **Red flag** | An indicator that activity may be suspicious. Here, one clause of FFIEC Appendix F |
| **Structuring** | Splitting transactions to stay under reporting thresholds such as $10,000 |
| **Layering** | Moving funds through many transactions, accounts or currencies to obscure their origin |
| **Fan-out / gather-scatter** | Network shapes: one account paying many (fan-out), or collecting from many and then paying out to many (gather-scatter) |
| **Pass-through ratio** | How much of the money coming in goes straight back out. Near 1.0 suggests a conduit account |
| **Disposition** | The analyst's decision on a case: close, investigate further, escalate to EDD, escalate to sanctions, or consider a SAR |
| **Model risk management (MRM)** | A bank's governance of the models it uses. U.S. supervisory guidance is SR 11-7 |

## Project terms

| Term | Meaning |
|---|---|
| **Agent** | One bounded, single-shot model call with a fixed prompt and a validated output schema. It has no tools and no loop |
| **Case packet** | The Coordinator agent's output: memo, findings, counter-hypotheses, recommendation, confidence, blocking gaps |
| **Cassette** | A stored model response, keyed by a hash of everything that produced it. Enables offline replay |
| **Computation** | A number produced by deterministic SQL, with the source IDs it was derived from |
| **Counter-hypothesis** | A legitimate explanation for the activity. At least one is required |
| **Data gap** | Information the investigation needed but didn't have. Flagged, never guessed |
| **Blocking gap** | A data gap that must be resolved before a disposition |
| **Hard stop** | The `AWAITING_ANALYST` state. Only an authenticated analyst decision leaves it |
| **Overlay** | The synthetic layer of KYC profiles, alerts and notes. Source IDs contain `:overlay:` |
| **Override** | An analyst disposition that differs from the AI recommendation. It needs a written reason |
| **SAR-scoped role** | A role allowed to see SAR-sensitive content: `analyst` or `sanctions` |
| **Source ID** | The provenance tag on every fact, such as `txn:ibm:HI-Small:423257` |
| **Untrusted content** | Free text from case records, wrapped in tags and treated strictly as data by every agent |
| **Verifier** | The fail-closed check: deterministic recomputation first, then a model review of material claims |
