import { getAccountTimeline } from "../analytics/timeline.ts";
import { computeAggregates as computeAggregatesAnalytics } from "../analytics/aggregates.ts";
import { computeGraph as computeGraphAnalytics } from "../analytics/graph.ts";
import { detectPatterns as detectPatternsAnalytics } from "../analytics/patterns.ts";
import { screenSanctions as screenSanctionsAnalytics } from "../analytics/sanctionsMatch.ts";
import { getKycRecord, getAlertsForAccount } from "../data/overlayStore.ts";
import { loadTypologyCorpus, type TypologyClause } from "../policy/typologiesSchema.ts";
import { addDraftNote, addDraftNarrative, addResearchTask, setOfficialStatus } from "../store/caseStore.ts";

/**
 * Handler implementations, one per tool in the registry. Every handler is plain
 * TypeScript — no LLM call ever appears here. Handlers only ever read real data
 * (transactions/KYC/alerts/policy), compute deterministically, or write to the
 * narrow surfaces the permission gate has already authorized (aiDrafts / research
 * tasks / official status). Each takes exactly one input object, matching the
 * shape Claude's tool_use delivers a single JSON object per call.
 */

export async function getAlert(input: { accountId: string }) {
  return getAlertsForAccount(input.accountId);
}

export async function getTransactions(input: { accountId: string; useSlice?: boolean }) {
  return getAccountTimeline(input.accountId, { useSlice: input.useSlice });
}

export async function getKyc(input: { accountId: string }) {
  return getKycRecord(input.accountId);
}

/** No prior-case history dataset exists in this prototype's scope (see plan's
 * "Honest gaps" section) — this returns an empty list rather than fabricating
 * history, consistent with "no evidence completion by imagination." */
export async function getPriorCases(_input: { accountId: string }): Promise<[]> {
  return [];
}

export async function searchPolicy(input: { keyword: string }): Promise<TypologyClause[]> {
  const corpus = await loadTypologyCorpus();
  const needle = input.keyword.toLowerCase();
  const matches: TypologyClause[] = [];
  for (const section of corpus.sections) {
    if (section.section.toLowerCase().includes(needle)) {
      matches.push(...section.clauses);
      continue;
    }
    matches.push(...section.clauses.filter((c) => c.text.toLowerCase().includes(needle)));
  }
  return matches;
}

export async function computeAggregates(input: { accountId: string; useSlice?: boolean }) {
  return computeAggregatesAnalytics(input.accountId, { useSlice: input.useSlice });
}

export async function computeGraph(input: { accountId: string; useSlice?: boolean }) {
  return computeGraphAnalytics(input.accountId, { useSlice: input.useSlice });
}

export async function detectPatterns(input: { accountId: string; useSlice?: boolean }) {
  return detectPatternsAnalytics(input.accountId, { useSlice: input.useSlice });
}

export async function screenSanctions(input: { accountHolderName: string; useSlice?: boolean }) {
  return screenSanctionsAnalytics(input.accountHolderName, { useSlice: input.useSlice });
}

export function writeDraftNote(input: { caseId: string; text: string }): { written: true } {
  addDraftNote(input.caseId, input.text);
  return { written: true };
}

export function writeDraftNarrative(input: { caseId: string; text: string }): { written: true } {
  addDraftNarrative(input.caseId, input.text);
  return { written: true };
}

export function createResearchTask(input: { caseId: string; reason: string }) {
  return addResearchTask(input.caseId, input.reason);
}

export function updateCaseStatus(input: { caseId: string; status: string }): { updated: true } {
  setOfficialStatus(input.caseId, input.status);
  return { updated: true };
}
