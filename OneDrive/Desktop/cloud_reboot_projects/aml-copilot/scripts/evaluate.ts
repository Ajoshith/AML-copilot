/**
 * Runs the full pipeline over every mined case (offline, against replayed
 * cassettes) and reports the plan's §10 evaluation metrics: a recommendation vs.
 * `Is Laundering` confusion matrix, the verifier block rate and reasons, the
 * grounding pass rate, and cost/latency per case.
 *
 * Honesty note: this is 8 mined cases, not the ~60-case statistical sample the
 * original plan sketched — the committed data slice only covers the 8 accounts
 * selected by select-cases.ts (see DATA_LICENSES.md for why only a slice is
 * committed). It is a baseline demonstrating the metrics pipeline works and is
 * wired to real ground truth (`Is Laundering`), not a claim about model quality
 * at scale. Re-run with a larger mined set once that's needed.
 *
 * Also: the committed demo cassettes (scripts/seed-demo-cassettes.ts) are
 * hand-written placeholders, not real recorded model output, so their
 * `usage` field is empty and cost figures below will read as $0 / N/A until
 * cassettes are re-recorded against the live API (AML_LLM_MODE=record).
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { runCase } from "../src/orchestrator/pipeline.ts";
import { _resetStoreForTests } from "../src/store/caseStore.ts";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { readCaseAuditLog, ModelCallEventSchema } from "../src/audit/log.ts";
import { DATA_OVERLAY_DIR } from "../src/config.ts";
import { MinedCaseSchema } from "./select-cases.ts";

/**
 * Placeholder per-token pricing — NOT a verified published rate for the pinned
 * model. Swap in the actual current rate before treating cost figures as real
 * money; until then this only shows the pipeline's cost-accounting is wired up.
 */
const COST_PER_INPUT_TOKEN_USD = 0.000003;
const COST_PER_OUTPUT_TOKEN_USD = 0.000015;

interface CaseEvalResult {
  caseId: string;
  classification: string;
  isLaundering: boolean;
  state: string | null;
  recommendation: string | null;
  flaggedSuspicious: boolean;
  verifierVerdict: "PASS" | "FAIL" | null;
  unsupportedClaimCount: number;
  recalcMismatchCount: number;
  modelCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  estimatedCostUsd: number;
  error: string | null;
}

/** Any recommendation other than CLOSE counts as "flagged suspicious" for the
 * laundering confusion matrix. A sanctions escalation is deliberately NOT
 * folded into this — the AML pipeline never adjudicates a sanctions match (it
 * exits before the typology/coordinator path even runs), so scoring it against
 * the laundering label would conflate two different judgments. It is reported
 * separately instead. */
