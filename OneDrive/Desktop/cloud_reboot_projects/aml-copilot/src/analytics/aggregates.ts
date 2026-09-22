import { query } from "../data/duckdb.ts";
import { initDb, sourceIdForRow } from "../data/loaders.ts";
import { computation } from "./shared.ts";
import type { Computation } from "../domain/computation.ts";
import type { SourceId } from "../domain/ids.ts";

interface AggregateRow {
  txn_count: bigint;
  total_received: number;
  total_paid: number;
  cash_count: bigint;
  first_ts: Date;
  last_ts: Date;
}

interface FormatBreakdownRow {
  payment_format: string;
  n: bigint;
  total: number;
}

/**
 * Deterministic totals/counts/breakdowns for an account, each wrapped as a
 * Computation the verifier can independently recompute and compare against.
 */
export async function computeAggregates(
  accountId: string,
  opts: { useSlice?: boolean } = {},
): Promise<Computation[]> {
  await initDb(opts);

  const rowIds = await query<{ row_id: bigint }>(
    `SELECT row_id FROM transactions_raw WHERE from_account = ? OR to_account = ? ORDER BY row_id`,
    [accountId, accountId],
  );
  const sourceIds: SourceId[] = rowIds.map((r) => sourceIdForRow(r.row_id) as SourceId);

  const [agg] = await query<AggregateRow>(
    `
    SELECT
      count(*)                                         AS txn_count,
      coalesce(sum(amount_received), 0)                AS total_received,
      coalesce(sum(amount_paid), 0)                     AS total_paid,
      count(*) FILTER (WHERE payment_format = 'Cash')   AS cash_count,
      min(ts)                                           AS first_ts,
      max(ts)                                           AS last_ts
    FROM transactions_raw
    WHERE from_account = ? OR to_account = ?
    `,
    [accountId, accountId],
  );

  const formatRows = await query<FormatBreakdownRow>(
    `
    SELECT payment_format, count(*) AS n, coalesce(sum(amount_paid), 0) AS total
    FROM transactions_raw
    WHERE from_account = ? OR to_account = ?
    GROUP BY payment_format
    ORDER BY n DESC, payment_format ASC
    `,
    [accountId, accountId],
  );

  const inputs = { accountId };
  const results: Computation[] = [
    computation("txnCount", Number(agg!.txn_count), sourceIds, inputs),
    computation("totalReceived", agg!.total_received, sourceIds, inputs),
    computation("totalPaid", agg!.total_paid, sourceIds, inputs),
    computation("cashTxnCount", Number(agg!.cash_count), sourceIds, inputs),
  ];

  for (const row of formatRows) {
    results.push(
      computation(`formatBreakdown:${row.payment_format}:count`, Number(row.n), sourceIds, inputs),
      computation(`formatBreakdown:${row.payment_format}:total`, row.total, sourceIds, inputs),
    );
  }

  return results;
}
