import type { CaseState } from "../domain/case.ts";
import type {
  EvidenceSummary,
  CustomerProfileAssessment,
  TypologyAssessment,
  CasePacket,
  VerificationResult,
} from "../domain/agentOutputs.ts";
import type { SanctionsMatchResult } from "../analytics/sanctionsMatch.ts";
import type { Computation } from "../domain/computation.ts";
import type { AnalystDecision } from "../domain/case.ts";

/**
 * In-memory, case-scoped store. This holds two distinct kinds of state:
 *
 *  1. The orchestrator's working state (accountId, current pipeline state, each
 *     agent's output, the disposition) — written only by orchestrator/pipeline.ts.
 *
 *  2. AI drafts, research tasks and the official disposition record — the ONLY
 *     surfaces `DRAFT` and `SOR_WRITE` tool handlers may write to. `DRAFT` writes
 *     land in `aiDrafts`, never `officialRecord`; `officialRecord` is only ever
 *     touched via `updateCaseStatus`, which the permission gate has already
 *     required a valid SOR_WRITE credential for by the time a handler reaches
 *     this store.
 *
 * A real deployment would back this with the bank's actual case-management
 * system; this in-memory version is enough to prove the write-segregation and
 * state-machine properties in the prototype and its tests.
 */

export interface ResearchTask {
  id: string;
  reason: string;
  createdAt: string;
}

export interface CaseRecord {
  caseId: string;
  accountId: string | null;
  state: CaseState | null;
  evidence: EvidenceSummary | null;
  kycAssessment: CustomerProfileAssessment | null;
  sanctionsResult: SanctionsMatchResult | null;
  computations: Computation[];
  typologyAssessment: TypologyAssessment | null;
  verification: VerificationResult | null;
  casePacket: CasePacket | null;
  disposition: AnalystDecision | null;
  aiDrafts: {
    notes: string[];
    narratives: string[];
  };
  researchTasks: ResearchTask[];
  officialRecord: {
    status: string | null;
  };
}

const cases = new Map<string, CaseRecord>();

function getOrCreate(caseId: string): CaseRecord {
  let record = cases.get(caseId);
  if (!record) {
    record = {
      caseId,
      accountId: null,
      state: null,
      evidence: null,
      kycAssessment: null,
      sanctionsResult: null,
      computations: [],
      typologyAssessment: null,
      verification: null,
      casePacket: null,
      disposition: null,
      aiDrafts: { notes: [], narratives: [] },
      researchTasks: [],
      officialRecord: { status: null },
    };
    cases.set(caseId, record);
  }
  return record;
}

export function addDraftNote(caseId: string, text: string): void {
  getOrCreate(caseId).aiDrafts.notes.push(text);
}

export function addDraftNarrative(caseId: string, text: string): void {
  getOrCreate(caseId).aiDrafts.narratives.push(text);
}

export function addResearchTask(caseId: string, reason: string): ResearchTask {
  const task: ResearchTask = { id: `task-${crypto.randomUUID()}`, reason, createdAt: new Date().toISOString() };
  getOrCreate(caseId).researchTasks.push(task);
  return task;
}

export function setOfficialStatus(caseId: string, status: string): void {
  getOrCreate(caseId).officialRecord.status = status;
}

export function getCaseRecord(caseId: string): CaseRecord {
  return getOrCreate(caseId);
}

/** Applies a partial update to a case's orchestration-owned fields. Only
 * orchestrator/pipeline.ts should call this — it is not a tool handler surface. */
export function updateCaseRecord(caseId: string, patch: Partial<Omit<CaseRecord, "caseId">>): CaseRecord {
  const record = getOrCreate(caseId);
  Object.assign(record, patch);
  return record;
}

/** Test-only: clears all in-memory case state between test runs. */
export function _resetStoreForTests(): void {
  cases.clear();
}
