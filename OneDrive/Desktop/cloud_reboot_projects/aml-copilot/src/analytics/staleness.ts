/**
 * Deterministic staleness calculation, computed in code rather than left for the
 * KYC agent to work out from a raw "now" + lastReviewDate pair. This matters
 * beyond neatness: if the agent's prompt embedded a live timestamp, every case
 * run would produce a unique, never-repeating cassette key (a cassette is keyed
 * on exact prompt content) — permanently defeating record/replay for this agent
 * in production, not just in tests. "Claude explains, code calculates" applies
 * here too: staleness is exact arithmetic with one right answer.
 */
export function computeStalenessDays(lastReviewDate: string | null, asOf: Date): number | null {
  if (lastReviewDate === null) return null;
  const reviewed = new Date(lastReviewDate);
  const diffMs = asOf.getTime() - reviewed.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}
