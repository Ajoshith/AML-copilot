/**
 * Generates the three fabricated overlay layers (KYC, alerts, notes) for the 8
 * cases mined by select-cases.ts, and writes a committed Parquet slice of the real
 * transactions touching those 8 accounts so `bun test` never needs the 475 MB CSV.
 *
 * Every overlay record is clearly source-labelled ("kyc:overlay:...", "alert:overlay:...",
 * "note:overlay:...") so the UI and tests can always distinguish generated facts from
 * real ones (txn:/sdn:/policy: prefixes) — see src/domain/ids.ts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { query, exec } from "../src/data/duckdb.ts";
import { initDb } from "../src/data/loaders.ts";
import { CustomerRecordSchema, type CustomerRecord } from "../src/domain/customer.ts";
import { AlertSchema, type Alert } from "../src/domain/alert.ts";
import { NoteSchema, type Note } from "../src/domain/note.ts";
import { INJECTION_PAYLOADS } from "../src/data/injectionCorpus.ts";
import { screenSanctions } from "../src/analytics/sanctionsMatch.ts";
import { DATA_OVERLAY_DIR, DATA_SLICE_DIR } from "../src/config.ts";
import type { MinedCase } from "./select-cases.ts";
import { MinedCaseSchema } from "./select-cases.ts";

const RULE_BY_CLASSIFICATION: Record<string, { ruleId: string; ruleVersion: string }> = {
  "gather-scatter-like": { ruleId: "near-threshold-cash-cluster", ruleVersion: "v3" },
  "fan-out-like": { ruleId: "high-velocity-fanout", ruleVersion: "v2" },
  "cross-currency-cycle-like": { ruleId: "cross-currency-layering", ruleVersion: "v1" },
  "true-negative": { ruleId: "periodic-review", ruleVersion: "v1" },
  "near-miss": { ruleId: "near-threshold-cash-cluster", ruleVersion: "v3" },
  "sanctions-name-match": { ruleId: "sanctions-name-screen", ruleVersion: "v4" },
  "injection-surface": { ruleId: "periodic-review", ruleVersion: "v1" },
};

const OCCUPATIONS = [
  "Independent contractor",
  "Restaurant owner",
  "Import/export consultant",
  "Freelance graphic designer",
  "Retail shop manager",
  "Real estate agent",
];

function deterministicPick<T>(arr: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length]!;
}

const FIRST_NAMES = ["Alex", "Jordan", "Morgan", "Taylor", "Casey"];
const LAST_NAMES = ["Rivera", "Chen", "Okafor", "Patel", "Novak"];

/**
 * Real name-screening lists produce false positives on short, common names —
 * this is a genuine, well-known sanctions-screening problem, not just a demo
 * artifact. Only case C-005 is SUPPOSED to hit the real OFAC list; every other
 * account's fabricated name must be re-picked (deterministically, with a salt)
 * until it clears screening, so the sanctions-escalation path only ever fires
 * for the one case designed to exercise it.
 */
async function pickNonSanctionedName(seedAccountId: string): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const salt = attempt === 0 ? "" : `:${attempt}`;
    const first = deterministicPick(FIRST_NAMES, seedAccountId + salt);
    const last = deterministicPick(LAST_NAMES, seedAccountId + "s" + salt);
    const candidate = `${first} ${last}`;
    const { result } = await screenSanctions(candidate, { useSlice: false });
    if (!result.matched) return candidate;
    console.log(`  name "${candidate}" for ${seedAccountId} collided with a real SDN entry — retrying (attempt ${attempt + 1})`);
  }
  throw new Error(`Could not find a non-sanctioned fabricated name for account ${seedAccountId} after 25 attempts`);
}

async function loadCases(): Promise<MinedCase[]> {
  const raw = await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8");
  return z.array(MinedCaseSchema).parse(JSON.parse(raw));
}

async function findSanctionsName(): Promise<{ sdnName: string; entNum: string }> {
  const rows = await query<{ ent_num: string; sdn_name: string }>(
    `
    SELECT ent_num, sdn_name FROM sdn_entries
    WHERE regexp_matches(upper(sdn_name), 'AIRLINES|CORP|LTD|BANK|TRADING|SHIPPING|HOLDINGS|COMPANY')
    ORDER BY ent_num
    LIMIT 1
    `,
  );
  const row = rows[0];
  if (!row) throw new Error("No suitable corporate-style SDN entry found for case C-005");
  return { sdnName: row.sdn_name, entNum: row.ent_num };
}

async function accountFinancials(accountId: string): Promise<{ totalReceived: number; days: number }> {
  const [row] = await query<{ total_received: number; days: number }>(
    `
    SELECT
      coalesce(sum(amount_received) FILTER (WHERE to_account = ?), 0)                     AS total_received,
      greatest(date_diff('day', min(ts), max(ts)), 1)                                     AS days
    FROM transactions_raw
    WHERE from_account = ? OR to_account = ?
    `,
    [accountId, accountId, accountId],
  );
  return { totalReceived: row!.total_received, days: Number(row!.days) };
}

