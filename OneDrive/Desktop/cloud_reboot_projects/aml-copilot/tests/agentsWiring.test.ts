import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { getAccountTimeline } from "../src/analytics/timeline.ts";
import { computeAggregates } from "../src/analytics/aggregates.ts";
import { computeGraph } from "../src/analytics/graph.ts";
import { detectPatterns } from "../src/analytics/patterns.ts";
import { getKycRecord, getNotesForAccount } from "../src/data/overlayStore.ts";
import { loadTypologyCorpus, clauseIndex } from "../src/policy/typologiesSchema.ts";
import { runEvidenceAgent, buildEvidenceUserContent, SYSTEM_PROMPT as EVIDENCE_PROMPT } from "../src/agents/evidence.ts";
import { runKycAgent, buildKycUserContent, SYSTEM_PROMPT as KYC_PROMPT } from "../src/agents/kyc.ts";
import {
  runTypologyAgent,
  buildTypologyUserContent,
  SYSTEM_PROMPT as TYPOLOGY_PROMPT,
} from "../src/agents/typology.ts";
import {
  runCoordinatorAgent,
  buildCoordinatorUserContent,
  SYSTEM_PROMPT as COORDINATOR_PROMPT,
} from "../src/agents/coordinator.ts";
import { verifyCase, buildVerifierUserContent, SYSTEM_PROMPT as VERIFIER_PROMPT } from "../src/agents/verifier.ts";
import { POLICY_VERSION, DATA_OVERLAY_DIR } from "../src/config.ts";
import type { SourceId } from "../src/domain/ids.ts";
import { seedCassette, removeCassettes } from "./helpers/seedCassette.ts";

_resetForTests();
await initDb({ useSlice: true });

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
  caseId: string;
  accountId: string;
}>;
const c001 = cases.find((c) => c.caseId === "C-001")!;

test("full agent chain — evidence -> kyc -> typology -> verifier -> coordinator — wired end-to-end via seeded cassettes", async () => {
  const seededKeys: string[] = [];

  const transactions = await getAccountTimeline(c001.accountId, { useSlice: true });
  const notes = await getNotesForAccount(c001.accountId);
  const kycRecord = await getKycRecord(c001.accountId);
  const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
  const graph = await computeGraph(c001.accountId, { useSlice: true });
  const patterns = await detectPatterns(c001.accountId, { useSlice: true });
  const corpus = await loadTypologyCorpus();
  const clauses = await clauseIndex();
  const realClauseId = corpus.sections[0]!.clauses[0]!.id;
  const realSourceId = transactions[0]!.sourceId;
  const typologyCorpusInput = corpus.sections.map((s) => ({ section: s.section, clauses: s.clauses }));

  // --- Evidence ---
  const evidenceInput = { caseId: c001.caseId, accountId: c001.accountId, transactions, notes };
  const evidenceOutput = {
    points: [{ text: "Account shows activity with multiple counterparties.", sourceIds: [realSourceId] }],
  };
  seededKeys.push(
    await seedCassette(
      "EvidenceSummary",
      EVIDENCE_PROMPT,
      buildEvidenceUserContent(evidenceInput),
      evidenceOutput,
    ),
  );
  const evidence = await runEvidenceAgent(evidenceInput);
  expect(evidence.points.length).toBeGreaterThan(0);
  expect(evidence.points[0]!.sourceIds).toContain(realSourceId);

  // --- KYC ---
  const kycInput = { caseId: c001.caseId, accountId: c001.accountId, kycRecord, aggregates, patterns, stalenessDays: 545 };
  const kycOutput = {
    expectedActivity: "Volume roughly consistent with stated profile.",
    riskFactors: [],
    dataGaps: [],
    stalenessDays: 545,
  };
  seededKeys.push(
    await seedCassette("CustomerProfileAssessment", KYC_PROMPT, buildKycUserContent(kycInput), kycOutput),
  );
  const kycAssessment = await runKycAgent(kycInput);
  expect(kycAssessment.expectedActivity).toBeTruthy();

  // --- Typology ---
  const typologyInput = {
    caseId: c001.caseId,
    accountId: c001.accountId,
    evidence,
    computations: [...aggregates, ...graph, ...patterns],
    typologyCorpus: typologyCorpusInput,
  };
  const typologyOutput = {
    matches: [
      {
        ffiecClauseId: realClauseId,
        policyVersion: POLICY_VERSION,
        supportingSourceIds: [realSourceId],
        strength: "medium",
      },
    ],
    counterHypotheses: ["Could reflect a legitimate cash-intensive small business."],
    dataGaps: [],
  };
  seededKeys.push(
    await seedCassette("TypologyAssessment", TYPOLOGY_PROMPT, buildTypologyUserContent(typologyInput), typologyOutput),
  );
  const typologyAssessment = await runTypologyAgent(typologyInput);
  expect(typologyAssessment.counterHypotheses.length).toBeGreaterThanOrEqual(1);
  expect(clauses.has(typologyAssessment.matches[0]!.ffiecClauseId)).toBe(true);

  // --- Verifier (runs BEFORE the Coordinator drafts anything, per the plan) ---
  const verifierInput = {
    caseId: c001.caseId,
    accountId: c001.accountId,
    evidence,
    typologyAssessment,
    computations: [...aggregates, ...graph, ...patterns],
  };
  const verifierOutput = { checks: [], unsupportedClaims: [], recalcMismatches: [], verdict: "PASS" };
  seededKeys.push(
    await seedCassette("VerificationResult", VERIFIER_PROMPT, buildVerifierUserContent(verifierInput), verifierOutput),
  );

  const validSourceIds = new Set<SourceId>([
    ...transactions.map((t) => t.sourceId),
    ...(kycRecord ? [kycRecord.sourceId] : []),
  ]);
  const verification = await verifyCase({
    caseId: c001.caseId,
    accountId: c001.accountId,
    originalComputations: [...aggregates, ...graph, ...patterns],
    validSourceIds,
    evidence,
    typologyAssessment,
    useSlice: true,
  });
  expect(verification.verdict).toBe("PASS");

  // --- Coordinator (only runs because verification passed) ---
  const coordinatorInput = { caseId: c001.caseId, accountId: c001.accountId, evidence, kycAssessment, typologyAssessment };
  const casePacketOutput = {
    summary: "Account shows structuring-like activity warranting further review.",
    findings: [{ text: "Cash activity near reporting threshold.", sourceIds: [realSourceId] }],
    counterHypotheses: typologyAssessment.counterHypotheses,
    recommendation: "INVESTIGATE_FURTHER",
    confidence: 0.65,
    blockingGaps: [],
  };
  seededKeys.push(
    await seedCassette("CasePacket", COORDINATOR_PROMPT, buildCoordinatorUserContent(coordinatorInput), casePacketOutput),
  );
  const casePacket = await runCoordinatorAgent(coordinatorInput);
  expect(casePacket.recommendation).toBe("INVESTIGATE_FURTHER");

  await removeCassettes(seededKeys);
});
