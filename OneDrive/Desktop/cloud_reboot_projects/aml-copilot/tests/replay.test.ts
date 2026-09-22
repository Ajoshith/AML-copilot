import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { getAccountTimeline } from "../src/analytics/timeline.ts";
import { computeAggregates } from "../src/analytics/aggregates.ts";
import { computeGraph } from "../src/analytics/graph.ts";
import { detectPatterns } from "../src/analytics/patterns.ts";
import { computeStalenessDays } from "../src/analytics/staleness.ts";
import { screenSanctions } from "../src/analytics/sanctionsMatch.ts";
import { getKycRecord, getAlertsForAccount } from "../src/data/overlayStore.ts";
import { loadTypologyCorpus } from "../src/policy/typologiesSchema.ts";
import { buildEvidenceUserContent, SYSTEM_PROMPT as EVIDENCE_PROMPT } from "../src/agents/evidence.ts";
import { buildKycUserContent, SYSTEM_PROMPT as KYC_PROMPT } from "../src/agents/kyc.ts";
import { buildTypologyUserContent, SYSTEM_PROMPT as TYPOLOGY_PROMPT } from "../src/agents/typology.ts";
import { buildVerifierUserContent, SYSTEM_PROMPT as VERIFIER_PROMPT } from "../src/agents/verifier.ts";
import { buildCoordinatorUserContent, SYSTEM_PROMPT as COORDINATOR_PROMPT } from "../src/agents/coordinator.ts";
import { runCase } from "../src/orchestrator/pipeline.ts";
import { _resetStoreForTests } from "../src/store/caseStore.ts";
import { cassetteKey } from "../src/llm/cassette.ts";
import { POLICY_VERSION, DATA_OVERLAY_DIR, MODEL_ID, AGENT_EFFORT, PROMPT_VERSION } from "../src/config.ts";
import { seedCassette, removeCassettes } from "./helpers/seedCassette.ts";

_resetForTests();
await initDb({ useSlice: true });

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
  caseId: string;
  accountId: string;
}>;
const c001 = cases.find((c) => c.caseId === "C-001")!;

