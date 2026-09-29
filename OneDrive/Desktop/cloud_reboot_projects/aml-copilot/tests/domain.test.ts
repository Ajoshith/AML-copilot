import { describe, expect, test } from "bun:test";
import {
  SourceIdSchema,
  isRealSource,
  sourceLayer,
  TypologyAssessmentSchema,
  CasePacketSchema,
} from "../src/domain/index.ts";
import { riskRatingFor } from "../src/data/riskRating.ts";

describe("SourceIdSchema", () => {
  test("accepts a real transaction source id", () => {
    const id = "txn:ibm:HI-Small:4412903";
    expect(SourceIdSchema.parse(id)).toBe(id);
    expect(sourceLayer(id)).toBe("txn");
    expect(isRealSource(id)).toBe(true);
  });

  test("accepts an overlay kyc source id and flags it as non-real", () => {
    const id = "kyc:overlay:ACC-8347:v3";
    expect(SourceIdSchema.parse(id)).toBe(id);
    expect(isRealSource(id)).toBe(false);
  });

  test("rejects a malformed source id", () => {
    expect(() => SourceIdSchema.parse("not-a-source-id")).toThrow();
  });
});

describe("TypologyAssessmentSchema", () => {
  test("rejects zero counter-hypotheses", () => {
    const result = TypologyAssessmentSchema.safeParse({
      matches: [],
      counterHypotheses: [],
      dataGaps: [],
    });
    expect(result.success).toBe(false);
  });

  test("accepts at least one counter-hypothesis", () => {
    const result = TypologyAssessmentSchema.safeParse({
      matches: [
        {
          ffiecClauseId: "ffiec-appF:structuring:3",
          policyVersion: "2026.09.0",
          supportingSourceIds: ["txn:ibm:HI-Small:1"],
          strength: "high",
        },
      ],
      counterHypotheses: ["Cash-intensive small business, consistent with stated occupation."],
      dataGaps: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("CasePacketSchema", () => {
  test("requires at least one counter-hypothesis on the final packet too", () => {
    const result = CasePacketSchema.safeParse({
      summary: "test",
      findings: [],
      counterHypotheses: [],
      recommendation: "CONSIDER_SAR",
      confidence: 0.8,
      blockingGaps: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("KYC risk rating is independent of the ground-truth label", () => {
  const load = async <T>(name: string) => JSON.parse(await Bun.file(`data/overlay/${name}.json`).text()) as T;

  test("every committed KYC record carries the rating its own attributes produce", async () => {
    const kyc = await load<Array<{ accountId: string; occupation: string | null; businessType: string | null; riskRating: string }>>("kyc");
    expect(kyc.length).toBeGreaterThan(0);
    for (const r of kyc) {
      expect(r.riskRating, `account ${r.accountId}`).toBe(riskRatingFor(r));
    }
  });

  test("the rating cannot be used to read off the label", async () => {
    const kyc = await load<Array<{ accountId: string; riskRating: string }>>("kyc");
    const cases = await load<Array<{ accountId: string; isLaundering: boolean }>>("cases");
    const labelled = new Set(cases.filter((c) => c.isLaundering).map((c) => c.accountId));
    const laundering = kyc.filter((r) => labelled.has(r.accountId));
    const clean = kyc.filter((r) => !labelled.has(r.accountId));
    expect(laundering.length).toBeGreaterThan(0);
    expect(clean.length).toBeGreaterThan(0);
    // The old rule rated every labelled-laundering account "high". Neither direction may hold now.
    expect(laundering.some((r) => r.riskRating !== "high")).toBe(true);
    expect(clean.some((r) => r.riskRating === "high")).toBe(true);
  });

  test("scores static onboarding attributes only, and an unratable profile defaults to high", () => {
    expect(riskRatingFor({ occupation: null, businessType: null })).toBe("high");
    expect(riskRatingFor({ occupation: "Restaurant owner", businessType: null })).toBe("high");
    expect(riskRatingFor({ occupation: "Freelance graphic designer", businessType: "Individual" })).toBe("low");
    expect(riskRatingFor({ occupation: "Retail shop manager", businessType: "Individual" })).toBe("medium");
    expect(riskRatingFor({ occupation: "Restaurant owner", businessType: "Sole proprietorship" })).toBe("high");
    // Its parameter type has no label or classification field to depend on.
    expect(riskRatingFor.length).toBe(1);
  });
});
