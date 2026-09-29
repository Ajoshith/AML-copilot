# HTTP API reference

Elysia on Bun. Default base URL `http://localhost:8787` (set by `PORT`). All bodies are JSON.
Source: `src/api/main.ts`, `src/api/routes/cases.ts`, `src/api/routes/analyst.ts`.

## Identity

Identity comes from two request headers. This is a **prototype stand-in for real SSO/IAM**
(`src/api/identity.ts`).

| Header | Values | If missing or invalid |
|---|---|---|
| `X-Role` | `analyst`, `sanctions`, `readonly` | Treated as `readonly` |
| `X-Analyst-Id` | Any non-empty string | `null`. Required to record a decision |

**SAR-scoped roles** are `analyst` and `sanctions`. Only they may see case content. Only `analyst`
may record a decision or request a draft narrative.

## Routes

| Method | Path | Who | Purpose |
|---|---|---|---|
| `GET` | `/` | Anyone | Health check |
| `GET` | `/metrics` | Anyone | Case counts by state, decisions and overrides |
| `GET` | `/cases` | Anyone | Case queue: mined case summaries with current state |
| `GET` | `/cases/:id` | SAR-scoped | Full case record |
| `POST` | `/cases/:id/run` | Not `readonly` | Run the pipeline to its halt point |
| `GET` | `/cases/:id/packet` | SAR-scoped | The coordinator's case packet |
| `GET` | `/cases/:id/audit` | Anyone | Audit log, redacted unless SAR-scoped |
| `GET` | `/cases/:id/sources?id=` | SAR-scoped | Resolve one cited source ID to its record |
| `POST` | `/cases/:id/analyst/decision` | `analyst` + analyst ID | Record the human disposition |
| `POST` | `/cases/:id/analyst/draft-narrative` | `analyst` | Write an AI-namespace draft narrative |

No route files, submits or otherwise acts on a SAR. `tests/api.test.ts` checks that
`file-sar`, `submit-sar`, `close-account` and `block-funds` all return 404.

---

### `GET /metrics`

```json
{ "totalCases": 8, "byState": { "AWAITING_ANALYST": 7, "ESCALATED_SANCTIONS": 1 }, "dispositionsRecorded": 0, "overrides": 0 }
```

Cases never run count under `NOT_RUN`.

### `GET /cases`

```json
{ "cases": [ { "caseId": "C-001", "accountId": "8075AC7C0", "classification": "gather-scatter-like",
  "rationale": "…", "isLaundering": true, "shape": { "txnCount": 28, "inDegree": 13, "…": 0 }, "state": null } ] }
```

`isLaundering` is the IBM ground-truth label, shown for evaluation. Note: the per-transaction label currently reaches the Evidence agent too — see [known limitations](../explanation/system-card.md#known-limitations).

### `GET /cases/:id`

Returns the full case record: `state`, `evidence`, `kycAssessment`, `sanctionsResult`, `computations`,
`typologyAssessment`, `verification`, `casePacket`, `disposition`, `aiDrafts`, `researchTasks`,
`officialRecord`. Fields are `null` until their step has run. Shapes are in the
[data model](data-model.md#agent-output-schemas).

| Status | When |
|---|---|
| 200 | SAR-scoped role |
| 403 | `readonly` role: `This role cannot view case content` |

### `POST /cases/:id/run`

Body: `{ "accountId": "8075AC7C0" }`. Runs the pipeline synchronously and returns where it halted.

```json
{ "caseId": "C-001", "state": "AWAITING_ANALYST" }
```

Possible halt states: `AWAITING_ANALYST`, `ESCALATED_SANCTIONS`, `BLOCKED_VERIFICATION`.

| Status | When |
|---|---|
| 200 | Run completed |
| 400 | Body missing or invalid |
| 403 | `readonly` role |
| 409 | Run failed, e.g. an illegal state transition or a missing cassette in `replay` mode |

A replayed run takes seconds. A live run at high effort can take several minutes. Poll `GET /cases/:id`
for progress; the UI does this every 1.2 s.

### `GET /cases/:id/packet`

```json
{ "caseId": "C-001", "state": "AWAITING_ANALYST", "casePacket": { "recommendation": "CONSIDER_SAR", "confidence": 0.6, "…": "…" } }
```

| Status | When |
|---|---|
| 200 | Packet exists and role is SAR-scoped |
| 403 | Case is `BLOCKED_VERIFICATION` (packet withheld), no packet yet, or role not SAR-scoped |

### `GET /cases/:id/audit`

```json
{ "caseId": "C-001", "events": [ { "type": "state_transition", "fromState": "INGESTED", "toState": "EVIDENCE", "…": "…" } ] }
```

SAR-scoped roles get full events. Other roles get the same events with SAR-sensitive fields replaced by
`[REDACTED:SAR-SENSITIVE]`. Event types are listed in the [data model](data-model.md#audit-events).

### `GET /cases/:id/sources?id=<source_id>`

Resolves one source ID **that this case cites** to the underlying record. Pass the ID as a query
parameter, URL-encoded, because source IDs contain colons.

```json
{ "sourceId": "txn:ibm:HI-Small:423257", "layer": "txn",
  "transaction": { "timestamp": "2022-09-01T03:21:00.000Z", "fromAccount": "8075AC7C0", "toAccount": "8093599E0",
  "amountPaid": 530992.66, "paymentCurrency": "US Dollar", "paymentFormat": "ACH", "isLaundering": false, "…": "…" } }
```

The response shape depends on `layer`: `txn`, `sdn`, `kyc`, `alert`, `note` or `policy`
(see `src/data/sourceResolver.ts`).

| Status | When |
|---|---|
| 200 | Resolved |
| 400 | `id` query parameter missing |
| 403 | Role not SAR-scoped, **or** the ID is not cited anywhere in this case |
| 404 | Case not run yet, or ID cited but unresolvable |

The "not cited" 403 is the access control. It stops the route being used to browse the 5M-row dataset.

### `POST /cases/:id/analyst/decision`

The hard stop. The only way to move a case out of `AWAITING_ANALYST`.

```json
{ "disposition": "CLOSE", "rationale": "Reviewed all inbound transfers…", "overrideReason": "Counterparties verified…" }
```

- `disposition`: `CLOSE`, `INVESTIGATE_FURTHER`, `ESCALATE_EDD`, `ESCALATE_SANCTIONS` or `CONSIDER_SAR`.
- `rationale`: required, non-empty.
- `overrideReason`: required when `disposition` differs from the AI recommendation.
- The analyst identity comes from `X-Analyst-Id` only. It cannot be set in the body.

On success the case moves `AWAITING_ANALYST → DISPOSITION_RECORDED → QA`:

```json
{ "caseId": "C-001", "state": "QA", "disposition": "CLOSE", "matchedAiRecommendation": false }
```

| Status | When |
|---|---|
| 200 | Recorded |
| 400 | Invalid body, or the disposition overrides the AI without `overrideReason` |
| 401 | `X-Analyst-Id` missing |
| 403 | Role is not `analyst` |
| 409 | Case is not in `AWAITING_ANALYST`. A case can be decided only once |

### `POST /cases/:id/analyst/draft-narrative`

Body: `{ "text": "…" }`. Writes a draft through the `writeDraftNarrative` tool (DRAFT class). Drafts land
in `aiDrafts`, never in `officialRecord`.

| Status | When |
|---|---|
| 200 | `{ "caseId": "…", "written": … }` |
| 400 | Invalid body |
| 403 | Role is not `analyst`, or the permission gate denied the tool call |
