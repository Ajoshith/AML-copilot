import { callAgent } from "../llm/call.ts";
import { TypologyAssessmentSchema, type TypologyAssessment, type EvidenceSummary } from "../domain/agentOutputs.ts";
import type { Computation } from "../domain/computation.ts";
import type { TypologyClause } from "../policy/typologiesSchema.ts";
import { POLICY_VERSION } from "../config.ts";
import { SAFETY_PREAMBLE } from "./base.ts";

export const SYSTEM_PROMPT = `You are the Typology/Policy agent in an AML alert-investigation pipeline. You map computed evidence against the real FFIEC BSA/AML Manual Appendix F red-flag corpus provided below.

Rules:
- You may ONLY cite a clause id (ffiecClauseId) that appears verbatim in the provided corpus. Never invent a clause id or paraphrase policy text as if it were a real citation. An invented clause id will be rejected downstream.
- Every match's supportingSourceIds must be drawn from the source_ids present in the Evidence summary or computations provided — never invent a source_id.
- strength reflects how directly the cited evidence matches the clause's described pattern (low/medium/high) — do not inflate it.
- You MUST include at least one counter-hypothesis: a plausible, good-faith innocent explanation for the same evidence (e.g. a legitimate business reason for the observed pattern). This is mandatory even when you believe the account is genuinely suspicious — a required check against confirmation bias, not an optional hedge.
- List any dataGaps that would need to be resolved before a confident typology determination (e.g. an unverified occupation, a missing prior-case check).
- Do not recommend a disposition — that is the Coordinator's job.

${SAFETY_PREAMBLE}`;

export interface TypologyAgentInput {
  caseId: string;
  accountId: string;
  evidence: EvidenceSummary;
  computations: Computation[];
  typologyCorpus: { section: string; clauses: TypologyClause[] }[];
}

export function buildTypologyUserContent(input: TypologyAgentInput): string {
  return [
    `Account under investigation: ${input.accountId}`,
    `Policy version: ${POLICY_VERSION} (FFIEC BSA/AML Manual Appendix F)`,
    `Evidence summary (each point already carries its own source_id):`,
    JSON.stringify(input.evidence, null, 2),
    `Computed signals (deterministic, real transaction data):`,
    JSON.stringify(input.computations, null, 2),
    `Real FFIEC red-flag corpus — the ONLY clause ids you may cite:`,
    JSON.stringify(input.typologyCorpus, null, 2),
  ].join("\n\n");
}

export async function runTypologyAgent(input: TypologyAgentInput): Promise<TypologyAssessment> {
  const userContent = buildTypologyUserContent(input);

  return callAgent({
    caseId: input.caseId,
    agentName: "typology",
    schemaName: "TypologyAssessment",
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    outputSchema: TypologyAssessmentSchema,
    maxTokens: 24000,
  });
}
