import { initDb, sourceIdForRow } from "../data/loaders.ts";
import { accountRows, directionOf, usdValueOf, type FlowRow } from "./aggregates.ts";
import { isNearThresholdCash } from "./patterns.ts";
import { screenSanctions } from "./sanctionsMatch.ts";
import type { Alert } from "../domain/alert.ts";
import type { CustomerRecord } from "../domain/customer.ts";
import type { SourceId } from "../domain/ids.ts";

/**
 * The transaction-monitoring rules that raise alerts. Each is a common AML monitoring
 * typology with an explicit, fixed threshold. The thresholds are illustrative prototype
 * values chosen from the typology, not tuned to the mined cases and not calibrated to a
 * real bank: a production system would set them from its own risk assessment and tune
 * them on alert outcomes. A case can raise several alerts, or only the periodic review.
 */
export const RULES = {
  structuringNearThresholdCash: { id: "structuring-near-threshold-cash", version: "v1", count: 3, windowDays: 7 },
  gatherScatter: { id: "gather-scatter", version: "v1", minInCounterparties: 10, minOutCounterparties: 10, windowDays: 30 },
  fanOut: { id: "fan-out", version: "v1", minOutCounterparties: 10, maxInCounterparties: 9, windowDays: 30 },
  fanInBurst: { id: "fan-in-burst", version: "v1", minSenders: 20, windowMinutes: 60 },
  fxConversionThenTransfer: { id: "fx-conversion-then-transfer", version: "v1", minOccurrences: 3, withinMinutes: 60 },
  outflowExceedsInflow: { id: "outflow-exceeds-inflow", version: "v1", ratio: 2, minOutUsd: 100_000 },
  sanctionsNameScreen: { id: "sanctions-name-screen", version: "v1" },
  kycReviewOverdue: { id: "kyc-review-overdue", version: "v1", maxAgeDays: 365 },
} as const;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

interface Firing {
  rule: { id: string; version: string };
  title: string;
  condition: string;
  observed: string;
  evidence: FlowRow[];
  /** When the condition was first met. */
  firedAt: Date;
}

/** Smallest window (by end time) in which `count` rows occur within `spanMs`. */
function firstDenseWindow(rows: FlowRow[], count: number, spanMs: number, key: (r: FlowRow) => string = (r) => String(r.row_id)) {
  for (let end = 0; end < rows.length; end++) {
    const window = rows.filter((r) => +r.ts <= +rows[end]!.ts && +rows[end]!.ts - +r.ts <= spanMs);
    if (new Set(window.map(key)).size >= count) return { window, endAt: rows[end]!.ts };
  }
  return null;
}

