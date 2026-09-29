import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { evaluateAlertRules, RULES } from "../src/analytics/alertRules.ts";
import { getAccountTimeline } from "../src/analytics/timeline.ts";
import { getKycRecord } from "../src/data/overlayStore.ts";
import { AlertSchema } from "../src/domain/alert.ts";
import { DATA_OVERLAY_DIR } from "../src/config.ts";

_resetForTests();
await initDb({ useSlice: true });

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{ caseId: string; accountId: string }>;
const committed = AlertSchema.array().parse(JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/alerts.json`, "utf8")));
const byCase = (id: string) => cases.find((c) => c.caseId === id)!;
const rulesFor = (accountId: string) => committed.filter((a) => a.accountId === accountId).map((a) => a.ruleId).sort();

describe("alerts are raised by the monitoring rules, not assigned", () => {
  test("the committed alerts are exactly what the rules produce from the data", async () => {
    for (const c of cases) {
      const fresh = await evaluateAlertRules(c.accountId, await getKycRecord(c.accountId), { useSlice: true });
      const stored = committed.filter((a) => a.accountId === c.accountId).map(({ alertId: _id, ...rest }) => rest);
      expect(stored, `alerts for ${c.caseId}`).toEqual(fresh);
    }
  });

  test("every alert cites the case's own transactions and fires inside the data window", async () => {
    for (const c of cases) {
      const timeline = await getAccountTimeline(c.accountId, { useSlice: true });
      const txnIds = new Set(timeline.map((t) => t.sourceId));
      const first = +new Date(timeline[0]!.timestamp);
      const last = +new Date(timeline.at(-1)!.timestamp);
      for (const a of committed.filter((x) => x.accountId === c.accountId)) {
        for (const id of a.evidenceSourceIds.filter((s) => s.startsWith("txn:"))) expect(txnIds.has(id)).toBe(true);
        expect(+new Date(a.firedAt)).toBeGreaterThanOrEqual(first);
        expect(+new Date(a.firedAt)).toBeLessThanOrEqual(last);
      }
    }
  });

  test("no case carries an alert its data does not support", () => {
    // C-001 was labelled near-threshold-cash-cluster, yet has no cash near $10,000.
    for (const c of cases) expect(rulesFor(c.accountId)).not.toContain(RULES.structuringNearThresholdCash.id);
    expect(rulesFor(byCase("C-001").accountId)).toEqual(
      ["fx-conversion-then-transfer", "gather-scatter", "kyc-review-overdue", "outflow-exceeds-inflow"],
    );
    expect(rulesFor(byCase("C-005").accountId)).toContain(RULES.sanctionsNameScreen.id);
    expect(rulesFor(byCase("C-006").accountId)).toEqual([RULES.kycReviewOverdue.id]);
  });
});
