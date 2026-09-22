import { describe, expect, test, beforeAll } from "bun:test";
import { readFile } from "node:fs/promises";
import { Elysia } from "elysia";
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
import { casesRoutes } from "../src/api/routes/cases.ts";
import { analystRoutes } from "../src/api/routes/analyst.ts";
import { _resetStoreForTests } from "../src/store/caseStore.ts";
import { POLICY_VERSION, DATA_OVERLAY_DIR } from "../src/config.ts";
import { seedCassette, removeCassettes } from "./helpers/seedCassette.ts";

_resetForTests();
await initDb({ useSlice: true });

const app = new Elysia().use(casesRoutes).use(analystRoutes);

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
  caseId: string;
  accountId: string;
}>;
const c001 = cases.find((c) => c.caseId === "C-001")!;

let seededKeys: string[] = [];

beforeAll(async () => {
  _resetStoreForTests();

  const transactions = await getAccountTimeline(c001.accountId, { useSlice: true });
  const notes = await getNotesForAccount(c001.accountId);
  const kycRecord = await getKycRecord(c001.accountId);
  const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
  const graph = await computeGraph(c001.accountId, { useSlice: true });
  const patterns = await detectPatterns(c001.accountId, { useSlice: true });
  const accountHolderName = kycRecord?.accountHolderName ?? c001.accountId;
  const { computations: sanctionsComputations } = await screenSanctions(accountHolderName, { useSlice: true });
  const alerts = await getAlertsForAccount(c001.accountId);
  const asOf = alerts[0] ? new Date(alerts[0].firedAt) : new Date(0);
  const stalenessDays = computeStalenessDays(kycRecord?.lastReviewDate ?? null, asOf);
  const corpus = await loadTypologyCorpus();
  const realClauseId = corpus.sections[0]!.clauses[0]!.id;
  const realSourceId = transactions[0]!.sourceId;
  const typologyCorpusInput = corpus.sections.map((s) => ({ section: s.section, clauses: s.clauses }));

  const evidenceInput = { caseId: c001.caseId, accountId: c001.accountId, transactions, notes };
  const evidenceOutput = { points: [{ text: "API test evidence point.", sourceIds: [realSourceId] }] };
  seededKeys.push(
    await seedCassette("EvidenceSummary", EVIDENCE_PROMPT, buildEvidenceUserContent(evidenceInput), evidenceOutput),
  );

  const kycInput = { caseId: c001.caseId, accountId: c001.accountId, kycRecord, aggregates, patterns, stalenessDays };
  const kycOutput = {
    expectedActivity: "ok",
    riskFactors: [],
    dataGaps: [],
    stalenessDays,
  };
  seededKeys.push(
    await seedCassette("CustomerProfileAssessment", KYC_PROMPT, buildKycUserContent(kycInput), kycOutput),
  );

  const typologyInput = {
    caseId: c001.caseId,
    accountId: c001.accountId,
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
    caseId: c001.caseId,
    accountId: c001.accountId,
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
    caseId: c001.caseId,
    accountId: c001.accountId,
    evidence: evidenceOutput,
    kycAssessment: kycOutput,
    typologyAssessment: typologyOutput,
  };
  seededKeys.push(
    await seedCassette("CasePacket", COORDINATOR_PROMPT, buildCoordinatorUserContent(coordinatorInput), {
      summary: "API test summary.",
      findings: [{ text: "Finding.", sourceIds: [realSourceId] }],
      counterHypotheses: ["Plausible legitimate explanation."],
      recommendation: "INVESTIGATE_FURTHER",
      confidence: 0.7,
      blockingGaps: [],
    }),
  );
});

function req(method: string, path: string, opts: { role?: string; analystId?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.role) headers["x-role"] = opts.role;
  if (opts.analystId) headers["x-analyst-id"] = opts.analystId;
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

describe("POST /cases/:id/run", () => {
  test("readonly role cannot start a run (403)", async () => {
    const res = await req("POST", `/cases/${c001.caseId}/run`, { body: { accountId: c001.accountId } });
    expect(res.status).toBe(403);
  });

  test("analyst role runs the case to AWAITING_ANALYST", async () => {
    const res = await req("POST", `/cases/${c001.caseId}/run`, {
      role: "analyst",
      body: { accountId: c001.accountId },
    });
    const json = (await res.json()) as { state: string };
    expect(res.status).toBe(200);
    expect(json.state).toBe("AWAITING_ANALYST");
  });
});

describe("GET /cases/:id/packet", () => {
  test("readonly role is denied packet content (403)", async () => {
    const res = await req("GET", `/cases/${c001.caseId}/packet`);
    expect(res.status).toBe(403);
  });

  test("analyst role sees the full packet", async () => {
    const res = await req("GET", `/cases/${c001.caseId}/packet`, { role: "analyst" });
    const json = (await res.json()) as { casePacket: { recommendation: string } };
    expect(res.status).toBe(200);
    expect(json.casePacket.recommendation).toBe("INVESTIGATE_FURTHER");
  });
});

describe("POST /cases/:id/analyst/decision — the hard stop", () => {
  test("missing X-Analyst-Id is rejected (401)", async () => {
    const res = await req("POST", `/cases/${c001.caseId}/analyst/decision`, {
      role: "analyst",
      body: { disposition: "CLOSE", rationale: "test" },
    });
    expect(res.status).toBe(401);
  });

  test("a non-analyst role is rejected (403) even with an analyst id present", async () => {
    const res = await req("POST", `/cases/${c001.caseId}/analyst/decision`, {
      role: "sanctions",
      analystId: "alice",
      body: { disposition: "CLOSE", rationale: "test" },
    });
    expect(res.status).toBe(403);
  });

  test("disagreeing with the AI recommendation without overrideReason is rejected (400)", async () => {
    const res = await req("POST", `/cases/${c001.caseId}/analyst/decision`, {
      role: "analyst",
      analystId: "alice",
      body: { disposition: "CLOSE", rationale: "test" },
    });
    expect(res.status).toBe(400);
  });

  test("a valid decision with overrideReason succeeds and closes the case to QA", async () => {
    const res = await req("POST", `/cases/${c001.caseId}/analyst/decision`, {
      role: "analyst",
      analystId: "alice",
      body: {
        disposition: "CLOSE",
        rationale: "Reviewed evidence — benign business activity.",
        overrideReason: "AI flagged further investigation but KYC supports legitimate business",
      },
    });
    const json = (await res.json()) as { state: string; matchedAiRecommendation: boolean };
    expect(res.status).toBe(200);
    expect(json.state).toBe("QA");
    expect(json.matchedAiRecommendation).toBe(false);
  });

  test("a second decision on the same case is rejected (409) — no re-deciding", async () => {
    const res = await req("POST", `/cases/${c001.caseId}/analyst/decision`, {
      role: "analyst",
      analystId: "alice",
      body: { disposition: "CLOSE", rationale: "second attempt" },
    });
    expect(res.status).toBe(409);
  });
});

describe("no filing-shaped route exists", () => {
  test.each(["file-sar", "submit-sar", "close-account", "block-funds"])("POST /cases/:id/%s -> 404", async (path) => {
    const res = await req("POST", `/cases/${c001.caseId}/${path}`, { role: "analyst", body: {} });
    expect(res.status).toBe(404);
  });
});

describe("cleanup", () => {
  test("remove seeded cassettes", async () => {
    await removeCassettes(seededKeys);
    expect(true).toBe(true);
  });
});
