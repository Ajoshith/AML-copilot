import { query } from "../data/duckdb.ts";
import { initDb, sourceIdForRow } from "../data/loaders.ts";
import { computation } from "./shared.ts";
import { roundMoney, toUsd } from "./fx.ts";
import type { Computation } from "../domain/computation.ts";
import type { SourceId } from "../domain/ids.ts";

export interface FlowRow {
  row_id: bigint;
  ts: Date;
  from_account: string;
  to_account: string;
  amount_paid: number;
  payment_currency: string;
  amount_received: number;
  receiving_currency: string;
  payment_format: string;
}

export type Direction = "in" | "out" | "self";

/** Which way a row moves money for `accountId`. A self-transfer (the account paying
 * itself, often a currency conversion) is neither inflow nor outflow. */
export function directionOf(row: Pick<FlowRow, "from_account" | "to_account">, accountId: string): Direction {
  if (row.from_account === accountId && row.to_account === accountId) return "self";
  return row.to_account === accountId ? "in" : "out";
}

/** An inflow is valued by what this account received, an outflow by what it paid. */
export function usdValueOf(row: FlowRow, direction: Direction): number {
  return direction === "in" ? toUsd(row.amount_received, row.receiving_currency) : toUsd(row.amount_paid, row.payment_currency);
}

export async function accountRows(accountId: string): Promise<FlowRow[]> {
  return query<FlowRow>(
    `
    SELECT row_id, ts, from_account, to_account, amount_paid, payment_currency,
           amount_received, receiving_currency, payment_format
    FROM transactions_raw
    WHERE from_account = ? OR to_account = ?
    ORDER BY ts, row_id
    `,
    [accountId, accountId],
  );
}

/**
 * Money in and money out for one account, kept apart by direction and by currency.
 * Totals across currencies exist only as US-dollar equivalents (names ending "Usd").
 * An earlier version summed amount_received over every row touching the account
 * (counting what counterparties received as this account's income) and added seven
 * currencies together as if they were dollars.
 */
export async function computeAggregates(accountId: string, opts: { useSlice?: boolean } = {}): Promise<Computation[]> {
  await initDb(opts);
  const rows = await accountRows(accountId);
  const inputs = { accountId };
  const ids = (rs: FlowRow[]) => rs.map((r) => sourceIdForRow(r.row_id) as SourceId);

  const inflows = rows.filter((r) => directionOf(r, accountId) === "in");
  const outflows = rows.filter((r) => directionOf(r, accountId) === "out");
  const selfTransfers = rows.filter((r) => directionOf(r, accountId) === "self");
  const selfFx = selfTransfers.filter((r) => r.payment_currency !== r.receiving_currency);

  const results: Computation[] = [
    computation("txnCount", rows.length, ids(rows), inputs),
    computation("inflowCount", inflows.length, ids(inflows), inputs),
    computation("outflowCount", outflows.length, ids(outflows), inputs),
    computation("selfTransferCount", selfTransfers.length, ids(selfTransfers), inputs),
    computation("selfFxConversionCount", selfFx.length, ids(selfFx), inputs),
    computation("totalInUsd", roundMoney(inflows.reduce((s, r) => s + usdValueOf(r, "in"), 0)), ids(inflows), inputs),
    computation("totalOutUsd", roundMoney(outflows.reduce((s, r) => s + usdValueOf(r, "out"), 0)), ids(outflows), inputs),
    computation("cashTxnCount", rows.filter((r) => r.payment_format === "Cash").length, ids(rows.filter((r) => r.payment_format === "Cash")), inputs),
  ];

  const currencies = new Set(rows.flatMap((r) => [r.payment_currency, r.receiving_currency]));
  results.push(computation("currencyCount", currencies.size, ids(rows), inputs));

  // Native totals per currency, one computation each, never summed across currencies.
  const byCurrency = (rs: FlowRow[], pick: (r: FlowRow) => [string, number]) => {
    const m = new Map<string, { total: number; rows: FlowRow[] }>();
    for (const r of rs) {
      const [ccy, amount] = pick(r);
      const e = m.get(ccy) ?? { total: 0, rows: [] };
      e.total += amount;
      e.rows.push(r);
      m.set(ccy, e);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  for (const [ccy, e] of byCurrency(inflows, (r) => [r.receiving_currency, r.amount_received])) {
    results.push(computation(`inflow:${ccy}`, roundMoney(e.total), ids(e.rows), inputs));
  }
  for (const [ccy, e] of byCurrency(outflows, (r) => [r.payment_currency, r.amount_paid])) {
    results.push(computation(`outflow:${ccy}`, roundMoney(e.total), ids(e.rows), inputs));
  }

  // Channel mix over every row touching the account, valued in USD equivalent.
  const byFormat = new Map<string, FlowRow[]>();
  for (const r of rows) byFormat.set(r.payment_format, [...(byFormat.get(r.payment_format) ?? []), r]);
  for (const [fmt, rs] of [...byFormat.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    results.push(
      computation(`formatBreakdown:${fmt}:count`, rs.length, ids(rs), inputs),
      computation(
        `formatBreakdown:${fmt}:totalUsd`,
        roundMoney(rs.reduce((s, r) => s + toUsd(r.amount_paid, r.payment_currency), 0)),
        ids(rs),
        inputs,
      ),
    );
  }
  return results;
}
