import { query } from "../data/duckdb.ts";
import { initDb, sourceIdForRow } from "../data/loaders.ts";
import { computation } from "./shared.ts";
import type { Computation } from "../domain/computation.ts";
import type { SourceId } from "../domain/ids.ts";

/** The CTR reporting threshold this prototype checks near-threshold clustering
 * against. $10,000 is the real BSA currency transaction report threshold. */
const CTR_THRESHOLD = 10_000;
const NEAR_THRESHOLD_BAND = 0.15; // flags cash transactions in [8500, 10000)

interface NearThresholdRow {
  row_id: bigint;
  amount_paid: number;
  ts: Date;
}

interface VelocityRow {
  txn_count: bigint;
  active_days: bigint;
}

interface FlowRow {
  total_in: number;
  total_out: number;
}

/**
 * Structuring, velocity and pass-through signals — all exact math over the real
 * transaction rows, each Computation carrying the row-level source_ids it was
 * computed from so the verifier can re-run the identical query and compare.
 */
export async function detectPatterns(
  accountId: string,
  opts: { useSlice?: boolean } = {},
): Promise<Computation[]> {
  await initDb(opts);
  const inputs = { accountId, ctrThreshold: CTR_THRESHOLD, band: NEAR_THRESHOLD_BAND };

  const nearThresholdRows = await query<NearThresholdRow>(
    `
    SELECT row_id, amount_paid, ts
    FROM transactions_raw
    WHERE from_account = ?
      AND payment_format = 'Cash'
      AND amount_paid >= ? AND amount_paid < ?
    ORDER BY ts, row_id
    `,
    [accountId, CTR_THRESHOLD * (1 - NEAR_THRESHOLD_BAND), CTR_THRESHOLD],
  );
  const nearThresholdSourceIds = nearThresholdRows.map((r) => sourceIdForRow(r.row_id) as SourceId);

  const [velocity] = await query<VelocityRow>(
    `
    SELECT
      count(*)                                              AS txn_count,
      greatest(date_diff('day', min(ts), max(ts)), 1)        AS active_days
    FROM transactions_raw
    WHERE from_account = ? OR to_account = ?
    `,
    [accountId, accountId],
  );

  const [flow] = await query<FlowRow>(
    `
    SELECT
      coalesce(sum(amount_received) FILTER (WHERE to_account = ?), 0)   AS total_in,
      coalesce(sum(amount_paid) FILTER (WHERE from_account = ?), 0)     AS total_out
    FROM transactions_raw
    WHERE from_account = ? OR to_account = ?
    `,
    [accountId, accountId, accountId, accountId],
  );

  const txnCount = Number(velocity!.txn_count);
  const activeDays = Number(velocity!.active_days);
  const totalIn = flow!.total_in;
  const totalOut = flow!.total_out;
  // Pass-through ratio close to 1 means money moves out roughly as fast as it comes
  // in — a funnel/pass-through signature — rather than accumulating as a balance.
  const passThroughRatio = totalIn > 0 ? Math.min(totalOut / totalIn, 1) : 0;

  return [
    computation(
      "nearThresholdCashCount",
      nearThresholdRows.length,
      nearThresholdSourceIds,
      inputs,
    ),
    computation(
      "nearThresholdCashTotal",
      nearThresholdRows.reduce((sum, r) => sum + r.amount_paid, 0),
      nearThresholdSourceIds,
      inputs,
    ),
    computation("velocityTxnPerDay", txnCount / activeDays, [], inputs),
    computation("totalIn", totalIn, [], inputs),
    computation("totalOut", totalOut, [], inputs),
    computation("passThroughRatio", Number(passThroughRatio.toFixed(4)), [], inputs),
  ];
}
