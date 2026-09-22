import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { getAccountTimeline } from "../src/analytics/timeline.ts";
import { computeAggregates } from "../src/analytics/aggregates.ts";
import { computeGraph } from "../src/analytics/graph.ts";
import { detectPatterns } from "../src/analytics/patterns.ts";
import { computeStalenessDays } from "../src/analytics/staleness.ts";
import { screenSanctions } from "../src/analytics/sanctionsMatch.ts";
import { getKycRecord, getNotesForAccount, getAlertsForAccount } from "../src/data/overlayStore.ts";
import { loadTypologyCorpus } from "../src/policy/typologiesSchema.ts";
import { buildEvidenceUserContent, SYSTEM_PROMPT as EVIDENCE_PROMPT } from "../src/agents/evidence.ts";
import { buildKycUserContent, SYSTEM_PROMPT as KYC_PROMPT } from "../src/agents/kyc.ts";
import { buildTypologyUserContent, SYSTEM_PROMPT as TYPOLOGY_PROMPT } from "../src/agents/typology.ts";
import { buildVerifierUserContent, SYSTEM_PROMPT as VERIFIER_PROMPT } from "../src/agents/verifier.ts";
import { buildCoordinatorUserContent, SYSTEM_PROMPT as COORDINATOR_PROMPT } from "../src/agents/coordinator.ts";
import { runCase } from "../src/orchestrator/pipeline.ts";
import { assertTransition, IllegalTransitionError } from "../src/orchestrator/state.ts";
import { getCaseRecord, _resetStoreForTests } from "../src/store/caseStore.ts";
import { POLICY_VERSION, DATA_OVERLAY_DIR, ROOT_DIR } from "../src/config.ts";
import { seedCassette, removeCassettes } from "./helpers/seedCassette.ts";

_resetForTests();
await initDb({ useSlice: true });

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
  caseId: string;
  accountId: string;
}>;
const c001 = cases.find((c) => c.caseId === "C-001")!;
const c005 = cases.find((c) => c.caseId === "C-005")!; // sanctions match — benign, unlabelled account

describe("no filing capability exists in the codebase", () => {
  test("the tool registry file contains no filing verb by name", () => {
    const registrySource = readFileSync(`${ROOT_DIR}/src/tools/registry.ts`, "utf8");
    for (const forbidden of ["fileSar", "submitSar", "denyCoverage", "blockFunds", "closeAccount"]) {
      expect(registrySource).not.toContain(forbidden);
    }
  });

  test("no source file under src/ contains a filing-verb function name", () => {
    const forbidden = /\b(fileSar|submitSar|fileSAR|submitSAR)\b/;
    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith(".ts")) out.push(full);
      }
      return out;
    }
    for (const file of walk(`${ROOT_DIR}/src`)) {
      const source = readFileSync(file, "utf8");
      expect(forbidden.test(source)).toBe(false);
    }
  });
});

describe("state machine hard stop", () => {
  test("AWAITING_ANALYST cannot transition directly to QA, skipping DISPOSITION_RECORDED", () => {
    expect(() => assertTransition("AWAITING_ANALYST", "QA")).toThrow(IllegalTransitionError);
  });

  test("AWAITING_ANALYST -> DISPOSITION_RECORDED is the only legal exit", () => {
    expect(() => assertTransition("AWAITING_ANALYST", "DISPOSITION_RECORDED")).not.toThrow();
  });

  test("no state has a transition directly into DISPOSITION_RECORDED except AWAITING_ANALYST", async () => {
    const source = await (await import("node:fs/promises")).readFile(
      `${ROOT_DIR}/src/orchestrator/state.ts`,
      "utf8",
    );
    const lines = source.split("\n").filter((l) => l.includes('"DISPOSITION_RECORDED"'));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("AWAITING_ANALYST:");
  });
});

/** Runs the mined case's real data through every step, seeding one cassette per
 * agent call so the whole orchestrator runs offline. Every input to seedCassette
 * is built with the SAME functions runCase() itself calls internally, so there is
 * no risk of the seeded key drifting from what the pipeline actually requests. */
async function seedFullRun(c: { caseId: string; accountId: string }) {
  const seededKeys: string[] = [];

  const transactions = await getAccountTimeline(c.accountId, { useSlice: true });
  const notes = await getNotesForAccount(c.accountId);
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
  const realSourceId = transactions[0]?.sourceId;
  const typologyCorpusInput = corpus.sections.map((s) => ({ section: s.section, clauses: s.clauses }));

  const evidenceInput = { caseId: c.caseId, accountId: c.accountId, transactions, notes };
  const evidenceOutput = { points: realSourceId ? [{ text: "Evidence point.", sourceIds: [realSourceId] }] : [] };
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
    matches: realSourceId
      ? [
          {
            ffiecClauseId: realClauseId,
            policyVersion: POLICY_VERSION,
            supportingSourceIds: [realSourceId],
            strength: "medium" as const,
          },
        ]
      : [],
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
      summary: "Test summary.",
      findings: realSourceId ? [{ text: "Finding.", sourceIds: [realSourceId] }] : [],
      counterHypotheses: ["Plausible legitimate explanation."],
      recommendation: "INVESTIGATE_FURTHER",
      confidence: 0.6,
      blockingGaps: [],
    }),
  );

  return seededKeys;
}

describe("runCase halts at AWAITING_ANALYST and cannot be silently re-driven", () => {
  test("a full run reaches AWAITING_ANALYST and stops there", async () => {
    _resetStoreForTests();
    const seededKeys = await seedFullRun(c001);

    const record = await runCase({ caseId: c001.caseId, accountId: c001.accountId, useSlice: true });
    expect(record.state).toBe("AWAITING_ANALYST");
    expect(record.casePacket).not.toBeNull();

    await removeCassettes(seededKeys);
  });

  test("re-running an already-AWAITING_ANALYST case throws instead of silently re-progressing it", async () => {
    _resetStoreForTests();
    const seededKeys = await seedFullRun(c001);

    await runCase({ caseId: c001.caseId, accountId: c001.accountId, useSlice: true });
    expect(getCaseRecord(c001.caseId).state).toBe("AWAITING_ANALYST");

    // A second run tries to re-ingest (INGESTED), which is not a legal
    // transition from AWAITING_ANALYST — the only legal exit is
    // DISPOSITION_RECORDED, driven only by an authenticated analyst decision.
    await expect(runCase({ caseId: c001.caseId, accountId: c001.accountId, useSlice: true })).rejects.toThrow(
      IllegalTransitionError,
    );

    await removeCassettes(seededKeys);
  });
});

describe("sanctions escalation halts the AML pipeline entirely", () => {
  test("a sanctions-matched account routes to ESCALATED_SANCTIONS with no casePacket ever produced", async () => {
    _resetStoreForTests();
    const seededKeys = await seedFullRun(c005);

    const record = await runCase({ caseId: c005.caseId, accountId: c005.accountId, useSlice: true });

    expect(record.state).toBe("ESCALATED_SANCTIONS");
    expect(record.casePacket).toBeNull();
    expect(record.typologyAssessment).toBeNull(); // never reached — pipeline halted before TYPOLOGY
    expect(record.sanctionsResult?.matched).toBe(true);

    await removeCassettes(seededKeys);
  });
});
