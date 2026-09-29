# How to run the live demo

A scripted five-minute walkthrough for an audience. It matches slide 11 of the
[demo deck](../AML_CoPilot_Demo.pptx).

## Before the audience arrives

1. Make sure `fixtures/cassettes/` holds cassettes for all eight cases. Real recorded output is best;
   see [Record cassettes](record-cassettes.md).
2. Confirm `.env` has `AML_LLM_MODE=replay`, so nothing calls the paid API during the demo.
3. Start both servers in separate terminals:

   ```bash
   bun run dev:api
   ```

   ```bash
   bun run dev:ui
   ```

4. Open the UI and run each case once, so the queue is populated and nothing is left spinning live.
   Or run all eight from a terminal:

   ```bash
   for c in C-001:8075AC7C0 C-002:809862880 C-003:811B6E170 C-004:802E2AD70 C-005:8075DA9D0 C-006:800042A10 C-007:80154AAF0 C-008:800393E30; do curl -s -X POST -H "content-type: application/json" -H "x-role: analyst" -d "{\"accountId\":\"${c##*:}\"}" localhost:8787/cases/${c%%:*}/run; echo; done
   ```

   Expect seven cases at `AWAITING_ANALYST` and C-005 at `ESCALATED_SANCTIONS`.

> Case state is held in memory. Recording a decision changes a case for the rest of the session.
> Restart the API to reset every case.

## The walkthrough

| # | Do | Point out |
|---|---|---|
| 1 | Open **C-001** | Pipeline stepper (all steps done, waiting at *Analyst*), key-figure strip, and the recommendation: *Consider SAR*, 60% confidence. |
| 2 | Read the **Why** block | Bottom line first, then activity pattern, customer profile, red flags and alternative explanations. The AI is required to argue the innocent explanation too. |
| 3 | **Evidence** tab → click a green citation | The source panel shows the real IBM transaction behind the claim. Green means real data, amber means generated overlay. |
| 4 | **Typology** tab | Each red flag quotes the actual FFIEC Appendix F wording, with a strength rating and its supporting records. |
| 5 | **Decision** tab → pick a different disposition | An override reason becomes mandatory. Submit; the case moves to *Decided* and a toast confirms the signer. |
| 6 | Switch role to **Read-only** | Case content disappears. Confidentiality is enforced by the server. |
| 7 | Open **C-005** | The stepper stops at *Analytics*: a real OFAC sanctions match routed the case to the sanctions team. |

Keyboard shortcuts that help on stage: `J` / `K` move between cases, `1`–`7` switch tabs, `/` focuses search.

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Run fails with "no cassette" | A cassette is missing for that case and mode is `replay` | Record it ([how](record-cassettes.md)), or seed placeholders |
| A case is stuck on *Decided* from a rehearsal | In-memory state from an earlier run | Restart the API |
| UI shows "Could not load case" | API not running, or on another port | Start `bun run dev:api`; check `PORT` in `.env` |
