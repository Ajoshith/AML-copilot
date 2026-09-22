import { createSignal } from "solid-js";
import { api } from "./eden";

export interface CaseSummary {
  caseId: string;
  accountId: string;
  classification: string;
  rationale: string;
  isLaundering: boolean;
  state: string | null;
}

/** Bumped whenever an action (run, decision) should invalidate the case list —
 * createResource in CaseList re-fetches whenever this source signal changes. */
export const [refreshToken, setRefreshToken] = createSignal(0);
export function refetchCaseList() {
  setRefreshToken((n) => n + 1);
}

export async function fetchCases(): Promise<CaseSummary[]> {
  const res = await api.cases.get();
  const data = res.data as { cases: CaseSummary[] } | null;
  return data?.cases ?? [];
}
