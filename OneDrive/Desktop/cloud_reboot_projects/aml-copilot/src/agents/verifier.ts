import { callAgent } from "../llm/call.ts";
import {
  VerificationResultSchema,
  type VerificationResult,
  type EvidenceSummary,
  type TypologyAssessment,
} from "../domain/agentOutputs.ts";
import type { Computation } from "../domain/computation.ts";
import type { SourceId } from "../domain/ids.ts";
import { clauseIndex } from "../policy/typologiesSchema.ts";
import { computeAggregates } from "../analytics/aggregates.ts";
import { computeGraph } from "../analytics/graph.ts";
import { detectPatterns } from "../analytics/patterns.ts";
import { SAFETY_PREAMBLE } from "./base.ts";

/**
 * Two independent passes, matching the plan's sequence: the Verifier checks the
 * Evidence summary and Typology assessment BEFORE the Coordinator ever drafts a
 * memo — "verified evidence" is what the Coordinator receives, not the other way
 * around. A deterministic pass (recompute + citation existence — a single
 * correct answer, never a model) and a model pass (contradiction / unsupported-
 * inference detection in prose — a reading-comprehension task with no
 * rule-engine equivalent). FAIL from EITHER side fails the whole verification;
 * the model pass can never override a deterministic one.
 */

export const SYSTEM_PROMPT = `You are the independent Verifier agent in an AML alert-investigation pipeline. Every numeric value and every citation has ALREADY been checked deterministically by code before you see this — that is not your job. Your job is narrower and strictly bounded: read the Evidence summary and Typology assessment for problems with MATERIAL FACTS.

Report ONLY these two things:
- A material fact asserted with no basis in the provided Evidence summary or computed signals — i.e. a who/what/when/where/how-much claim that simply is not supported by anything you were given.
- A direct internal contradiction: two statements that cannot both be true at the same time.

Judgment calls that are NOT verification failures — do not report these:
- Declared data gaps. The Typology agent is REQUIRED by procedure to list what it does not know. A cited red-flag match sitting alongside an acknowledged gap is honest calibration, not a contradiction, and not an overreach. Missing data becomes a research task for the analyst and is recorded as a blocking gap in the case packet — it is NOT a reason to withhold the packet. Only flag a gap that makes its match factually impossible, not merely less certain.
- Strength calibration. Whether a match deserves "low", "medium" or "high" is an analyst judgment, not a fact. Never fail a packet over how strengths compare to each other.
- Tone, hedging, emphasis, ordering, or how thoroughly something is argued.
- A value drawn from the computed signals provided below. Those are deterministic outputs of code, and referencing one is properly grounded.

The default verdict is PASS. FAIL only when a MATERIAL fact — one that would change the analyst's disposition — is unsupported or self-contradictory. A packet that fails here never reaches a human investigator at all, so a wrong FAIL is itself a serious failure. If you find nothing material, return empty lists and verdict PASS.

${SAFETY_PREAMBLE}`;

export interface DeterministicVerification {
  recalcMismatches: string[];
  unsupportedSourceIds: string[];
  unsupportedClauseIds: string[];
  verdict: "PASS" | "FAIL";
}

/** Recomputes every named Computation fresh and compares it to the value the
 * Evidence/Typology agents were originally given, and confirms every cited
 * source_id / ffiecClauseId actually resolves to something real. This is the
 * part of verification with a single correct answer — it never calls a model. */
