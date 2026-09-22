import { z } from "zod";
import { RecommendationSchema } from "./agentOutputs.ts";

/**
 * The 10-step pipeline's states. AWAITING_ANALYST is the hard stop: the orchestrator's
 * state machine (src/orchestrator/pipeline.ts) has no transition out of it except the
 * one driven by an authenticated POST /cases/:id/analyst/decision.
 */
export const CaseStateSchema = z.enum([
  "INGESTED",
  "EVIDENCE",
  "KYC",
  "ANALYTICS",
  "TYPOLOGY",
  "VERIFICATION",
  "BLOCKED_VERIFICATION",
  "PACKET_READY",
  "AWAITING_ANALYST",
  "ESCALATED_SANCTIONS",
  "DISPOSITION_RECORDED",
  "QA",
  "OPS_EXCEPTION",
]);
export type CaseState = z.infer<typeof CaseStateSchema>;

export const TERMINAL_STATES: ReadonlySet<CaseState> = new Set([
  "BLOCKED_VERIFICATION",
  "ESCALATED_SANCTIONS",
  "QA",
  "OPS_EXCEPTION",
]);

export const AnalystRoleSchema = z.enum(["analyst", "sanctions", "readonly"]);
export type AnalystRole = z.infer<typeof AnalystRoleSchema>;

export const AnalystDecisionSchema = z.object({
  analystId: z.string().min(1),
  disposition: RecommendationSchema,
  rationale: z.string().min(1),
  overrideReason: z.string().optional(),
});
export type AnalystDecision = z.infer<typeof AnalystDecisionSchema>;