export async function evaluateAlertRules(
  accountId: string,
  kyc: CustomerRecord | null,
  opts: { useSlice?: boolean } = {},
): Promise<Omit<Alert, "alertId">[]> {
  await initDb(opts);
  const rows = await accountRows(accountId);
  const inflows = rows.filter((r) => directionOf(r, accountId) === "in");
  const outflows = rows.filter((r) => directionOf(r, accountId) === "out");
  const firings: Firing[] = [];

  {
    const R = RULES.structuringNearThresholdCash;
    const near = rows.filter((r) => isNearThresholdCash(r, accountId));
    const hit = firstDenseWindow(near, R.count, R.windowDays * DAY_MS);
    if (hit) {
      firings.push({
        rule: R,
        title: "Possible structuring: cash just under the reporting threshold",
        condition: `${R.count}+ cash transactions each worth $8,500 to $9,999 within ${R.windowDays} days`,
        observed: `${hit.window.length} such cash transactions within ${R.windowDays} days`,
        evidence: hit.window,
        firedAt: hit.endAt,
      });
    }
  }

  const inCp = new Set(inflows.map((r) => r.from_account));
  const outCp = new Set(outflows.map((r) => r.to_account));
  const spanDays = rows.length ? (+rows.at(-1)!.ts - +rows[0]!.ts) / DAY_MS : 0;
  const lastOf = (rs: FlowRow[]) => rs.reduce((t, r) => (+r.ts > +t ? r.ts : t), rs[0]!.ts);
  {
    const R = RULES.gatherScatter;
    if (spanDays <= R.windowDays && inCp.size >= R.minInCounterparties && outCp.size >= R.minOutCounterparties) {
      firings.push({
        rule: R,
        title: "Gather-scatter: funds collected from many accounts and sent to many",
        condition: `${R.minInCounterparties}+ distinct senders and ${R.minOutCounterparties}+ distinct recipients within ${R.windowDays} days`,
        observed: `${inCp.size} distinct senders and ${outCp.size} distinct recipients in ${Math.ceil(spanDays)} days`,
        evidence: [...inflows, ...outflows],
        firedAt: lastOf([...inflows, ...outflows]),
      });
    }
  }
  {
    const R = RULES.fanOut;
    if (spanDays <= R.windowDays && outCp.size >= R.minOutCounterparties && inCp.size <= R.maxInCounterparties) {
      firings.push({
        rule: R,
        title: "Fan-out: funds dispersed to many recipients",
        condition: `${R.minOutCounterparties}+ distinct recipients with at most ${R.maxInCounterparties} distinct senders, within ${R.windowDays} days`,
        observed: `${outCp.size} distinct recipients and ${inCp.size} distinct senders in ${Math.ceil(spanDays)} days`,
        evidence: outflows,
        firedAt: lastOf(outflows),
      });
    }
  }
  {
    const R = RULES.fanInBurst;
    const hit = firstDenseWindow(inflows, R.minSenders, R.windowMinutes * MINUTE_MS, (r) => r.from_account);
    if (hit) {
      // Fires when the threshold is first met; reports the busiest window overall.
      let peak = 0;
      let peakWindow = hit.window;
      for (const end of inflows) {
        const w = inflows.filter((r) => +r.ts <= +end.ts && +end.ts - +r.ts <= R.windowMinutes * MINUTE_MS);
        const n = new Set(w.map((r) => r.from_account)).size;
        if (n > peak) [peak, peakWindow] = [n, w];
      }
      firings.push({
        rule: R,
        title: "Fan-in burst: many senders in a short window",
        condition: `${R.minSenders}+ distinct senders within ${R.windowMinutes} minutes`,
        observed: `${peak} distinct senders within ${R.windowMinutes} minutes at the busiest point`,
        evidence: peakWindow,
        firedAt: hit.endAt,
      });
    }
  }
  {
    const R = RULES.fxConversionThenTransfer;
    const pairs: FlowRow[][] = [];
    for (const conv of rows.filter((r) => directionOf(r, accountId) === "self" && r.payment_currency !== r.receiving_currency)) {
      const onward = outflows.find(
        (o) => o.payment_currency === conv.receiving_currency && +o.ts >= +conv.ts && +o.ts - +conv.ts <= R.withinMinutes * MINUTE_MS,
      );
      if (onward) pairs.push([conv, onward]);
    }
    if (pairs.length >= R.minOccurrences) {
      firings.push({
        rule: R,
        title: "Currency conversion followed by onward transfer",
        condition: `${R.minOccurrences}+ times, the account converts currency with itself and pays out in the new currency within ${R.withinMinutes} minutes`,
        observed: `${pairs.length} conversion-then-transfer sequences`,
        evidence: pairs.flat(),
        firedAt: pairs[R.minOccurrences - 1]![1]!.ts,
      });
    }
  }
  {
    const R = RULES.outflowExceedsInflow;
    const inUsd = inflows.reduce((s, r) => s + usdValueOf(r, "in"), 0);
    const outUsd = outflows.reduce((s, r) => s + usdValueOf(r, "out"), 0);
    if (outUsd >= R.minOutUsd && outUsd > R.ratio * inUsd) {
      firings.push({
        rule: R,
        title: "Outflows exceed inflows: source of funds not visible",
        condition: `Money out is more than ${R.ratio}x money in and at least ${usd(R.minOutUsd)} (US-dollar equivalent)`,
        observed: `${usd(outUsd)} out against ${usd(inUsd)} in`,
        evidence: [...inflows, ...outflows],
        firedAt: lastOf(outflows),
      });
    }
  }

  const lastTxnAt = rows.length ? rows.at(-1)!.ts : new Date(0);
  const alerts: Omit<Alert, "alertId">[] = firings.map((f) => toAlert(accountId, f, []));

  {
    const R = RULES.sanctionsNameScreen;
    if (kyc) {
      const { result } = await screenSanctions(kyc.accountHolderName, opts);
      if (result.matched && result.sourceId) {
        alerts.push(
          toAlert(
            accountId,
            {
              rule: R,
              title: "Name matches the OFAC sanctions list",
              condition: "Account holder name has similarity of 0.85 or more to an OFAC SDN name or alias",
              observed: `Similarity ${result.score.toFixed(3)} to OFAC entry "${result.matchedName}"`,
              evidence: [],
              firedAt: lastTxnAt,
            },
            [result.sourceId, kyc.sourceId],
          ),
        );
      }
    }
  }
  {
    const R = RULES.kycReviewOverdue;
    const reviewedAt = kyc?.lastReviewDate ? new Date(kyc.lastReviewDate) : null;
    const ageDays = reviewedAt ? Math.floor((+lastTxnAt - +reviewedAt) / DAY_MS) : null;
    if (kyc && (ageDays === null || ageDays > R.maxAgeDays)) {
      alerts.push(
        toAlert(
          accountId,
          {
            rule: R,
            title: "Periodic review: KYC profile overdue",
            condition: `No KYC review on file, or the last one is more than ${R.maxAgeDays} days old`,
            observed: ageDays === null ? "No review date on file" : `Last reviewed ${ageDays} days before the latest activity`,
            evidence: [],
            firedAt: lastTxnAt,
          },
          [kyc.sourceId],
        ),
      );
    }
  }

  return alerts.sort((a, b) => a.firedAt.localeCompare(b.firedAt) || a.ruleId.localeCompare(b.ruleId));
}

function toAlert(accountId: string, f: Firing, extraSources: SourceId[]): Omit<Alert, "alertId"> {
  const due = new Date(+f.firedAt + 30 * DAY_MS);
  const evidence = [...new Set(f.evidence.map((r) => sourceIdForRow(r.row_id) as SourceId))].sort();
  return {
    sourceId: `alert:tm:${accountId}:${f.rule.id}` as SourceId,
    accountId,
    ruleId: f.rule.id,
    ruleVersion: f.rule.version,
    title: f.title,
    condition: f.condition,
    observed: f.observed,
    evidenceSourceIds: [...evidence, ...extraSources],
    firedAt: f.firedAt.toISOString(),
    jurisdiction: "US",
    dueDate: due.toISOString(),
    sarConfidentialitySensitive: true,
  };
}