async function seedFullRun(c: { caseId: string; accountId: string }) {
  const seededKeys: string[] = [];

  const transactions = await getAccountTimeline(c.accountId, { useSlice: true });
  const kycRecord = await getKycRecord(c.accountId);
  const aggregates = await computeAggregates(c.accountId, { useSlice: true });
  const graph = await computeGraph(c.accountId, { useSlice: true });
  const patterns = await detectPatterns(c.accountId, { useSlice: true });
  const accountHolderName = kycRecord?.accountHolderName ?? c.accountId;
  const { computations: sanctionsComputations } = await screenSanctions(accountHolderName, { useSlice: true });
  const alerts = await getAlertsForAccount(c.accountId);
  const asOf = alerts[0] ? new Date(alerts[0].firedAt) : new Date(0);
  const stalenessDays = computeStalenessDays(kycRecord?.lastReviewDate ?? null, asOf);
  const corpus = await loadTypologyCorpus();
  const realClauseId = corpus.sections[0]!.clauses[0]!.id;
  const realSourceId = transactions[0]!.sourceId;
  const typologyCorpusInput = corpus.sections.map((s) => ({ section: s.section, clauses: s.clauses }));
  const { getNotesForAccount } = await import("../src/data/overlayStore.ts");
  const notes = await getNotesForAccount(c.accountId);

  const evidenceInput = { caseId: c.caseId, accountId: c.accountId, transactions, notes };
  const evidenceOutput = { points: [{ text: "Evidence point.", sourceIds: [realSourceId] }] };
  seededKeys.push(
    await seedCassette("EvidenceSummary", EVIDENCE_PROMPT, buildEvidenceUserContent(evidenceInput), evidenceOutput),
  );

  const kycInput = { caseId: c.caseId, accountId: c.accountId, kycRecord, aggregates, patterns, stalenessDays };
  const kycOutput = {
    expectedActivity: "Volume roughly consistent with stated profile.",
    riskFactors: [],
    dataGaps: [],
    stalenessDays,
  };
  seededKeys.push(
    await seedCassette("CustomerProfileAssessment", KYC_PROMPT, buildKycUserContent(kycInput), kycOutput),
  );

  const typologyInput = {
    caseId: c.caseId,
    accountId: c.accountId,
    evidence: evidenceOutput,
    computations: [...aggregates, ...graph, ...patterns, ...sanctionsComputations],
    typologyCorpus: typologyCorpusInput,
  };
  const typologyOutput = {
    matches: [
      { ffiecClauseId: realClauseId, policyVersion: POLICY_VERSION, supportingSourceIds: [realSourceId], strength: "medium" as const },
    ],
    counterHypotheses: ["Plausible legitimate explanation."],
    dataGaps: [],
  };
  seededKeys.push(
    await seedCassette("TypologyAssessment", TYPOLOGY_PROMPT, buildTypologyUserContent(typologyInput), typologyOutput),
  );

  const verifierInput = {
    caseId: c.caseId,
    accountId: c.accountId,
    evidence: evidenceOutput,
    typologyAssessment: typologyOutput,
    computations: [...aggregates, ...graph, ...patterns, ...sanctionsComputations],
  };
  seededKeys.push(
    await seedCassette("VerificationResult", VERIFIER_PROMPT, buildVerifierUserContent(verifierInput), {
      checks: [],
      unsupportedClaims: [],
      recalcMismatches: [],
      verdict: "PASS",
    }),
  );

  const coordinatorInput = {
    caseId: c.caseId,
    accountId: c.accountId,
    evidence: evidenceOutput,
    kycAssessment: kycOutput,
    typologyAssessment: typologyOutput,
  };
  seededKeys.push(
    await seedCassette("CasePacket", COORDINATOR_PROMPT, buildCoordinatorUserContent(coordinatorInput), {
      summary: "Deterministic replay test summary.",
      findings: [{ text: "Finding.", sourceIds: [realSourceId] }],
      counterHypotheses: ["Plausible legitimate explanation."],
      recommendation: "INVESTIGATE_FURTHER",
      confidence: 0.65,
      blockingGaps: [],
    }),
  );

  return seededKeys;
}

describe("replay reproduces an identical packet", () => {
  test("running the same case twice from the same cassettes yields byte-identical output", async () => {
    const seededKeys = await seedFullRun(c001);

    _resetStoreForTests();
    const firstRun = await runCase({ caseId: c001.caseId, accountId: c001.accountId, useSlice: true });

    _resetStoreForTests();
    const secondRun = await runCase({ caseId: c001.caseId, accountId: c001.accountId, useSlice: true });

    expect(JSON.stringify(firstRun.casePacket)).toBe(JSON.stringify(secondRun.casePacket));
    expect(firstRun.state).toBe(secondRun.state);
    expect(JSON.stringify(firstRun.typologyAssessment)).toBe(JSON.stringify(secondRun.typologyAssessment));

    await removeCassettes(seededKeys);
  });
});

describe("a policy version bump invalidates the cassette key, never silently reusing a stale one", () => {
  test("the same prompt content under two different POLICY_VERSIONs produces two different cassette keys", () => {
    const shared = {
      model: MODEL_ID,
      system: "same system prompt",
      messages: [{ role: "user", content: "same content" }],
      schemaName: "SameSchema",
      promptVersion: PROMPT_VERSION,
      effort: AGENT_EFFORT,
    };
    const keyUnderCurrentPolicy = cassetteKey({ ...shared, policyVersion: POLICY_VERSION });
    const keyUnderBumpedPolicy = cassetteKey({ ...shared, policyVersion: `${POLICY_VERSION}-bumped` });
    expect(keyUnderCurrentPolicy).not.toBe(keyUnderBumpedPolicy);
  });
});