function buildKyc(c: MinedCase, accountHolderName: string, expectedMonthlyVolume: number | null): CustomerRecord {
  const isStale = c.caseId === "C-004";
  return CustomerRecordSchema.parse({
    sourceId: `kyc:overlay:${c.accountId}:v1`,
    accountId: c.accountId,
    accountHolderName,
    occupation: isStale ? null : deterministicPick(OCCUPATIONS, c.accountId),
    businessType: isStale ? null : deterministicPick(["Sole proprietorship", "LLC", "Individual"], c.accountId + "b"),
    statedExpectedMonthlyVolume: isStale ? null : expectedMonthlyVolume,
    riskRating: c.isLaundering || c.classification === "sanctions-name-match" ? "high" : c.classification === "near-miss" ? "medium" : "low",
    lastReviewDate: isStale ? null : "2024-03-15",
    jurisdiction: "US",
  });
}

function buildAlert(c: MinedCase, index: number): Alert {
  const rule = RULE_BY_CLASSIFICATION[c.classification] ?? { ruleId: "periodic-review", ruleVersion: "v1" };
  const firedAt = new Date();
  const dueDate = new Date(firedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  return AlertSchema.parse({
    sourceId: `alert:overlay:${c.accountId}:v1`,
    alertId: `A-${1000 + index}`,
    accountId: c.accountId,
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    firedAt: firedAt.toISOString(),
    jurisdiction: "US",
    dueDate: dueDate.toISOString(),
    sarConfidentialitySensitive: true,
  });
}

function buildNotes(c: MinedCase): Note[] {
  if (c.caseId === "C-006") {
    return INJECTION_PAYLOADS.map((text, i) =>
      NoteSchema.parse({
        sourceId: `note:overlay:${c.accountId}:${i + 1}`,
        accountId: c.accountId,
        text,
      }),
    );
  }
  return [
    NoteSchema.parse({
      sourceId: `note:overlay:${c.accountId}:1`,
      accountId: c.accountId,
      text: `Account reviewed as part of routine TM alert follow-up. No customer contact yet on this alert.`,
    }),
  ];
}

async function writeSlice(accountIds: string[]) {
  await mkdir(DATA_SLICE_DIR, { recursive: true });
  const parquetPath = `${DATA_SLICE_DIR}/transactions.parquet`.replace(/\\/g, "/");
  const idList = accountIds.map((a) => `'${a.replace(/'/g, "''")}'`).join(", ");
  await exec(`
    COPY (
      SELECT row_id AS original_row_id,
             ts AS "Timestamp", from_bank AS "From Bank", from_account AS "Account",
             to_bank AS "To Bank", to_account AS "Account_1",
             amount_received AS "Amount Received", receiving_currency AS "Receiving Currency",
             amount_paid AS "Amount Paid", payment_currency AS "Payment Currency",
             payment_format AS "Payment Format",
             CASE WHEN is_laundering THEN 1 ELSE 0 END AS "Is Laundering"
      FROM transactions_raw
      WHERE from_account IN (${idList}) OR to_account IN (${idList})
      ORDER BY original_row_id
    ) TO '${parquetPath}' (FORMAT PARQUET)
  `);
  console.log(`Wrote committed slice to ${parquetPath}`);
}

async function main() {
  await initDb({ useSlice: false });
  const cases = await loadCases();
  const { sdnName } = await findSanctionsName();

  const kycRecords: CustomerRecord[] = [];
  const alerts: Alert[] = [];
  const notes: Note[] = [];

  let index = 0;
  for (const c of cases) {
    index += 1;
    const accountHolderName = c.caseId === "C-005" ? sdnName : await pickNonSanctionedName(c.accountId);

    const { totalReceived, days } = await accountFinancials(c.accountId);
    const expectedMonthlyVolume = Math.round((totalReceived / days) * 30 * 100) / 100;

    kycRecords.push(buildKyc(c, accountHolderName, expectedMonthlyVolume));
    alerts.push(buildAlert(c, index));
    notes.push(...buildNotes(c));
  }

  await mkdir(DATA_OVERLAY_DIR, { recursive: true });
  await writeFile(`${DATA_OVERLAY_DIR}/kyc.json`, JSON.stringify(kycRecords, null, 2), "utf8");
  await writeFile(`${DATA_OVERLAY_DIR}/alerts.json`, JSON.stringify(alerts, null, 2), "utf8");
  await writeFile(`${DATA_OVERLAY_DIR}/notes.json`, JSON.stringify(notes, null, 2), "utf8");
  console.log(`Wrote ${kycRecords.length} KYC records, ${alerts.length} alerts, ${notes.length} notes.`);

  await writeSlice(cases.map((c) => c.accountId));
}

if (import.meta.main) {
  await main();
}
