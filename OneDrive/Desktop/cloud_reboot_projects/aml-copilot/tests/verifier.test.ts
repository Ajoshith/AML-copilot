import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { computeAggregates } from "../src/analytics/aggregates.ts";
import { verifyDeterministic } from "../src/agents/verifier.ts";
import { loadTypologyCorpus } from "../src/policy/typologiesSchema.ts";
import { DATA_OVERLAY_DIR } from "../src/config.ts";
import type { EvidenceSummary, TypologyAssessment } from "../src/domain/agentOutputs.ts";
import type { SourceId } from "../src/domain/ids.ts";

_resetForTests();
await initDb({ useSlice: true });

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
  caseId: string;
  accountId: string;
}>;
const c001 = cases.find((c) => c.caseId === "C-001")!;

function baseEvidenceAndTypology(realSourceId: SourceId, realClauseId: string) {
  const evidence: EvidenceSummary = {
    points: [{ text: "A real finding", sourceIds: [realSourceId] }],
  };
  const typologyAssessment: TypologyAssessment = {
    matches: [
      {
        ffiecClauseId: realClauseId,
        policyVersion: "2026.09.0",
        supportingSourceIds: [realSourceId],
        strength: "medium",
      },
    ],
    counterHypotheses: ["A plausible innocent explanation"],
    dataGaps: [],
  };
  return { evidence, typologyAssessment };
}

describe("verifyDeterministic — the fail-closed deterministic pass (runs BEFORE the Coordinator drafts anything)", () => {
  test("PASSes when computations, source_ids and clause ids are all real and untampered", async () => {
    const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
    const corpus = await loadTypologyCorpus();
    const realClauseId = corpus.sections[0]!.clauses[0]!.id;
    const realSourceId = aggregates.find((a) => a.sourceIds.length > 0)!.sourceIds[0]!;

    const { evidence, typologyAssessment } = baseEvidenceAndTypology(realSourceId, realClauseId);
    const validSourceIds = new Set<SourceId>([realSourceId]);

    const result = await verifyDeterministic({
      accountId: c001.accountId,
      originalComputations: aggregates,
      validSourceIds,
      evidence,
      typologyAssessment,
      useSlice: true,
    });

    expect(result.verdict).toBe("PASS");
    expect(result.recalcMismatches).toEqual([]);
    expect(result.unsupportedSourceIds).toEqual([]);
    expect(result.unsupportedClauseIds).toEqual([]);
  });

  test("FAILs on a tampered computation value (recalculation mismatch)", async () => {
    const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
    const corpus = await loadTypologyCorpus();
    const realClauseId = corpus.sections[0]!.clauses[0]!.id;
    const realSourceId = aggregates.find((a) => a.sourceIds.length > 0)!.sourceIds[0]!;
    const { evidence, typologyAssessment } = baseEvidenceAndTypology(realSourceId, realClauseId);

    const tampered = aggregates.map((a) =>
      a.name === "txnCount" ? { ...a, value: (a.value as number) + 999 } : a,
    );

    const result = await verifyDeterministic({
      accountId: c001.accountId,
      originalComputations: tampered,
      validSourceIds: new Set([realSourceId]),
      evidence,
      typologyAssessment,
      useSlice: true,
    });

    expect(result.verdict).toBe("FAIL");
    expect(result.recalcMismatches.length).toBeGreaterThan(0);
  });

  test("FAILs on a cited source_id that doesn't resolve to anything real", async () => {
    const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
    const corpus = await loadTypologyCorpus();
    const realClauseId = corpus.sections[0]!.clauses[0]!.id;
    const fabricatedSourceId = "txn:ibm:HI-Small:99999999999" as SourceId;
    const { evidence, typologyAssessment } = baseEvidenceAndTypology(fabricatedSourceId, realClauseId);

    const result = await verifyDeterministic({
      accountId: c001.accountId,
      originalComputations: aggregates,
      validSourceIds: new Set<SourceId>(), // fabricated id is deliberately not in the valid set
      evidence,
      typologyAssessment,
      useSlice: true,
    });

    expect(result.verdict).toBe("FAIL");
    expect(result.unsupportedSourceIds).toContain(fabricatedSourceId);
  });

  test("FAILs on an invented FFIEC clause id not present in the real corpus", async () => {
    const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
    const realSourceId = aggregates.find((a) => a.sourceIds.length > 0)!.sourceIds[0]!;
    const inventedClauseId = "ffiec-appF:made-up-section:999";
    const { evidence, typologyAssessment } = baseEvidenceAndTypology(realSourceId, inventedClauseId);

    const result = await verifyDeterministic({
      accountId: c001.accountId,
      originalComputations: aggregates,
      validSourceIds: new Set([realSourceId]),
      evidence,
      typologyAssessment,
      useSlice: true,
    });

    expect(result.verdict).toBe("FAIL");
    expect(result.unsupportedClauseIds).toContain(inventedClauseId);
  });
});
