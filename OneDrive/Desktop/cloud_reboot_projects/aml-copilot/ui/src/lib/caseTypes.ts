export interface Computation {
  name: string;
  value: unknown;
  sourceIds: string[];
}

export interface CaseRecordShape {
  caseId: string;
  accountId: string | null;
  state: string | null;
  evidence: { points: { text: string; sourceIds: string[] }[] } | null;
  kycAssessment: {
    expectedActivity: string;
    riskFactors: string[];
    dataGaps: string[];
    stalenessDays: number | null;
  } | null;
  sanctionsResult: {
    matched: boolean;
    matchedName: string | null;
    score: number;
    sourceId: string | null;
    program?: string | null;
    listVersion?: string | Date;
  } | null;
  computations: Computation[];
  typologyAssessment: {
    matches: { ffiecClauseId: string; policyVersion?: string; strength: string; supportingSourceIds: string[] }[];
    counterHypotheses: string[];
    dataGaps: string[];
  } | null;
  verification: {
    verdict: "PASS" | "FAIL";
    checks: { claim: string; sourceId?: string; status: string }[];
    unsupportedClaims: string[];
    recalcMismatches: string[];
  } | null;
  casePacket: {
    summary: string;
    findings: { text: string; sourceIds: string[] }[];
    counterHypotheses: string[];
    recommendation: string;
    confidence: number;
    blockingGaps: string[];
  } | null;
  disposition: { analystId: string; disposition: string; rationale: string; overrideReason?: string } | null;
}

/** Mirrors ResolvedSource in src/data/sourceResolver.ts. */
export type ResolvedSourceData =
  | {
      sourceId: string;
      layer: "txn";
      transaction: {
        timestamp: string;
        fromBank: string;
        fromAccount: string;
        toBank: string;
        toAccount: string;
        amountPaid: number;
        paymentCurrency: string;
        amountReceived: number;
        receivingCurrency: string;
        paymentFormat: string;
        isLaundering: boolean;
      };
    }
  | { sourceId: string; layer: "sdn"; entNum: string; sdnName: string; program: string }
  | {
      sourceId: string;
      layer: "kyc";
      record: {
        accountHolderName: string;
        occupation: string | null;
        businessType: string | null;
        riskRating: string;
        lastReviewDate: string | null;
        jurisdiction: string;
      };
    }
  | { sourceId: string; layer: "alert"; record: { ruleId: string; ruleVersion: string; firedAt: string; dueDate: string } }
  | { sourceId: string; layer: "note"; record: { text: string } }
  | { sourceId: string; layer: "policy"; clause: { id: string; text: string } };
