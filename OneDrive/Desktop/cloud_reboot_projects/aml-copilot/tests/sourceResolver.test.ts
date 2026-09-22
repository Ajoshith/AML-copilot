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
import { resolveSource, collectCitedSourceIds } from "../src/data/sourceResolver.ts";
import { buildEvidenceUserContent, SYSTEM_PROMPT as EVIDENCE_PROMPT } from "../src/agents/evidence.ts";
import { buildKycUserContent, SYSTEM_PROMPT as KYC_PROMPT } from "../src/agents/kyc.ts";
import { buildTypologyUserContent, SYSTEM_PROMPT as TYPOLOGY_PROMPT } from "../src/agents/typology.ts";
import { buildVerifierUserContent, SYSTEM_PROMPT as VERIFIER_PROMPT } from "../src/agents/verifier.ts";
import { buildCoordinatorUserContent, SYSTEM_PROMPT as COORDINATOR_PROMPT } from "../src/agents/coordinator.ts";
import { runCase } from "../src/orchestrator/pipeline.ts";
import { casesRoutes } from "../src/api/routes/cases.ts";
import { _resetStoreForTests } from "../src/store/caseStore.ts";
import { POLICY_VERSION, DATA_OVERLAY_DIR } from "../src/config.ts";
import { seedCassette, removeCassettes } from "./helpers/seedCassette.ts";

_resetForTests();
await initDb({ useSlice: true });

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
  caseId: string;
  accountId: string;
}>;
const c001 = cases.find((c) => c.caseId === "C-001")!;

describe("resolveSource — unit, direct against real data", () => {
  test("resolves a real transaction row (txn: layer)", async () => {
    const transactions = await getAccountTimeline(c001.accountId, { useSlice: true });
    const realSourceId = transactions[0]!.sourceId;
    const resolved = await resolveSource(realSourceId, { accountId: c001.accountId, useSlice: true });
    expect(resolved?.layer).toBe("txn");
    if (resolved?.layer === "txn") {
      expect(resolved.transaction.sourceId).toBe(realSourceId);
    }
  });

  test("resolves a real OFAC SDN entry (sdn: layer)", async () => {
    const { result } = await screenSanctions("COMERCIALIZADORA DE CAFE DEL OCCIDENTE CODECAFE LTDA.", {
      useSlice: true,
    });
    expect(result.matched).toBe(true);
    const resolved = await resolveSource(result.sourceId!, { accountId: c001.accountId, useSlice: true });
    expect(resolved?.layer).toBe("sdn");
    if (resolved?.layer === "sdn") {
      expect(resolved.sdnName.length).toBeGreaterThan(0);
    }
  });

  test("resolves the case's own KYC record (kyc: layer)", async () => {
    const kyc = await getKycRecord(c001.accountId);
    expect(kyc).not.toBeNull();
    const resolved = await resolveSource(kyc!.sourceId, { accountId: c001.accountId, useSlice: true });
    expect(resolved?.layer).toBe("kyc");
  });

  test("resolves the case's own alert (alert: layer)", async () => {
    const alerts = await getAlertsForAccount(c001.accountId);
    expect(alerts.length).toBeGreaterThan(0);
    const resolved = await resolveSource(alerts[0]!.sourceId, { accountId: c001.accountId, useSlice: true });
    expect(resolved?.layer).toBe("alert");
  });

  test("resolves the case's own note (note: layer)", async () => {
    const notes = await getNotesForAccount(c001.accountId);
    expect(notes.length).toBeGreaterThan(0);
    const resolved = await resolveSource(notes[0]!.sourceId, { accountId: c001.accountId, useSlice: true });
    expect(resolved?.layer).toBe("note");
  });

  test("resolves a real FFIEC clause via the client-side policy: convention (policy: layer)", async () => {
    const corpus = await loadTypologyCorpus();
    const realClauseId = corpus.sections[0]!.clauses[0]!.id;
    const resolved = await resolveSource(`policy:${realClauseId}`, { accountId: c001.accountId, useSlice: true });
    expect(resolved?.layer).toBe("policy");
    if (resolved?.layer === "policy") {
      expect(resolved.clause.id).toBe(realClauseId);
      expect(resolved.clause.text.length).toBeGreaterThan(0);
    }
  });

  test("returns null for a well-formed but unresolvable id", async () => {
    const resolved = await resolveSource("txn:ibm:HI-Small:999999999", {
      accountId: c001.accountId,
      useSlice: true,
    });
    expect(resolved).toBeNull();
  });

  test("returns null for an unknown layer prefix", async () => {
    const resolved = await resolveSource("bogus:layer:1", { accountId: c001.accountId, useSlice: true });
    expect(resolved).toBeNull();
  });
});