export async function verifyDeterministic(params: {
  accountId: string;
  originalComputations: Computation[];
  validSourceIds: Set<SourceId>;
  evidence: EvidenceSummary;
  typologyAssessment: TypologyAssessment;
  useSlice?: boolean;
}): Promise<DeterministicVerification> {
  const { accountId, originalComputations, validSourceIds, evidence, typologyAssessment, useSlice } = params;

  const fresh = [
    ...(await computeAggregates(accountId, { useSlice })),
    ...(await computeGraph(accountId, { useSlice })),
    ...(await detectPatterns(accountId, { useSlice })),
  ];
  const freshByName = new Map(fresh.map((c) => [c.name, c.value]));

  const recalcMismatches: string[] = [];
  for (const original of originalComputations) {
    const freshValue = freshByName.get(original.name);
    if (freshValue === undefined) continue; // not part of the recomputable set (e.g. sanctions score)
    if (freshValue !== original.value) {
      recalcMismatches.push(`${original.name}: original=${original.value} recomputed=${freshValue}`);
    }
  }

  const unsupportedSourceIds: string[] = [];
  const checkSourceIds = (ids: string[]) => {
    for (const id of ids) {
      if (!validSourceIds.has(id as SourceId)) unsupportedSourceIds.push(id);
    }
  };
  for (const point of evidence.points) checkSourceIds(point.sourceIds);
  for (const match of typologyAssessment.matches) checkSourceIds(match.supportingSourceIds);

  const clauses = await clauseIndex();
  const unsupportedClauseIds: string[] = [];
  for (const match of typologyAssessment.matches) {
    if (!clauses.has(match.ffiecClauseId)) unsupportedClauseIds.push(match.ffiecClauseId);
  }

  const verdict: "PASS" | "FAIL" =
    recalcMismatches.length === 0 && unsupportedSourceIds.length === 0 && unsupportedClauseIds.length === 0
      ? "PASS"
      : "FAIL";

  return { recalcMismatches, unsupportedSourceIds, unsupportedClauseIds, verdict };
}

export interface VerifierAgentInput {
  caseId: string;
  accountId: string;
  evidence: EvidenceSummary;
  typologyAssessment: TypologyAssessment;
  /** The same deterministic signals the Typology agent was given. Without these
   * the verifier flags legitimate references to computed values (e.g. a
   * sanctions screening score) as "asserted without evidentiary basis" — it was
   * being asked to judge grounding against data it had never been shown. */
  computations: Computation[];
}

export function buildVerifierUserContent(input: VerifierAgentInput): string {
  return [
    `Evidence summary:`,
    JSON.stringify(input.evidence, null, 2),
    `Computed signals (deterministic outputs of code — referencing any of these is properly grounded):`,
    JSON.stringify(input.computations, null, 2),
    `Typology assessment:`,
    JSON.stringify(input.typologyAssessment, null, 2),
  ].join("\n\n");
}

/** The model pass: contradiction / unsupported-inference detection in prose. */
export async function runVerifierAgent(input: VerifierAgentInput): Promise<VerificationResult> {
  const userContent = buildVerifierUserContent(input);

  return callAgent({
    caseId: input.caseId,
    agentName: "verifier",
    schemaName: "VerificationResult",
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    outputSchema: VerificationResultSchema,
  });
}

/** The combined gate the orchestrator actually calls, BEFORE the Coordinator
 * drafts anything. There is no override path: a FAIL here means
 * BLOCKED_VERIFICATION and no packet is ever drafted or released. */
export async function verifyCase(params: {
  caseId: string;
  accountId: string;
  originalComputations: Computation[];
  validSourceIds: Set<SourceId>;
  evidence: EvidenceSummary;
  typologyAssessment: TypologyAssessment;
  useSlice?: boolean;
}): Promise<VerificationResult> {
  const deterministic = await verifyDeterministic(params);
  const modelResult = await runVerifierAgent({
    caseId: params.caseId,
    accountId: params.accountId,
    evidence: params.evidence,
    typologyAssessment: params.typologyAssessment,
    computations: params.originalComputations,
  });

  const checks: VerificationResult["checks"] = [
    ...deterministic.recalcMismatches.map((m) => ({ claim: m, sourceId: null, status: "MISMATCH" as const })),
    ...deterministic.unsupportedSourceIds.map((id) => ({
      claim: `Cited source_id does not resolve to any known record: ${id}`,
      sourceId: null,
      status: "UNSUPPORTED" as const,
    })),
    ...deterministic.unsupportedClauseIds.map((id) => ({
      claim: `Cited FFIEC clause id does not exist in the policy corpus: ${id}`,
      sourceId: null,
      status: "UNSUPPORTED" as const,
    })),
    ...modelResult.checks,
  ];

  return {
    checks,
    unsupportedClaims: [
      ...deterministic.unsupportedSourceIds,
      ...deterministic.unsupportedClauseIds,
      ...modelResult.unsupportedClaims,
    ],
    recalcMismatches: [...deterministic.recalcMismatches, ...modelResult.recalcMismatches],
    verdict: deterministic.verdict === "FAIL" || modelResult.verdict === "FAIL" ? "FAIL" : "PASS",
  };
}
