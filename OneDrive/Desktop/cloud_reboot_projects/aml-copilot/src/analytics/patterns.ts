import { initDb, sourceIdForRow } from "../data/loaders.ts";
import { computation } from "./shared.ts";
import { accountRows, directionOf, usdValueOf, type FlowRow } from "./aggregates.ts";
import { roundMoney, toUsd } from "./fx.ts";
import type { Computation } from "../domain/computation.ts";
import type { SourceId } from "../domain/ids.ts";

/** US currency transaction reports are required at $10,000; structuring sits just below. */
export const CTR_THRESHOLD_USD = 10_000;
export const NEAR_THRESHOLD_BAND = 0.15; // cash transactions worth $8,500 to just under $10,000

export function isNearThresholdCash(row: FlowRow, accountId: string): boolean {
  if (row.payment_format !== "Cash") return false;
  const dir = directionOf(row, accountId);
  if (dir === "self") return false;
  const usd = usdValueOf(row, dir);
  return usd >= CTR_THRESHOLD_USD * (1 - NEAR_THRESHOLD_BAND) && usd < CTR_THRESHOLD_USD;
}

export async function detectPatterns(accountId: string, opts: { useSlice?: boolean } = {}): Promise<Computation[]> {
  await initDb(opts);
  const rows = await accountRows(accountId);
  const inputs = { accountId, ctrThresholdUsd: CTR_THRESHOLD_USD, band: NEAR_THRESHOLD_BAND };
  const ids = (rs: FlowRow[]) => rs.map((r) => sourceIdForRow(r.row_id) as SourceId);

  const nearThreshold = rows.filter((r) => isNearThresholdCash(r, accountId));
  const days = rows.length > 1 ? Math.max(1, Math.floor((+rows.at(-1)!.ts - +rows[0]!.ts) / 86_400_000)) : 1;

  const inflows = rows.filter((r) => directionOf(r, accountId) === "in");
  const outflows = rows.filter((r) => directionOf(r, accountId) === "out");
  const inUsd = inflows.reduce((s, r) => s + usdValueOf(r, "in"), 0);
  const outUsd = outflows.reduce((s, r) => s + usdValueOf(r, "out"), 0);

  const results: Computation[] = [
    computation("nearThresholdCashCount", nearThreshold.length, ids(nearThreshold), inputs),
    computation(
      "nearThresholdCashTotalUsd",
      roundMoney(nearThreshold.reduce((s, r) => s + toUsd(r.amount_paid, r.payment_currency), 0)),
      ids(nearThreshold),
      inputs,
    ),
    computation("velocityTxnPerDay", Number((rows.length / days).toFixed(4)), [], inputs),
  ];
  // Money out divided by money in, both in USD equivalent and NOT capped. Near 1 means
  // funds pass straight through; far above 1 means more left than arrived from other
  // accounts in this window, so the source of the outgoing funds is not visible here.
  // Omitted when nothing came in, rather than reported as a misleading 0 or infinity.
  if (inUsd > 0) {
    results.push(computation("outflowToInflowRatio", Number((outUsd / inUsd).toFixed(4)), [...ids(inflows), ...ids(outflows)], inputs));
  }
  return results;
}
