import type { CaseState } from "../domain/case.ts";

/**
 * The explicit transition table for the 10-step pipeline. Illegal transitions
 * throw — there is no way to reach AWAITING_ANALYST except through this table,
 * and no way out of it except DISPOSITION_RECORDED (driven only by an
 * authenticated analyst decision at the API layer, never by code in this file).
 */
const ALLOWED_TRANSITIONS: Record<CaseState, readonly CaseState[]> = {
  INGESTED: ["EVIDENCE", "OPS_EXCEPTION"],
  EVIDENCE: ["KYC"],
  KYC: ["ANALYTICS"],
  ANALYTICS: ["ESCALATED_SANCTIONS", "TYPOLOGY"],
  TYPOLOGY: ["VERIFICATION"],
  VERIFICATION: ["BLOCKED_VERIFICATION", "PACKET_READY"],
  PACKET_READY: ["AWAITING_ANALYST"],
  AWAITING_ANALYST: ["DISPOSITION_RECORDED"],
  DISPOSITION_RECORDED: ["QA"],
  QA: [],
  BLOCKED_VERIFICATION: [],
  ESCALATED_SANCTIONS: [],
  OPS_EXCEPTION: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: CaseState,
    public readonly to: CaseState,
  ) {
    super(`Illegal state transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: CaseState, to: CaseState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalTransitionError(from, to);
  }
}

export const TERMINAL_STATES: ReadonlySet<CaseState> = new Set([
  "BLOCKED_VERIFICATION",
  "ESCALATED_SANCTIONS",
  "QA",
  "OPS_EXCEPTION",
]);
