# Commands reference

Run from the project root. `bun run <name>` runs a `package.json` script.

## Development

| Command | Does |
|---|---|
| `bun install` | Install backend and UI dependencies |
| `bun run dev:api` | Start the API with file watching (port 8787) |
| `bun run dev:ui` | Start the Vite dev server for the workbench (port 5173) |
| `bun run typecheck` | TypeScript check of the backend |
| `cd ui && bun run build` | Type-check and build the UI into `ui/dist/` |

## Tests

| Command | Does |
|---|---|
| `bun test` | All 92 tests across 13 files, offline |
| `bun test tests/<file>.test.ts` | One file |

| Test file | Proves |
|---|---|
| `verifier.test.ts` | Tampered amounts and uncited claims fail verification and are withheld |
| `confidentiality.test.ts` | SAR-sensitive content never reaches the generic log or a `readonly` response |
| `injection.test.ts` | Injection payloads can't change the outcome, call tools or cross case scope |
| `hardStop.test.ts` | Nothing but an analyst decision leaves `AWAITING_ANALYST`; no filing tool exists |
| `permissions.test.ts` | Each tool class behaves as specified; `ADVERSE` is empty |
| `replay.test.ts` | Replay reproduces an identical packet; a version bump changes the cassette key |
| `api.test.ts` | Role rules and status codes on every route; filing-shaped routes 404 |
| `sourceResolver.test.ts` | Each source layer resolves; uncited IDs are refused |
| `analytics.test.ts` | Deterministic analytics are correct; `src/analytics/` imports no LLM code |
| `llmCassette.test.ts` | Cassette keys are stable and sensitive to every input |
| `agentsWiring.test.ts` | Each agent's prompt and schema are wired correctly |
| `domain.test.ts`, `duckdb.test.ts` | Schemas and the database binding |

The native DuckDB binding occasionally throws `DUCKDB_NODEJS_ERROR` under concurrent test access.
Re-running the failed file on its own passes. It is an environment issue, not a logic bug.

## Pipeline and data

| Command | Does | Needs |
|---|---|---|
| `bun run data:fetch` | Download IBM, OFAC and FFIEC sources into `data/raw/` | Network |
| `bun run data:select-cases` | Mine 8 cases into `data/overlay/cases.json` | `data/raw/` |
| `bun run data:build-overlay` | Generate KYC, alerts and notes; write the Parquet slice | `cases.json` |
| `AML_LLM_MODE=record bun run scripts/record-cases.ts [C-00x …]` | Record real model output | API key |
| `bun run scripts/seed-demo-cassettes.ts` | Write placeholder cassettes. **Overwrites recordings** | Nothing |
| `bun run replay <caseId>` | Replay one case from cassettes; always forces replay | Cassettes |
| `bun run evaluate` | Metrics against ground truth ([how](../how-to/run-evaluation.md)) | Cassettes |
| `bun run scripts/buildReport.ts` | Static HTML report of deterministic analytics only; no model calls | Nothing |

## Proving the hard stop by hand

```bash
grep -ri "fileSar\|submitSar" src/tools/
```

Returns nothing: no filing tool exists.

```bash
curl -X POST http://localhost:8787/cases/C-001/analyst/decision -H "content-type: application/json" -H "x-role: analyst" -d '{"disposition":"CLOSE","rationale":"test"}'
```

Returns 401: no `X-Analyst-Id`.
