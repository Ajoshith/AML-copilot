/**
 * Mines 8 investigation cases from the real IBM AMLworld data, using only real
 * structural signals (degree, cash usage, currency mix) and the dataset's own real
 * `Is Laundering` ground truth — no case is hand-authored. Writes
 * data/overlay/cases.json, which build-overlay.ts then reads to generate the KYC,
 * alert and note overlay for exactly these accounts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { launderingShapes, benignShapes, lowActivityBenignAccount, type AccountShape } from "../src/data/caseMining.ts";
import { DATA_OVERLAY_DIR } from "../src/config.ts";

export const MinedCaseSchema = z.object({
  caseId: z.string(),
  accountId: z.string(),
  classification: z.string(),
  rationale: z.string(),
  isLaundering: z.boolean(),
  shape: z.object({
    txnCount: z.number(),
    inDegree: z.number(),
    outDegree: z.number(),
    cashCount: z.number(),
    distinctCurrencies: z.number(),
    totalTxnCount: z.number(),
  }),
});
export type MinedCase = z.infer<typeof MinedCaseSchema>;

/**
 * Cap on an account's TOTAL transaction count (not just its laundering-flagged
 * subset) — without this, mining can pick an account that looks small within a
 * filtered view but is actually a mega-hub/exchange-like account overall, which
 * makes an unreadable "case" and bloats the committed slice (this happened on
 * the first run: two accounts with small laundering-flagged counts turned out to
 * have 100K+ total transactions each).
 */
const MAX_TOTAL_TXN = 1000;

function pickDistinct(
  candidates: AccountShape[],
  used: Set<string>,
  predicate: (s: AccountShape) => boolean,
): AccountShape {
  const found = candidates.find(
    (c) => !used.has(c.accountId) && c.totalTxnCount <= MAX_TOTAL_TXN && predicate(c),
  );
  if (!found) throw new Error(`No candidate matched predicate among ${candidates.length} shapes`);
  used.add(found.accountId);
  return found;
}

function toMinedCase(
  caseId: string,
  classification: string,
  rationale: string,
  shape: AccountShape,
): MinedCase {
  return MinedCaseSchema.parse({
    caseId,
    accountId: shape.accountId,
    classification,
    rationale,
    isLaundering: shape.isLaundering,
    shape: {
      txnCount: shape.txnCount,
      inDegree: shape.inDegree,
      outDegree: shape.outDegree,
      cashCount: shape.cashCount,
      distinctCurrencies: shape.distinctCurrencies,
      totalTxnCount: shape.totalTxnCount,
    },
  });
}

