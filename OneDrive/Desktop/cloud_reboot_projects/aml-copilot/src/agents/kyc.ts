import { callAgent } from "../llm/call.ts";
import { CustomerProfileAssessmentSchema, type CustomerProfileAssessment } from "../domain/agentOutputs.ts";
import type { CustomerRecord } from "../domain/customer.ts";
import type { Computation } from "../domain/computation.ts";
import { SAFETY_PREAMBLE } from "./base.ts";

export const SYSTEM_PROMPT = `You are the KYC/CDD agent in an AML alert-investigation pipeline. You compare a customer's stated profile against their account's actual computed transaction behavior.

Rules:
- You may only use the KYC profile and computed aggregates provided below. You cannot see raw transactions directly.
- If a KYC field is null or missing, that is a data gap you must report in dataGaps — never guess or infer a value for it.
- You never rewrite, correct, or invent a value for a CDD field. Your job is to compare and flag, not to fix.
- expectedActivity should describe, in plain terms, whether the computed behavior (volume, velocity) is consistent with the stated profile (occupation, business type, expected monthly volume) — and if not, how it diverges.
- riskFactors should list concrete, specific mismatches or concerns, not generic boilerplate.
- stalenessDays has already been computed deterministically and is provided below — report it in your output as-is; if it is null (no review date on file), that is itself a data gap to report.

${SAFETY_PREAMBLE}`;

export interface KycAgentInput {
  caseId: string;
  accountId: string;
  kycRecord: CustomerRecord | null;
  aggregates: Computation[];
  patterns: Computation[];
  /** Computed deterministically by src/analytics/staleness.ts — never a live
   * timestamp. A raw "now" in the prompt would make this agent's cassette key
   * unique on every call (a cassette is keyed on exact prompt content),
   * permanently breaking record/replay, not just in tests. */
  stalenessDays: number | null;
}

export function buildKycUserContent(input: KycAgentInput): string {
  return [
    `Account under investigation: ${input.accountId}`,
    `Deterministically computed staleness of the last KYC review, in days (null means no review date on file):`,
    JSON.stringify(input.stalenessDays),
    `KYC/CDD profile on file (null fields are real data gaps, not omissions to infer):`,
    JSON.stringify(input.kycRecord, null, 2),
    `Computed account aggregates (deterministic, real transaction data):`,
    JSON.stringify(input.aggregates, null, 2),
    `Computed behavioral patterns (deterministic, real transaction data):`,
    JSON.stringify(input.patterns, null, 2),
  ].join("\n\n");
}

export async function runKycAgent(input: KycAgentInput): Promise<CustomerProfileAssessment> {
  const userContent = buildKycUserContent(input);

  return callAgent({
    caseId: input.caseId,
    agentName: "kyc",
    schemaName: "CustomerProfileAssessment",
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    outputSchema: CustomerProfileAssessmentSchema,
  });
}
