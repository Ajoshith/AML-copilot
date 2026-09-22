/**
 * Records real model output as cassettes by running mined cases through the full
 * orchestrator against the live API. Requires AML_LLM_MODE=record and the
 * selected provider's API key (see .env.example).
 *
 * Usage:
 *   bun run scripts/record-cases.ts            # every mined case
 *   bun run scripts/record-cases.ts C-006      # just one (cheap smoke test)
 *   bun run scripts/record-cases.ts C-006 C-002
 *
 * Cassette keys include the model id, so cassettes recorded from one provider/model
 * are never silently reused for another — re-record after switching.
 */
import { readFile } from "node:fs/promises";
import { runCase } from "../src/orchestrator/pipeline.ts";
import { _resetStoreForTests } from "../src/store/caseStore.ts";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { readCaseAuditLog, ModelCallEventSchema } from "../src/audit/log.ts";
import { DATA_OVERLAY_DIR, LLM_MODE, LLM_PROVIDER, MODEL_ID, AGENT_EFFORT } from "../src/config.ts";

interface MinedCaseSummary {
  caseId: string;
  accountId: string;
}

async function tokensUsedFor(caseId: string): Promise<{ calls: number; input: number; output: number }> {
  let calls = 0;
  let input = 0;
  let output = 0;
  for (const row of await readCaseAuditLog(caseId, { sarScoped: true })) {
    const parsed = ModelCallEventSchema.safeParse(row);
    if (!parsed.success || parsed.data.cassetteMode !== "record") continue;
    calls += 1;
    input += parsed.data.usage?.inputTokens ?? 0;
    output += parsed.data.usage?.outputTokens ?? 0;
  }
  return { calls, input, output };
}

async function main() {
  if (LLM_MODE !== "record") {
    console.error(
      `AML_LLM_MODE is "${LLM_MODE}" — set AML_LLM_MODE=record to record cassettes. ` +
        `(replay would read existing cassettes and record nothing.)`,
    );
    process.exit(1);
  }

  _resetForTests();
  await initDb({ useSlice: true });

  const all = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as MinedCaseSummary[];
  const requested = process.argv.slice(2);
  const cases = requested.length > 0 ? all.filter((c) => requested.includes(c.caseId)) : all;

  if (cases.length === 0) {
    console.error(`No mined case matched ${requested.join(", ")}. Known: ${all.map((c) => c.caseId).join(", ")}`);
    process.exit(1);
  }

  console.log(`Recording ${cases.length} case(s) against ${LLM_PROVIDER} / ${MODEL_ID} at effort=${AGENT_EFFORT}\n`);

  let totalCalls = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const started = Date.now();
    process.stdout.write(`  ${c.caseId} ... `);
    try {
      _resetStoreForTests();
      const record = await runCase({ caseId: c.caseId, accountId: c.accountId, useSlice: true });
      const { calls, input, output } = await tokensUsedFor(c.caseId);
      totalCalls += calls;
      totalInput += input;
      totalOutput += output;
      console.log(
        `${record.state} (${calls} calls, ${input} in / ${output} out tokens, ${((Date.now() - started) / 1000).toFixed(1)}s)`,
      );
    } catch (err) {
      failures.push(c.caseId);
      console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `\nDone. ${cases.length - failures.length}/${cases.length} recorded, ` +
      `${totalCalls} model calls, ${totalInput} input + ${totalOutput} output tokens.`,
  );
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(", ")} — re-run this script with just those ids to retry.`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
