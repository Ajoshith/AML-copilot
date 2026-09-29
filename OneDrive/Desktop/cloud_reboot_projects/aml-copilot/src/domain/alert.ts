import { z } from "zod";
import { SourceIdSchema } from "./ids.ts";

/**
 * A transaction-monitoring alert, raised by a deterministic rule in
 * src/analytics/alertRules.ts over the real transactions (or, for the two profile
 * rules, over the account holder's KYC record). Nothing here is hand-assigned:
 * tests/alerts.test.ts re-runs every rule and fails if data/overlay/alerts.json differs.
 */
export const AlertSchema = z.object({
  sourceId: SourceIdSchema,
  alertId: z.string(),
  accountId: z.string(),
  ruleId: z.string(),
  ruleVersion: z.string(),
  title: z.string(),
  /** The rule and its threshold in plain words. */
  condition: z.string(),
  /** What this account actually showed, against that threshold. */
  observed: z.string(),
  evidenceSourceIds: z.array(SourceIdSchema),
  /** When the condition was first met: the triggering transaction's time, never wall-clock time. */
  firedAt: z.string(),
  jurisdiction: z.string(),
  dueDate: z.string(),
  sarConfidentialitySensitive: z.boolean(),
});
export type Alert = z.infer<typeof AlertSchema>;