async function main() {
  console.log("Mining laundering-labelled account shapes...");
  const laundering = await launderingShapes({ useSlice: false });
  console.log(`  ${laundering.length} candidates`);

  console.log("Mining benign (non-laundering) account shapes...");
  const benign = await benignShapes({ useSlice: false });
  console.log(`  ${benign.length} candidates`);

  const used = new Set<string>();
  const cases: MinedCase[] = [];

  // C-001: gather-scatter-like — real laundering account with both in- and
  // out-degree present (money gathered from multiple sources, scattered to
  // multiple destinations). Cash usage, if any, is a bonus, not a requirement —
  // the near-threshold cash signal itself is computed later by patterns.ts,
  // not at selection time.
  const c001 = pickDistinct(laundering, used, (s) => s.inDegree >= 2 && s.outDegree >= 2);
  cases.push(
    toMinedCase(
      "C-001",
      "gather-scatter-like",
      `Real laundering-labelled account with in-degree ${c001.inDegree} and out-degree ${c001.outDegree} — ` +
        `money both gathered from and scattered to multiple counterparties` +
        (c001.cashCount > 0 ? `, including ${c001.cashCount} cash transactions.` : `.`),
      c001,
    ),
  );

  // C-003: fan-out/pass-through — laundering account whose out-degree dominates
  // in-degree (or vice versa), i.e. a funnel shape rather than a balanced hub.
  const c003 = pickDistinct(
    laundering,
    used,
    (s) => s.outDegree >= 3 && s.outDegree >= s.inDegree * 2,
  );
  cases.push(
    toMinedCase(
      "C-003",
      "fan-out-like",
      `Real laundering-labelled account with out-degree ${c003.outDegree} far exceeding ` +
        `in-degree ${c003.inDegree} — consistent with a pass-through/funnel account.`,
      c003,
    ),
  );

  // C-004: another distinct real laundering account. Its overlay KYC profile will
  // deliberately be left stale/incomplete to exercise the data-gap path — the
  // account itself is mined the same way as any other positive case.
  const c004 = pickDistinct(laundering, used, (s) => s.txnCount >= 5);
  cases.push(
    toMinedCase(
      "C-004",
      "gather-scatter-like",
      `Real laundering-labelled account (in-degree ${c004.inDegree}, out-degree ${c004.outDegree}); ` +
        `its overlay KYC record is deliberately generated stale/incomplete to test the data-gap path.`,
      c004,
    ),
  );

  // C-007: cross-currency — prefer a laundering account touching more than one
  // currency; if none exists in the labelled pool, fall back to the highest
  // remaining combined-degree candidate (still real, still laundering-labelled).
  const c007found = laundering.find(
    (s) => !used.has(s.accountId) && s.totalTxnCount <= MAX_TOTAL_TXN && s.distinctCurrencies > 1,
  );
  const c007 = c007found ?? pickDistinct(laundering, used, () => true);
  used.add(c007.accountId);
  cases.push(
    toMinedCase(
      "C-007",
      c007.distinctCurrencies > 1 ? "cross-currency-cycle-like" : "gather-scatter-like",
      c007.distinctCurrencies > 1
        ? `Real laundering-labelled account transacting in ${c007.distinctCurrencies} distinct currencies.`
        : `Real laundering-labelled account (no multi-currency candidate remained unused; ` +
          `selected by combined degree instead).`,
      c007,
    ),
  );

  // C-002: true negative — a benign account with real, ordinary transaction
  // volume and zero laundering-flagged transactions.
  const c002 = pickDistinct(benign, used, (s) => s.txnCount >= 10 && s.txnCount <= 60);
  cases.push(
    toMinedCase(
      "C-002",
      "true-negative",
      `Real account with ${c002.txnCount} transactions and zero laundering-flagged activity — ` +
        `ordinary volume, no structural red flags.`,
      c002,
    ),
  );

  // C-008: near-miss — benign (unlabelled) account with a structural shape similar
  // to C-001 (comparable combined degree and some cash use), to test that the
  // typology agent doesn't narrate every busy account as suspicious.
  // Bounded to a comparable scale to C-001 (not a mega-hub/exchange-like account) —
  // a 20,000-transaction "case" would be unreadable in an investigator workbench.
  const c008 = pickDistinct(
    benign,
    used,
    (s) => s.inDegree >= 2 && s.outDegree >= 2 && s.txnCount >= 10 && s.txnCount <= 200,
  );
  cases.push(
    toMinedCase(
      "C-008",
      "near-miss",
      `Real account with in-degree ${c008.inDegree} and out-degree ${c008.outDegree} — ` +
        `structurally similar to C-001's shape, but unlabelled; tests counter-hypothesis quality ` +
        `and false-positive discipline.`,
      c008,
    ),
  );

  // C-005: sanctions — any ordinary benign account; its overlay KYC profile gets a
  // name that fuzzy-matches a real OFAC SDN entry (the SDN list itself is real,
  // only the name attached to this account is fabricated — see domain/customer.ts).
  const c005 = pickDistinct(benign, used, (s) => s.txnCount >= 4 && s.txnCount <= 30);
  cases.push(
    toMinedCase(
      "C-005",
      "sanctions-name-match",
      `Ordinary account whose overlay-assigned account holder name is set to fuzzy-match a real ` +
        `OFAC SDN entry; must route to ESCALATED_SANCTIONS and never reach the AML typology path.`,
      c005,
    ),
  );

  // C-006: injection — a low-activity benign account; its overlay notes/memos will
  // contain the prompt-injection payloads used by tests/injection.test.ts.
  const c006raw = await lowActivityBenignAccount({ useSlice: false });
  if (used.has(c006raw.accountId)) {
    throw new Error(`C-006 account ${c006raw.accountId} collided with an already-used account`);
  }
  used.add(c006raw.accountId);
  cases.push(
    toMinedCase(
      "C-006",
      "injection-surface",
      `Low-activity benign account (${c006raw.txnCount} transactions); its overlay analyst ` +
        `notes/wire memos carry the injection-test payload corpus.`,
      c006raw,
    ),
  );

  await mkdir(DATA_OVERLAY_DIR, { recursive: true });
  const outPath = `${DATA_OVERLAY_DIR}/cases.json`;
  await writeFile(outPath, JSON.stringify(cases, null, 2), "utf8");

  console.log(`\nWrote ${cases.length} mined cases to ${outPath}:`);
  for (const c of cases) {
    console.log(`  ${c.caseId}  ${c.accountId}  ${c.classification}  (isLaundering=${c.isLaundering})`);
  }
}

if (import.meta.main) {
  await main();
}