describe("GET /cases/:id/sources — the actual access control", () => {
  const app = new Elysia().use(casesRoutes);
  let seededKeys: string[] = [];
  let realTxnSourceId: string;
  let realClauseId: string;

  function req(path: string, opts: { role?: string } = {}) {
    const headers: Record<string, string> = {};
    if (opts.role) headers["x-role"] = opts.role;
    return app.handle(new Request(`http://localhost${path}`, { headers }));
  }

  beforeAll(async () => {
    _resetStoreForTests();
    seededKeys = [];

    const transactions = await getAccountTimeline(c001.accountId, { useSlice: true });
    const notes = await getNotesForAccount(c001.accountId);
    const kycRecord = await getKycRecord(c001.accountId);
    const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
    const graph = await computeGraph(c001.accountId, { useSlice: true });
    const patterns = await detectPatterns(c001.accountId, { useSlice: true });
    const { computations: sanctionsComputations } = await screenSanctions(
      kycRecord?.accountHolderName ?? c001.accountId,
      { useSlice: true },
    );
    const alerts = await getAlertsForAccount(c001.accountId);
    const asOf = alerts[0] ? new Date(alerts[0].firedAt) : new Date(0);
    const stalenessDays = computeStalenessDays(kycRecord?.lastReviewDate ?? null, asOf);
    const corpus = await loadTypologyCorpus();
    realClauseId = corpus.sections[0]!.clauses[0]!.id;
    realTxnSourceId = transactions[0]!.sourceId;
    const typologyCorpusInput = corpus.sections.map((s) => ({ section: s.section, clauses: s.clauses }));

    const evidenceInput = { caseId: c001.caseId, accountId: c001.accountId, transactions, notes };
    const evidenceOutput = { points: [{ text: "Source resolver test evidence.", sourceIds: [realTxnSourceId] }] };
    seededKeys.push(
      await seedCassette("EvidenceSummary", EVIDENCE_PROMPT, buildEvidenceUserContent(evidenceInput), evidenceOutput),
    );

    const kycInput = { caseId: c001.caseId, accountId: c001.accountId, kycRecord, aggregates, patterns, stalenessDays };
    const kycOutput = { expectedActivity: "ok", riskFactors: [], dataGaps: [], stalenessDays };
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
        { ffiecClauseId: realClauseId, policyVersion: POLICY_VERSION, supportingSourceIds: [realTxnSourceId], strength: "medium" as const },
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
        summary: "Test summary.",
        findings: [{ text: "Finding.", sourceIds: [realTxnSourceId] }],
        counterHypotheses: ["Plausible legitimate explanation."],
        recommendation: "INVESTIGATE_FURTHER",
        confidence: 0.6,
        blockingGaps: [],
      }),
    );

    await runCase({ caseId: c001.caseId, accountId: c001.accountId, useSlice: true });
  });

  test("readonly role is refused (403) regardless of citation", async () => {
    const res = await req(`/cases/${c001.caseId}/sources?id=${encodeURIComponent(realTxnSourceId)}`, {
      role: "readonly",
    });
    expect(res.status).toBe(403);
  });

  test("a cited real transaction resolves for an analyst (200)", async () => {
    const res = await req(`/cases/${c001.caseId}/sources?id=${encodeURIComponent(realTxnSourceId)}`, {
      role: "analyst",
    });
    const json = (await res.json()) as { layer: string; transaction?: { sourceId: string } };
    expect(res.status).toBe(200);
    expect(json.layer).toBe("txn");
    expect(json.transaction?.sourceId).toBe(realTxnSourceId);
  });

  test("a cited FFIEC clause resolves via the policy: convention (200)", async () => {
    const res = await req(`/cases/${c001.caseId}/sources?id=${encodeURIComponent(`policy:${realClauseId}`)}`, {
      role: "analyst",
    });
    const json = (await res.json()) as { layer: string; clause?: { id: string } };
    expect(res.status).toBe(200);
    expect(json.layer).toBe("policy");
    expect(json.clause?.id).toBe(realClauseId);
  });

  test("a real but UNCITED transaction from another account is refused (403) — the actual access control", async () => {
    const otherCase = cases.find((c) => c.caseId !== "C-001")!;
    const otherTransactions = await getAccountTimeline(otherCase.accountId, { useSlice: true });
    const foreignSourceId = otherTransactions[0]!.sourceId;

    const res = await req(`/cases/${c001.caseId}/sources?id=${encodeURIComponent(foreignSourceId)}`, {
      role: "analyst",
    });
    const json = (await res.json()) as { error: string };
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/not cited/i);
  });

  test("missing ?id query param is a 400", async () => {
    const res = await req(`/cases/${c001.caseId}/sources`, { role: "analyst" });
    expect(res.status).toBe(400);
  });

  test("cleanup", async () => {
    await removeCassettes(seededKeys);
    expect(true).toBe(true);
  });
});

describe("collectCitedSourceIds", () => {
  test("includes evidence, typology (with the policy: prefix), computation and packet source ids", async () => {
    const fakeRecord = {
      caseId: "FAKE",
      accountId: null,
      state: null,
      evidence: { points: [{ text: "x", sourceIds: ["txn:a:1"] }] },
      kycAssessment: null,
      sanctionsResult: { matched: false, sourceId: null, matchedName: null, program: null, score: 0, listVersion: "v1" },
      computations: [{ name: "c", value: 1, inputsHash: "h", sourceIds: ["txn:a:2"], codeVersion: "1.0.0" }],
      typologyAssessment: {
        matches: [{ ffiecClauseId: "ffiec-appF:x:1", policyVersion: "v1", supportingSourceIds: ["txn:a:3"], strength: "low" as const }],
        counterHypotheses: ["h"],
        dataGaps: [],
      },
      verification: null,
      casePacket: { summary: "s", findings: [{ text: "f", sourceIds: ["txn:a:4"] }], counterHypotheses: ["h"], recommendation: "CLOSE" as const, confidence: 0.5, blockingGaps: [] },
      disposition: null,
      aiDrafts: { notes: [], narratives: [] },
      researchTasks: [],
      officialRecord: { status: null },
    };

    const ids = await collectCitedSourceIds(fakeRecord);
    expect(ids.has("txn:a:1")).toBe(true);
    expect(ids.has("txn:a:2")).toBe(true);
    expect(ids.has("txn:a:3")).toBe(true);
    expect(ids.has("txn:a:4")).toBe(true);
    expect(ids.has("policy:ffiec-appF:x:1")).toBe(true);
    expect(ids.has("txn:not-cited:1")).toBe(false);
  });
});
