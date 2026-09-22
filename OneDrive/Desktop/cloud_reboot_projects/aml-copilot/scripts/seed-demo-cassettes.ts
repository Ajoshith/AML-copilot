/**
 * Seeds one plausible cassette set per mined case, so the full pipeline can be
 * demonstrated (API, UI) without live API credit. These are NOT a substitute
 * for real recorded model output — they exist purely to exercise the
 * deterministic plumbing (permission gate, verifier, state machine, UI) end to
 * end. Once real credit is available, re-run with AML_LLM_MODE=record against
 * `bun run src/orchestrator/pipeline.ts` (or the API's /run route) to replace
 * these with genuine model responses.
 */
import { readFile } from "node:fs/promises";
import { initDb } from "../src/data/loaders.ts";
import { getAccountTimeline } from "../src/analytics/timeline.ts";
import { computeAggregates } from "../src/analytics/aggregates.ts";
import { computeGraph } from "../src/analytics/graph.ts";
import { detectPatterns } from "../src/analytics/patterns.ts";
import { computeStalenessDays } from "../src/analytics/staleness.ts";
import { getKycRecord, getNotesForAccount, getAlertsForAccount } from "../src/data/overlayStore.ts";
import { loadTypologyCorpus } from "../src/policy/typologiesSchema.ts";
import { screenSanctions } from "../src/analytics/sanctionsMatch.ts";
import { buildEvidenceUserContent, SYSTEM_PROMPT as EVIDENCE_PROMPT } from "../src/agents/evidence.ts";
import { buildKycUserContent, SYSTEM_PROMPT as KYC_PROMPT } from "../src/agents/kyc.ts";
import { buildTypologyUserContent, SYSTEM_PROMPT as TYPOLOGY_PROMPT } from "../src/agents/typology.ts";
import { buildVerifierUserContent, SYSTEM_PROMPT as VERIFIER_PROMPT } from "../src/agents/verifier.ts";
import { buildCoordinatorUserContent, SYSTEM_PROMPT as COORDINATOR_PROMPT } from "../src/agents/coordinator.ts";
import { cassetteKey, writeCassette } from "../src/llm/cassette.ts";
import { MODEL_ID, AGENT_EFFORT, POLICY_VERSION, PROMPT_VERSION, DATA_OVERLAY_DIR } from "../src/config.ts";

async function seed(schemaName: string, systemPrompt: string, userContent: string, parsedOutput: unknown) {
  const key = cassetteKey({
    model: MODEL_ID,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
    schemaName,
    policyVersion: POLICY_VERSION,
    promptVersion: PROMPT_VERSION,
    effort: AGENT_EFFORT,
  });
  await writeCassette(key, { parsedOutput });
}

interface MinedCase {
  caseId: string;
  accountId: string;
  classification: string;
  isLaundering: boolean;
}

