import { query } from "./duckdb.ts";
import { initDb } from "./loaders.ts";

/**
 * Structural signals for one candidate account, computed over its transactions.
 * `isLaundering` is the real ground-truth flag: true if ANY transaction touching
 * this account carries the IBM dataset's own `Is Laundering = 1` label.
 */
export interface AccountShape {
  accountId: string;
  /** Transactions matching the laundering-label filter this shape was queried under. */
  txnCount: number;
  inDegree: number;
  outDegree: number;
  cashCount: number;
  distinctCurrencies: number;
  isLaundering: boolean;
  /** The account's TOTAL transaction count across the whole dataset, laundering-
   * flagged or not. A candidate can look small within its laundering-flagged
   * subset while actually being a mega-hub/exchange-like account overall — this
   * is what select-cases.ts bounds to keep a "case" narratable and the committed
   * slice small. */
  totalTxnCount: number;
}

async function shapeQuery(
  whereIsLaundering: boolean,
  limit: number,
  opts: { useSlice?: boolean },
): Promise<AccountShape[]> {
  await initDb(opts);
  const rows = await query<{
    account_id: string;
    txn_count: bigint;
    in_degree: bigint;
    out_degree: bigint;
    cash_count: bigint;
    n_currencies: bigint;
    total_txn_count: bigint;
  }>(
    `
    WITH touching AS (
      SELECT from_account AS account_id, to_account AS counterparty, 'out' AS direction,
             payment_format, payment_currency
      FROM transactions_raw WHERE is_laundering = ?
      UNION ALL
      SELECT to_account AS account_id, from_account AS counterparty, 'in' AS direction,
             payment_format, payment_currency
      FROM transactions_raw WHERE is_laundering = ?
    ),
    candidates AS (
      SELECT
        account_id,
        count(*)                                                    AS txn_count,
        count(DISTINCT counterparty) FILTER (WHERE direction='in')  AS in_degree,
        count(DISTINCT counterparty) FILTER (WHERE direction='out') AS out_degree,
        count(*) FILTER (WHERE payment_format = 'Cash')             AS cash_count,
        count(DISTINCT payment_currency)                            AS n_currencies
      FROM touching
      GROUP BY account_id
      ORDER BY (count(DISTINCT counterparty) FILTER (WHERE direction='in')
              + count(DISTINCT counterparty) FILTER (WHERE direction='out')) DESC
      LIMIT ${limit}
    ),
    totals AS (
      SELECT account_id, count(*) AS total_txn_count
      FROM (
        SELECT from_account AS account_id FROM transactions_raw
        UNION ALL
        SELECT to_account AS account_id FROM transactions_raw
      )
      WHERE account_id IN (SELECT account_id FROM candidates)
      GROUP BY account_id
    )
    SELECT c.*, t.total_txn_count
    FROM candidates c
    JOIN totals t USING (account_id)
    ORDER BY (c.in_degree + c.out_degree) DESC
    `,
    [whereIsLaundering, whereIsLaundering],
  );
  return rows.map((r) => ({
    accountId: r.account_id,
    txnCount: Number(r.txn_count),
    inDegree: Number(r.in_degree),
    outDegree: Number(r.out_degree),
    cashCount: Number(r.cash_count),
    distinctCurrencies: Number(r.n_currencies),
    isLaundering: whereIsLaundering,
    totalTxnCount: Number(r.total_txn_count),
  }));
}

/** Every laundering-labelled account by combined in+out degree — candidates for
 * gather-scatter / fan-out / cross-currency shapes. The labelled pool is only
 * ~5,177 transactions total, so no LIMIT is needed to see the whole thing. */
export function launderingShapes(opts: { useSlice?: boolean } = {}): Promise<AccountShape[]> {
  return shapeQuery(true, 1_000_000, opts);
}

/** The same structural ranking, but over accounts with NO laundering-flagged
 * transaction at all — used both for a true-negative case and a "near-miss"
 * case that looks structurally similar without the label. Capped: the benign
 * pool is the vast majority of the dataset. */
export function benignShapes(opts: { useSlice?: boolean } = {}): Promise<AccountShape[]> {
  return shapeQuery(false, 20_000, opts);
}

/** A low-activity benign account, for the lightweight injection-test case. Bounds
 * on the account's TOTAL transaction count (not just non-laundering ones), so this
 * never accidentally picks a mega-hub account that merely has few *flagged* rows. */
export async function lowActivityBenignAccount(opts: { useSlice?: boolean } = {}): Promise<AccountShape> {
  await initDb(opts);
  const rows = await query<{ account_id: string; txn_count: bigint }>(
    `
    WITH touching AS (
      SELECT from_account AS account_id, is_laundering FROM transactions_raw
      UNION ALL
      SELECT to_account AS account_id, is_laundering FROM transactions_raw
    )
    SELECT account_id, count(*) AS txn_count
    FROM touching
    GROUP BY account_id
    HAVING count(*) BETWEEN 3 AND 8
       AND sum(CASE WHEN is_laundering THEN 1 ELSE 0 END) = 0
    ORDER BY account_id
    LIMIT 1
    `,
  );
  const row = rows[0];
  if (!row) throw new Error("No low-activity benign account found");
  return {
    accountId: row.account_id,
    txnCount: Number(row.txn_count),
    inDegree: 0,
    outDegree: 0,
    cashCount: 0,
    distinctCurrencies: 1,
    isLaundering: false,
    totalTxnCount: Number(row.txn_count),
  };
}
