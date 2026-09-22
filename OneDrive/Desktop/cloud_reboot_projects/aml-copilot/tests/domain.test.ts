import { describe, expect, test } from "bun:test";
import {
  SourceIdSchema,
  isRealSource,
  sourceLayer,
  TypologyAssessmentSchema,
  CasePacketSchema,
} from "../src/domain/index.ts";

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
