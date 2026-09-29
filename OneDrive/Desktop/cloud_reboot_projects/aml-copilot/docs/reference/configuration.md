# Configuration reference

Configuration comes from environment variables (read from `.env` by Bun) and from version constants in
`src/config.ts`. Copy `.env.example` to `.env` to start.

## Environment variables

| Variable | Values | Default | Effect |
|---|---|---|---|
| `AML_LLM_PROVIDER` | `anthropic`, `groq` | `anthropic` | Which provider LangChain calls. Any other value fails at startup |
| `AML_MODEL_ID` | Any model ID | `claude-sonnet-5` (anthropic), `openai/gpt-oss-120b` (groq) | Overrides the provider default |
| `ANTHROPIC_API_KEY` | Key | none | Needed for `record` or `live` with Anthropic |
| `GROQ_API_KEY` | Key | none | Needed for `record` or `live` with Groq |
| `AML_LLM_MODE` | `record`, `replay`, `live` | `replay` | How model calls are served (below) |
| `PORT` | Number | `8787` | API port |
| `VITE_API_URL` | URL | `http://localhost:8787` | UI only: where the workbench sends API calls |

### `AML_LLM_MODE`

| Mode | Reads cassette | Calls model | Writes cassette | Use for |
|---|---|---|---|---|
| `replay` | Yes | **Never** | No | Tests, demos, day-to-day work. A missing cassette is an error, never a silent live call |
| `record` | No | Yes | Yes | Capturing real output ([how](../how-to/record-cassettes.md)) |
| `live` | No | Yes | No | One-off experiments that shouldn't touch cassettes |

## Version constants (`src/config.ts`)

Every model call's cassette key and audit record include these, so a change can never silently reuse
stale output.

| Constant | Current | Bump when |
|---|---|---|
| `PROMPT_VERSION` | `1.1.0` | Any agent's system prompt changes |
| `POLICY_VERSION` | `2026.09.0` | `src/policy/typologies.yaml` (the FFIEC corpus) changes |
| `AGENT_EFFORT` | `high` | Not normally changed. One flat effort level for all five agents |

`PROMPT_VERSION` history: `1.1.0` narrowed the verifier to material facts and gave it the deterministic
computations. `1.0.0` blocked every case (see [ADR 0005](../decisions/0005-verifier-checks-material-facts-only.md)).

## Paths

All paths are relative to the project root.

| Path | Contents | In git |
|---|---|---|
| `data/raw/` | Full downloaded sources | No |
| `data/slice/transactions.parquet` | Real transactions for the 8 mined accounts | Yes |
| `data/overlay/` | `cases.json` plus generated KYC, alerts and notes | Yes |
| `src/policy/typologies.yaml` | FFIEC Appendix F red-flag corpus | Yes |
| `fixtures/cassettes/` | Recorded model responses, one JSON file per key | No |
| `audit/case-<id>.jsonl` | Full per-case audit log | No |
| `audit/generic.jsonl` | Redacted app-wide audit log | No |
