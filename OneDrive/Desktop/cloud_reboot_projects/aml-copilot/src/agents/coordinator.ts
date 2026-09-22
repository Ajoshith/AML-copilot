import { callAgent } from "../llm/call.ts";
import {
  CasePacketSchema,
  type CasePacket,
  type EvidenceSummary,
  type CustomerProfileAssessment,
  type TypologyAssessment,
} from "../domain/agentOutputs.ts";
import { SAFETY_PREAMBLE } from "./base.ts";

export const SYSTEM_PROMPT = `You are the Coordinator agent in an AML alert-investigation pipeline. You synthesize already-verified findings from the Evidence, KYC and Typology agents into one case memo for a human BSA/AML analyst.

Rules:
- recommendation MUST be exactly one of: CLOSE, INVESTIGATE_FURTHER, ESCALATE_SANCTIONS, ESCALATE_EDD, CONSIDER_SAR. You are choosing among these fixed options, not inventing a new one.
- Every entry in findings must carry the source_id(s) it is grounded in — draw only from source_ids that already appear in the Evidence/Typology material provided, never a new one.
- counterHypotheses must include at least one genuine alternative explanation — carry forward and sharpen the Typology agent's counter-hypothesis rather than dropping it.
- blockingGaps should list any KYC/data gap that should give the analyst pause before accepting your recommendation at face value.
- You are drafting a recommendation for a human analyst to review and decide on — you are not filing anything, closing any account, or taking any action yourself. Write the memo accordingly.
- confidence is your own calibrated 0-1 estimate; do not default to a fixed number.

${SAFETY_PREAMBLE}`;

export interface CoordinatorAgentInput {
  caseId: string;
  accountId: string;
  evidence: EvidenceSummary;
  kycAssessment: CustomerProfileAssessment;
  typologyAssessment: TypologyAssessment;
}

export function buildCoordinatorUserContent(input: CoordinatorAgentInput): string {
  return [
    `Account under investigation: ${input.accountId}`,
    `Evidence summary:`,
    JSON.stringify(input.evidence, null, 2),
    `KYC/CDD assessment:`,
    JSON.stringify(input.kycAssessment, null, 2),
    `Typology assessment:`,
    JSON.stringify(input.typologyAssessment, null, 2),
  ].join("\n\n");
}

export async function runCoordinatorAgent(input: CoordinatorAgentInput): Promise<CasePacket> {
  const userContent = buildCoordinatorUserContent(input);

  return callAgent({
    caseId: input.caseId,
    agentName: "coordinator",
    schemaName: "CasePacket",
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    outputSchema: CasePacketSchema,
    maxTokens: 24000,
  });
}
