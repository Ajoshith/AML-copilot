import { query } from "../data/duckdb.ts";
import { initDb, sourceIdForRow } from "../data/loaders.ts";
import { computation } from "./shared.ts";
import type { Computation } from "../domain/computation.ts";
import type { SourceId } from "../domain/ids.ts";

interface DegreeRow {
  distinct_senders_to_me: bigint;
  distinct_receivers_from_me: bigint;
}

interface MutualPairRow {
  counterparty: string;
  out_row_ids: bigint[];
  in_row_ids: bigint[];
}

/**
 * Counterparty structure around one account: how many distinct parties send to it
 * (in-degree), how many it sends to (out-degree), and any direct two-party round
 * trips (A pays B, B pays A back) — a real, checkable signal, not a judgment call.
 * Multi-hop cycle detection across the full 5M-row graph is out of scope for this
 * prototype; this looks only at the account's own direct counterparties.
 */
export async function computeGraph(
  accountId: string,
  opts: { useSlice?: boolean } = {},
): Promise<Computation[]> {
  await initDb(opts);

  const [degree] = await query<DegreeRow>(
    `
    SELECT
      count(DISTINCT from_account) FILTER (WHERE to_account = ? AND from_account != ?)   AS distinct_senders_to_me,
      count(DISTINCT to_account) FILTER (WHERE from_account = ? AND to_account != ?)     AS distinct_receivers_from_me
    FROM transactions_raw
    WHERE from_account = ? OR to_account = ?
    `,
    [accountId, accountId, accountId, accountId, accountId, accountId],
  );

  const incomingRows = await query<{ row_id: bigint }>(
    `SELECT row_id FROM transactions_raw WHERE to_account = ? AND from_account != ? ORDER BY row_id`,
    [accountId, accountId],
  );
  const outgoingRows = await query<{ row_id: bigint }>(
    `SELECT row_id FROM transactions_raw WHERE from_account = ? AND to_account != ? ORDER BY row_id`,
    [accountId, accountId],
  );
  const incomingSourceIds = incomingRows.map((r) => sourceIdForRow(r.row_id) as SourceId);
  const outgoingSourceIds = outgoingRows.map((r) => sourceIdForRow(r.row_id) as SourceId);

  const mutualPairs = await query<MutualPairRow>(
    `
    WITH outgoing AS (
      SELECT to_account AS counterparty, list(row_id ORDER BY row_id) AS row_ids
      FROM transactions_raw
      WHERE from_account = ? AND to_account != ?
      GROUP BY to_account
    ),
    incoming AS (
      SELECT from_account AS counterparty, list(row_id ORDER BY row_id) AS row_ids
      FROM transactions_raw
      WHERE to_account = ? AND from_account != ?
      GROUP BY from_account
    )
    SELECT
      o.counterparty        AS counterparty,
      o.row_ids             AS out_row_ids,
      i.row_ids             AS in_row_ids
    FROM outgoing o
    JOIN incoming i USING (counterparty)
    ORDER BY o.counterparty
    `,
    [accountId, accountId, accountId, accountId],
  );

  const inputs = { accountId };
  const roundTripSourceIds: SourceId[] = mutualPairs.flatMap((p) => [
    ...p.out_row_ids.map((id) => sourceIdForRow(id) as SourceId),
    ...p.in_row_ids.map((id) => sourceIdForRow(id) as SourceId),
  ]);

  return [
    computation("inDegree", Number(degree!.distinct_senders_to_me), incomingSourceIds, inputs),
    computation("outDegree", Number(degree!.distinct_receivers_from_me), outgoingSourceIds, inputs),
    computation("mutualCounterpartyCount", mutualPairs.length, roundTripSourceIds, inputs),
  ];
}
