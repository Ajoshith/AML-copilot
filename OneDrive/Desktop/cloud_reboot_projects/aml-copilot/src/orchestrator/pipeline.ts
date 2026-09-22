import type { CaseState } from "../domain/case.ts";
import type { SourceId } from "../domain/ids.ts";
import { getAccountTimeline } from "../analytics/timeline.ts";
import { computeAggregates } from "../analytics/aggregates.ts";
import { computeGraph } from "../analytics/graph.ts";
import { detectPatterns } from "../analytics/patterns.ts";
import { screenSanctions } from "../analytics/sanctionsMatch.ts";
import { computeStalenessDays } from "../analytics/staleness.ts";
import { getKycRecord, getNotesForAccount, getAlertsForAccount } from "../data/overlayStore.ts";
import { loadTypologyCorpus } from "../policy/typologiesSchema.ts";
import { runEvidenceAgent } from "../agents/evidence.ts";
import { runKycAgent } from "../agents/kyc.ts";
import { runTypologyAgent } from "../agents/typology.ts";
import { verifyCase } from "../agents/verifier.ts";
import { runCoordinatorAgent } from "../agents/coordinator.ts";
import { getCaseRecord, updateCaseRecord, type CaseRecord } from "../store/caseStore.ts";
import { appendAuditEvent } from "../audit/log.ts";
import { assertTransition } from "./state.ts";

async function setState(caseId: string, to: CaseState, reason: string): Promise<void> {
  const record = getCaseRecord(caseId);
  const from = record.state ?? "INGESTED";
  if (record.state !== null) {
    assertTransition(from, to);
  }
  updateCaseRecord(caseId, { state: to });
  await appendAuditEvent({
    type: "state_transition",
    timestamp: new Date().toISOString(),
    caseId,
    fromState: from,
    toState: to,
    reason,
  });
}

/**
 * Runs a case through steps 1-7 of the plan's 10-step pipeline: ingest, evidence,
 * KYC, analytics (incl. sanctions screening), typology, verification, and — only
 * if verification passes — the coordinator's draft packet. The pipeline halts at
 * one of three points with no further code-driven progress possible:
 *   - ESCALATED_SANCTIONS (a sanctions match; the AML agent never adjudicates it)
 *   - BLOCKED_VERIFICATION (verification failed; no packet is ever released)
 *   - AWAITING_ANALYST (the hard stop; only an authenticated analyst decision via
 *     the API can advance the case from here — see the plan's step 8).
 */
export async function runCase(params: { caseId: string; accountId: string; useSlice?: boolean }): Promise<CaseRecord> {
  const { caseId, accountId, useSlice } = params;

  updateCaseRecord(caseId, { accountId });
  await setState(caseId, "INGESTED", `case ${caseId} ingested for account ${accountId}`);

  // Step 2: Evidence
  await setState(caseId, "EVIDENCE", "building real transaction timeline and narrating it");
  const transactions = await getAccountTimeline(accountId, { useSlice });
  const notes = await getNotesForAccount(accountId);
  const evidence = await runEvidenceAgent({ caseId, accountId, transactions, notes });
  updateCaseRecord(caseId, { evidence });

  // Step 3: KYC
  await setState(caseId, "KYC", "comparing stated KYC profile against computed behavior");
  const kycRecord = await getKycRecord(accountId);
  const aggregates = await computeAggregates(accountId, { useSlice });
  const patterns = await detectPatterns(accountId, { useSlice });
  // Staleness is measured as-of the alert's firedAt — a fixed, historical
  // timestamp — never wall-clock "now". An investigation is anchored to when
  // the alert fired, not to whenever the pipeline happens to execute; using
  // wall-clock time would also make this value (and therefore the KYC agent's
  // cassette key) drift every day, permanently breaking replay.
  const alerts = await getAlertsForAccount(accountId);
  const asOf = alerts[0] ? new Date(alerts[0].firedAt) : new Date(0);
  const stalenessDays = computeStalenessDays(kycRecord?.lastReviewDate ?? null, asOf);
  const kycAssessment = await runKycAgent({
    caseId,
    accountId,
    kycRecord,
    aggregates,
    patterns,
    stalenessDays,
  });
  updateCaseRecord(caseId, { kycAssessment });

  // Step 4: Analytics (graph, patterns already computed above, sanctions screen)
  await setState(caseId, "ANALYTICS", "computing graph structure and screening sanctions");
  const graph = await computeGraph(accountId, { useSlice });
  const accountHolderName = kycRecord?.accountHolderName ?? accountId;
  const { result: sanctionsResult, computations: sanctionsComputations } = await screenSanctions(accountHolderName, {
    useSlice,
  });
  const allComputations = [...aggregates, ...graph, ...patterns, ...sanctionsComputations];
  updateCaseRecord(caseId, { sanctionsResult, computations: allComputations });

  if (sanctionsResult.matched) {
    await setState(
      caseId,
      "ESCALATED_SANCTIONS",
      `sanctions match: "${sanctionsResult.matchedName}" (score ${sanctionsResult.score.toFixed(3)}) — ` +
        `routed to the sanctions team; the AML pipeline never adjudicates this`,
    );
    return getCaseRecord(caseId);
  }

  // Step 5: Typology
  await setState(caseId, "TYPOLOGY", "mapping evidence to the real FFIEC red-flag corpus");
  const corpus = await loadTypologyCorpus();
  const typologyCorpusInput = corpus.sections.map((s) => ({ section: s.section, clauses: s.clauses }));
  const typologyAssessment = await runTypologyAgent({
    caseId,
    accountId,
    evidence,
    computations: allComputations,
    typologyCorpus: typologyCorpusInput,
  });
  updateCaseRecord(caseId, { typologyAssessment });

  // Step 6: Verification — runs BEFORE the Coordinator drafts anything.
  await setState(caseId, "VERIFICATION", "independently verifying evidence and typology assessment");
  const validSourceIds = new Set<SourceId>([
    ...transactions.map((t) => t.sourceId),
    ...notes.map((n) => n.sourceId),
    ...(kycRecord ? [kycRecord.sourceId] : []),
  ]);
  const verification = await verifyCase({
    caseId,
    accountId,
    originalComputations: allComputations,
    validSourceIds,
    evidence,
    typologyAssessment,
    useSlice,
  });
  updateCaseRecord(caseId, { verification });

  if (verification.verdict === "FAIL") {
    await setState(
      caseId,
      "BLOCKED_VERIFICATION",
      `verification failed: ${verification.unsupportedClaims.length} unsupported claim(s), ` +
        `${verification.recalcMismatches.length} recalculation mismatch(es) — packet withheld from analyst`,
    );
    return getCaseRecord(caseId);
  }

  // Step 7: Coordinator — only reached because verification passed.
  await setState(caseId, "PACKET_READY", "verification passed; drafting case memo");
  const casePacket = await runCoordinatorAgent({ caseId, accountId, evidence, kycAssessment, typologyAssessment });
  updateCaseRecord(caseId, { casePacket });

  // Step 8: the hard stop. No further transition happens in this function.
  await setState(caseId, "AWAITING_ANALYST", "case packet ready; awaiting authenticated analyst decision");
  return getCaseRecord(caseId);
}
