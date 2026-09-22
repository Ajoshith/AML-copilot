import { z } from "zod";
import { SourceIdSchema } from "./ids.ts";

/** agents/evidence.ts — narrates the timeline; every point must cite what grounds it. */
export const EvidenceSummarySchema = z.object({
  points: z
    .array(
      z.object({
        text: z.string(),
        sourceIds: z.array(SourceIdSchema).min(1),
      }),
    )
    .min(1),
});
export type EvidenceSummary = z.infer<typeof EvidenceSummarySchema>;

/** agents/kyc.ts — compares stated profile against computed behavior. Never rewrites CDD. */
export const CustomerProfileAssessmentSchema = z.object({
  expectedActivity: z.string(),
  riskFactors: z.array(z.string()),
  dataGaps: z.array(z.string()),
  stalenessDays: z.number().nullable(),
});
export type CustomerProfileAssessment = z.infer<typeof CustomerProfileAssessmentSchema>;

/**
 * agents/typology.ts — must cite a real FFIEC clause id (validated post-parse against
 * typologies.yaml) and must produce at least one counter-hypothesis: this is the
 * blueprint's confirmation-bias mitigation enforced as a schema constraint, not a
 * prompt suggestion.
 */
export const TypologyMatchSchema = z.object({
  ffiecClauseId: z.string(),
  policyVersion: z.string(),
  supportingSourceIds: z.array(SourceIdSchema).min(1),
  strength: z.enum(["low", "medium", "high"]),
});

export const TypologyAssessmentSchema = z.object({
  matches: z.array(TypologyMatchSchema),
  counterHypotheses: z.array(z.string()).min(1),
  dataGaps: z.array(z.string()),
});
export type TypologyAssessment = z.infer<typeof TypologyAssessmentSchema>;

/**
 * agents/verifier.ts — the fail-closed gate. verdict === "FAIL" blocks the packet
 * from ever reaching AWAITING_ANALYST; there is no override path in code.
 */
export const VerificationCheckSchema = z.object({
  claim: z.string(),
  sourceId: SourceIdSchema.nullable(),
  status: z.enum(["VERIFIED", "UNSUPPORTED", "MISMATCH"]),
});

export const VerificationResultSchema = z.object({
  checks: z.array(VerificationCheckSchema),
  unsupportedClaims: z.array(z.string()),
  recalcMismatches: z.array(z.string()),
  verdict: z.enum(["PASS", "FAIL"]),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

/** agents/coordinator.ts — the final draft memo. recommendation is a closed enum. */
export const RecommendationSchema = z.enum([
  "CLOSE",
  "INVESTIGATE_FURTHER",
  "ESCALATE_SANCTIONS",
  "ESCALATE_EDD",
  "CONSIDER_SAR",
]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const FindingSchema = z.object({
  text: z.string(),
  sourceIds: z.array(SourceIdSchema).min(1),
});
export type Finding = z.infer<typeof FindingSchema>;

export const CasePacketSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  counterHypotheses: z.array(z.string()).min(1),
  recommendation: RecommendationSchema,
  confidence: z.number().min(0).max(1),
  blockingGaps: z.array(z.string()),
});
export type CasePacket = z.infer<typeof CasePacketSchema>;
