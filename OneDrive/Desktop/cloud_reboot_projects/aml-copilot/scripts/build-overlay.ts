/**
 * Generates the overlay (fabricated KYC and notes, rule-raised alerts) for the 8
 * cases mined by select-cases.ts, and writes a committed Parquet slice of the real
 * transactions touching those 8 accounts so `bun test` never needs the 475 MB CSV.
 *
 * KYC and note records are source-labelled "kyc:overlay:..." / "note:overlay:..." so the UI
 * and tests can always tell generated facts from real ones (txn:/sdn:/policy:). Alerts are
 * not invented here: they are raised by the rules in src/analytics/alertRules.ts over the
 * real transactions, and labelled "alert:tm:...".
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
import { riskRatingFor } from "../src/data/riskRating.ts";
import { accountRows, directionOf, usdValueOf } from "../src/analytics/aggregates.ts";
import { evaluateAlertRules } from "../src/analytics/alertRules.ts";
import type { MinedCase } from "./select-cases.ts";
import { MinedCaseSchema } from "./select-cases.ts";

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

/** The stated expected monthly volume, derived from the account's own observed inflows:
 * money received from OTHER accounts, in US-dollar equivalent, scaled to 30 days. An
 * earlier version counted self-transfers and summed seven currencies as if they were
 * dollars, which is where C-001's absurd $528M/month came from. */
export async function expectedMonthlyVolumeUsd(accountId: string): Promise<number> {
  const rows = await accountRows(accountId);
  const inUsd = rows.filter((r) => directionOf(r, accountId) === "in").reduce((sum, r) => sum + usdValueOf(r, "in"), 0);
  const days = rows.length > 1 ? Math.max(1, Math.floor((+rows.at(-1)!.ts - +rows[0]!.ts) / 86_400_000)) : 1;
  return Math.round((inUsd / days) * 30 * 100) / 100;
}

/** Raises every account's alerts by running the monitoring rules; numbered A-1001.. in order. */
export async function buildAlerts(kycRecords: CustomerRecord[], opts: { useSlice?: boolean } = {}): Promise<Alert[]> {
  const alerts: Alert[] = [];
  for (const kyc of kycRecords) {
    for (const a of await evaluateAlertRules(kyc.accountId, kyc, opts)) {
      alerts.push(AlertSchema.parse({ ...a, alertId: `A-${1001 + alerts.length}` }));
    }
  }
  return alerts;
}

/** Before the September 2022 transactions, so the profile is about 2.5 years stale as
 * of the alerts. (It used to be 2024-03-15, which postdates every transaction.) */
export const LAST_REVIEW_DATE = "2020-03-15";

export function buildKyc(c: MinedCase, accountHolderName: string, expectedMonthlyVolume: number | null): CustomerRecord {
  const isStale = c.caseId === "C-004";
  const occupation = isStale ? null : deterministicPick(OCCUPATIONS, c.accountId);
  const businessType = isStale ? null : deterministicPick(["Sole proprietorship", "LLC", "Individual"], c.accountId + "b");
  return CustomerRecordSchema.parse({
    sourceId: `kyc:overlay:${c.accountId}:v1`,
    accountId: c.accountId,
    accountHolderName,
    occupation,
    businessType,
    statedExpectedMonthlyVolume: isStale ? null : expectedMonthlyVolume,
    riskRating: riskRatingFor({ occupation, businessType }),
    lastReviewDate: isStale ? null : LAST_REVIEW_DATE,
    jurisdiction: "US",
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

  for (const c of cases) {
    const accountHolderName = c.caseId === "C-005" ? sdnName : await pickNonSanctionedName(c.accountId);
    kycRecords.push(buildKyc(c, accountHolderName, await expectedMonthlyVolumeUsd(c.accountId)));
    notes.push(...buildNotes(c));
  }
  alerts.push(...(await buildAlerts(kycRecords)));

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