function isFlaggedSuspicious(recommendation: string | null): boolean {
  return recommendation !== null && recommendation !== "CLOSE";
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function evaluateCase(c: z.infer<typeof MinedCaseSchema>): Promise<CaseEvalResult> {
  const base: Omit<CaseEvalResult, "error"> = {
    caseId: c.caseId,
    classification: c.classification,
    isLaundering: c.isLaundering,
    state: null,
    recommendation: null,
    flaggedSuspicious: false,
    verifierVerdict: null,
    unsupportedClaimCount: 0,
    recalcMismatchCount: 0,
    modelCallCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalLatencyMs: 0,
    estimatedCostUsd: 0,
  };

  try {
    _resetStoreForTests();
    const record = await runCase({ caseId: c.caseId, accountId: c.accountId, useSlice: true });

    base.state = record.state;
    base.recommendation = record.casePacket?.recommendation ?? null;
    base.flaggedSuspicious = isFlaggedSuspicious(base.recommendation);
    base.verifierVerdict = record.verification?.verdict ?? null;
    base.unsupportedClaimCount = record.verification?.unsupportedClaims.length ?? 0;
    base.recalcMismatchCount = record.verification?.recalcMismatches.length ?? 0;

    const auditRows = await readCaseAuditLog(c.caseId, { sarScoped: true });
    for (const row of auditRows) {
      const parsed = ModelCallEventSchema.safeParse(row);
      if (!parsed.success) continue;
      const event = parsed.data;
      base.modelCallCount += 1;
      base.totalLatencyMs += event.latencyMs;
      const inputTokens = event.usage?.inputTokens ?? 0;
      const outputTokens = event.usage?.outputTokens ?? 0;
      base.totalInputTokens += inputTokens;
      base.totalOutputTokens += outputTokens;
      base.estimatedCostUsd += inputTokens * COST_PER_INPUT_TOKEN_USD + outputTokens * COST_PER_OUTPUT_TOKEN_USD;
    }

    return { ...base, error: null };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

function printConfusionMatrix(results: CaseEvalResult[]) {
  const sanctionsRouted = results.filter((r) => !r.error && r.state === "ESCALATED_SANCTIONS");
  const scored = results.filter((r) => !r.error && r.state !== "ESCALATED_SANCTIONS");
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const r of scored) {
    if (r.isLaundering && r.flaggedSuspicious) tp++;
    else if (!r.isLaundering && r.flaggedSuspicious) fp++;
    else if (!r.isLaundering && !r.flaggedSuspicious) tn++;
    else fn++;
  }
  console.log("\n=== Recommendation vs. real `Is Laundering` label ===");
  console.log(
    `  (excludes ${sanctionsRouted.length} case(s) routed to ESCALATED_SANCTIONS — the AML pipeline never ` +
      `adjudicates those; see the sanctions-escalated count reported below)`,
  );
  console.log(`  True positive  (laundering, flagged):      ${tp}`);
  console.log(`  False positive (benign, flagged):          ${fp}`);
  console.log(`  True negative  (benign, not flagged):      ${tn}`);
  console.log(`  False negative (laundering, not flagged):  ${fn}`);
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  console.log(`  Precision: ${precision === null ? "n/a" : precision.toFixed(2)}`);
  console.log(`  Recall:    ${recall === null ? "n/a" : recall.toFixed(2)}`);
  console.log(`  Routed to ESCALATED_SANCTIONS (excluded above): ${sanctionsRouted.length}`);
}

function printVerifierStats(results: CaseEvalResult[]) {
  const reachedVerification = results.filter((r) => r.verifierVerdict !== null);
  const failed = reachedVerification.filter((r) => r.verifierVerdict === "FAIL");
  console.log("\n=== Verifier ===");
  console.log(`  Cases that reached VERIFICATION: ${reachedVerification.length}/${results.length}`);
  console.log(
    `  Block rate (verdict=FAIL): ${reachedVerification.length > 0 ? ((failed.length / reachedVerification.length) * 100).toFixed(0) : "n/a"}%`,
  );
  for (const r of failed) {
    console.log(
      `    ${r.caseId}: ${r.unsupportedClaimCount} unsupported claim(s), ${r.recalcMismatchCount} recalc mismatch(es)`,
    );
  }
}

function printGroundingStats(results: CaseEvalResult[]) {
  const reachedVerification = results.filter((r) => r.verifierVerdict !== null);
  const grounded = reachedVerification.filter((r) => r.unsupportedClaimCount === 0 && r.recalcMismatchCount === 0);
  console.log("\n=== Grounding pass rate ===");
  console.log(
    `  Cases with zero unsupported claims and zero recalc mismatches: ${grounded.length}/${reachedVerification.length}` +
      (reachedVerification.length > 0
        ? ` (${((grounded.length / reachedVerification.length) * 100).toFixed(0)}%)`
        : ""),
  );
}

function printCostAndLatency(results: CaseEvalResult[]) {
  const scored = results.filter((r) => !r.error);
  const totalCost = scored.reduce((s, r) => s + r.estimatedCostUsd, 0);
  const totalCalls = scored.reduce((s, r) => s + r.modelCallCount, 0);
  const latencies = scored.flatMap((r) => (r.modelCallCount > 0 ? [r.totalLatencyMs / r.modelCallCount] : []));

  console.log("\n=== Cost and latency (placeholder pricing; see file header) ===");
  console.log(`  Total model calls: ${totalCalls}`);
  console.log(`  Total estimated cost: $${totalCost.toFixed(4)}`);
  console.log(`  Estimated cost per case: $${scored.length > 0 ? (totalCost / scored.length).toFixed(4) : "n/a"}`);
  console.log(`  Per-agent-call latency P50: ${percentile(latencies, 50).toFixed(0)}ms`);
  console.log(`  Per-agent-call latency P90: ${percentile(latencies, 90).toFixed(0)}ms`);
  if (totalCalls > 0 && scored.every((r) => r.totalInputTokens === 0 && r.totalOutputTokens === 0)) {
    console.log(
      `  (All usage figures are 0 — cassettes in fixtures/cassettes/ are hand-seeded placeholders with no ` +
        `recorded usage. Re-run scripts/select-cases.ts's cases with AML_LLM_MODE=record against the live ` +
        `API to get real token/cost numbers.)`,
    );
  }
}

async function main() {
  _resetForTests();
  await initDb({ useSlice: true });

  const cases = z
    .array(MinedCaseSchema)
    .parse(JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")));

  console.log(`Evaluating ${cases.length} mined cases...`);
  const results: CaseEvalResult[] = [];
  for (const c of cases) {
    const result = await evaluateCase(c);
    results.push(result);
    const label = result.error
      ? `ERROR: ${result.error}`
      : `${result.state} — recommendation=${result.recommendation ?? "n/a"} verifier=${result.verifierVerdict ?? "n/a"}`;
    console.log(`  ${c.caseId} (real isLaundering=${c.isLaundering}): ${label}`);
  }

  const errored = results.filter((r) => r.error);
  if (errored.length > 0) {
    console.log(`\n${errored.length} case(s) errored (likely a missing cassette) and are excluded from the metrics below.`);
  }

  printConfusionMatrix(results);
  printVerifierStats(results);
  printGroundingStats(results);
  printCostAndLatency(results);
}

if (import.meta.main) {
  await main();
}
