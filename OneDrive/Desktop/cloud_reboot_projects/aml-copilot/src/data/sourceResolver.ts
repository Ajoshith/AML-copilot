import { query } from "./duckdb.ts";
import { initDb } from "./loaders.ts";
import { toTransaction, type TransactionRow } from "../analytics/timeline.ts";
import { getKycRecord, getAlertsForAccount, getNotesForAccount } from "./overlayStore.ts";
import { clauseIndex } from "../policy/typologiesSchema.ts";
import type { Transaction } from "../domain/transaction.ts";
import type { CustomerRecord } from "../domain/customer.ts";
import type { Alert } from "../domain/alert.ts";
import type { Note } from "../domain/note.ts";
import type { TypologyClause } from "../policy/typologiesSchema.ts";
import type { CaseRecord } from "../store/caseStore.ts";

/**
 * Turns a source_id shown in the UI into the real record it names — this is
 * what makes "every material fact has a source pointer" (definition-of-done
 * #1) into something an analyst can actually check, not just trust. See the
 * blueprint's §6 Experience row: "preserve raw transactions and source links."
 *
 * The `policy:` layer is a client-side convention only: no ffiecClauseId is
 * ever stored with that prefix (see domain/ids.ts's comment vs. actual usage
 * — nothing in this codebase constructs a "policy:"-prefixed string today).
 * The UI prepends it when a typology match is clicked so every drill-through
 * request has one uniform shape; this resolver strips it back off before
 * looking the bare clause id up in the real FFIEC corpus.
 */
export type ResolvedSource =
  | { layer: "txn"; transaction: Transaction }
  | { layer: "sdn"; entNum: string; sdnName: string; program: string }
  | { layer: "kyc"; record: CustomerRecord }
  | { layer: "alert"; record: Alert }
  | { layer: "note"; record: Note }
  | { layer: "policy"; clause: TypologyClause };

/** The last colon-separated segment is the lookup key for every layer that
 * uses one (txn row id, sdn entity number) — see domain/ids.ts's SourceId
 * regex, which allows colons inside the trailing "key" segment, so a naive
 * split(":")[2] would be wrong for "txn:ibm:HI-Small:4517". kyc/alert/note
 * source ids also end in a version suffix ("...:v1") rather than the account
 * id, which is why those three layers are resolved by exact sourceId match
 * against that account's own records instead of parsing the id at all. */
function lastSegment(sourceId: string): string {
  const parts = sourceId.split(":");
  return parts[parts.length - 1]!;
}

export async function resolveSource(
  sourceId: string,
  opts: { accountId: string; useSlice?: boolean },
): Promise<ResolvedSource | null> {
  const useSlice = opts.useSlice ?? true;

  if (sourceId.startsWith("policy:")) {
    const clauseId = sourceId.slice("policy:".length);
    const clause = (await clauseIndex()).get(clauseId);
    return clause ? { layer: "policy", clause } : null;
  }

  if (sourceId.startsWith("txn:")) {
    const rowId = Number(lastSegment(sourceId));
    if (!Number.isFinite(rowId)) return null;
    await initDb({ useSlice });
    const rows = await query<TransactionRow>(
      `SELECT row_id, ts, from_bank, from_account, to_bank, to_account,
              amount_received, receiving_currency, amount_paid, payment_currency,
              payment_format, is_laundering
       FROM transactions_raw WHERE row_id = ?`,
      [rowId],
    );
    return rows[0] ? { layer: "txn", transaction: toTransaction(rows[0]) } : null;
  }

  if (sourceId.startsWith("sdn:")) {
    const entNum = lastSegment(sourceId);
    await initDb({ useSlice });
    const rows = await query<{ ent_num: string; sdn_name: string; program: string }>(
      `SELECT ent_num, sdn_name, program FROM sdn_entries WHERE ent_num = ?`,
      [entNum],
    );
    const row = rows[0];
    return row ? { layer: "sdn", entNum: row.ent_num, sdnName: row.sdn_name, program: row.program } : null;
  }

  if (sourceId.startsWith("kyc:")) {
    const record = await getKycRecord(opts.accountId);
    return record && record.sourceId === sourceId ? { layer: "kyc", record } : null;
  }

  if (sourceId.startsWith("alert:")) {
    const record = (await getAlertsForAccount(opts.accountId)).find((a) => a.sourceId === sourceId);
    return record ? { layer: "alert", record } : null;
  }

  if (sourceId.startsWith("note:")) {
    const record = (await getNotesForAccount(opts.accountId)).find((n) => n.sourceId === sourceId);
    return record ? { layer: "note", record } : null;
  }

  return null;
}

/**
 * Every source_id this case can legitimately point at — used to gate
 * drill-through so it can only ever reveal what this case's own packet
 * already cites plus this case's own account records, never an arbitrary
 * row from the 5M-row dataset. This is the actual access control; resolution
 * above has no scoping of its own.
 */
export async function collectCitedSourceIds(record: CaseRecord): Promise<Set<string>> {
  const ids = new Set<string>();

  for (const point of record.evidence?.points ?? []) {
    for (const s of point.sourceIds) ids.add(s);
  }
  for (const match of record.typologyAssessment?.matches ?? []) {
    ids.add(`policy:${match.ffiecClauseId}`);
    for (const s of match.supportingSourceIds) ids.add(s);
  }
  for (const c of record.computations) {
    for (const s of c.sourceIds) ids.add(s);
  }
  for (const finding of record.casePacket?.findings ?? []) {
    for (const s of finding.sourceIds) ids.add(s);
  }
  if (record.sanctionsResult?.sourceId) ids.add(record.sanctionsResult.sourceId);

  if (record.accountId) {
    const kyc = await getKycRecord(record.accountId);
    if (kyc) ids.add(kyc.sourceId);
    for (const a of await getAlertsForAccount(record.accountId)) ids.add(a.sourceId);
    for (const n of await getNotesForAccount(record.accountId)) ids.add(n.sourceId);
  }

  return ids;
}
