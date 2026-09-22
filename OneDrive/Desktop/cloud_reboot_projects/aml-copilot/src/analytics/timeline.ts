import { query } from "../data/duckdb.ts";
import { initDb, sourceIdForRow } from "../data/loaders.ts";
import { TransactionSchema, type Transaction } from "../domain/transaction.ts";
import type { PaymentFormat } from "../domain/transaction.ts";

export interface TransactionRow {
  row_id: bigint;
  ts: Date;
  from_bank: string;
  from_account: string;
  to_bank: string;
  to_account: string;
  amount_received: number;
  receiving_currency: string;
  amount_paid: number;
  payment_currency: string;
  payment_format: string;
  is_laundering: boolean;
}

export function toTransaction(row: TransactionRow): Transaction {
  return TransactionSchema.parse({
    sourceId: sourceIdForRow(row.row_id),
    timestamp: row.ts.toISOString(),
    fromBank: row.from_bank,
    fromAccount: row.from_account,
    toBank: row.to_bank,
    toAccount: row.to_account,
    amountReceived: row.amount_received,
    receivingCurrency: row.receiving_currency,
    amountPaid: row.amount_paid,
    paymentCurrency: row.payment_currency,
    paymentFormat: row.payment_format as PaymentFormat,
    isLaundering: row.is_laundering,
  });
}

/**
 * Every transaction touching `accountId`, in chronological order, as either sender or
 * receiver. This is the raw material the Evidence agent narrates — it never sees
 * anything this query didn't already establish, and every row carries the source_id
 * the verifier uses to re-check the agent's claims.
 */
export async function getAccountTimeline(
  accountId: string,
  opts: { useSlice?: boolean } = {},
): Promise<Transaction[]> {
  await initDb(opts);
  const rows = await query<TransactionRow>(
    `
    SELECT row_id, ts, from_bank, from_account, to_bank, to_account,
           amount_received, receiving_currency, amount_paid, payment_currency,
           payment_format, is_laundering
    FROM transactions_raw
    WHERE from_account = ? OR to_account = ?
    ORDER BY ts ASC, row_id ASC
    `,
    [accountId, accountId],
  );
  return rows.map(toTransaction);
}