async function seedCase(c: MinedCase) {
  const transactions = await getAccountTimeline(c.accountId, { useSlice: true });
  const notes = await getNotesForAccount(c.accountId);
  const kycRecord = await getKycRecord(c.accountId);
  const aggregates = await computeAggregates(c.accountId, { useSlice: true });
  const graph = await computeGraph(c.accountId, { useSlice: true });
  const patterns = await detectPatterns(c.accountId, { useSlice: true });
  const alerts = await getAlertsForAccount(c.accountId);
  const asOf = alerts[0] ? new Date(alerts[0].firedAt) : new Date(0);
  const stalenessDays = computeStalenessDays(kycRecord?.lastReviewDate ?? null, asOf);
  const corpus = await loadTypologyCorpus();
  const realClauseId = corpus.sections[0]!.clauses[0]!.id;
  const realSourceId = transactions[0]?.sourceId;
  const typologyCorpusInput = corpus.sections.map((s) => ({ section: s.section, clauses: s.clauses }));

  const { result: sanctions, computations: sanctionsComputations } = await screenSanctions(
    kycRecord?.accountHolderName ?? c.accountId,
    { useSlice: true },
  );

  // --- Evidence (every case gets one) ---
  const evidenceInput = { caseId: c.caseId, accountId: c.accountId, transactions, notes };
  const evidencePoints = realSourceId
    ? [
        {
          text: c.isLaundering
            ? `Account shows activity across ${transactions.length} transactions with multiple counterparties, including cash and near-threshold amounts.`
            : `Account shows ordinary transaction activity across ${transactions.length} transactions.`,
          sourceIds: [realSourceId],
        },
      ]
    : [];
  await seed("EvidenceSummary", EVIDENCE_PROMPT, buildEvidenceUserContent(evidenceInput), { points: evidencePoints });

  if (sanctions.matched) {
    // Sanctions cases stop right after KYC — no typology/verifier/coordinator cassette needed.
    const kycInput = { caseId: c.caseId, accountId: c.accountId, kycRecord, aggregates, patterns, stalenessDays };
    await seed("CustomerProfileAssessment", KYC_PROMPT, buildKycUserContent(kycInput), {
      expectedActivity: "Not fully assessed — case routed to sanctions before typology review.",
      riskFactors: [],
      dataGaps: [],
      stalenessDays,
    });
    console.log(`  ${c.caseId}: seeded evidence + kyc (sanctions match halts the rest)`);
    return;
  }

  const kycInput = { caseId: c.caseId, accountId: c.accountId, kycRecord, aggregates, patterns, stalenessDays };
  const kycOutput = {
    expectedActivity: kycRecord
      ? `Computed activity ${c.isLaundering ? "diverges from" : "is broadly consistent with"} the stated profile.`
      : "No KYC profile on file.",
    riskFactors: c.isLaundering ? ["Volume exceeds stated expected activity"] : [],
    dataGaps: kycRecord?.occupation === null ? ["Occupation not on file", "No last review date on file"] : [],
    stalenessDays,
  };
  await seed("CustomerProfileAssessment", KYC_PROMPT, buildKycUserContent(kycInput), kycOutput);

  const evidenceForTypology = { points: evidencePoints };
  const typologyInput = {
    caseId: c.caseId,
    accountId: c.accountId,
    evidence: evidenceForTypology,
    computations: [...aggregates, ...graph, ...patterns, ...sanctionsComputations],
    typologyCorpus: typologyCorpusInput,
  };
  const typologyOutput = {
    matches:
      c.isLaundering && realSourceId
        ? [
            {
              ffiecClauseId: realClauseId,
              policyVersion: POLICY_VERSION,
              supportingSourceIds: [realSourceId],
              strength: "medium" as const,
            },
          ]
        : [],
    counterHypotheses: [
      c.isLaundering
        ? "Could reflect a legitimate cash-intensive small business with unverified occupation."
        : "Ordinary account activity with no red flags observed.",
    ],
    dataGaps: [],
  };
  await seed("TypologyAssessment", TYPOLOGY_PROMPT, buildTypologyUserContent(typologyInput), typologyOutput);

  const verifierInput = {
    caseId: c.caseId,
    accountId: c.accountId,
    evidence: evidenceForTypology,
    typologyAssessment: typologyOutput,
    computations: [...aggregates, ...graph, ...patterns, ...sanctionsComputations],
  };
  await seed("VerificationResult", VERIFIER_PROMPT, buildVerifierUserContent(verifierInput), {
    checks: [],
    unsupportedClaims: [],
    recalcMismatches: [],
    verdict: "PASS",
  });

  const coordinatorInput = {
    caseId: c.caseId,
    accountId: c.accountId,
    evidence: evidenceForTypology,
    kycAssessment: kycOutput,
    typologyAssessment: typologyOutput,
  };
  await seed("CasePacket", COORDINATOR_PROMPT, buildCoordinatorUserContent(coordinatorInput), {
    summary: c.isLaundering
      ? "Structuring-like activity observed; recommend further investigation before disposition."
      : "No suspicious activity identified; ordinary account behavior.",
    findings: evidencePoints,
    counterHypotheses: typologyOutput.counterHypotheses,
    recommendation: c.isLaundering ? "INVESTIGATE_FURTHER" : "CLOSE",
    confidence: c.isLaundering ? 0.65 : 0.9,
    blockingGaps: kycRecord?.occupation === null ? ["Occupation verification pending"] : [],
  });

  console.log(`  ${c.caseId}: seeded full 5-agent cassette set`);
}

async function main() {
  await initDb({ useSlice: true });
  const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as MinedCase[];
  console.log(`Seeding demo cassettes for ${cases.length} cases...`);
  for (const c of cases) {
    await seedCase(c);
  }
  console.log("Done. These are placeholder cassettes for demo purposes, not recorded model output.");
}

if (import.meta.main) {
  await main();
}
