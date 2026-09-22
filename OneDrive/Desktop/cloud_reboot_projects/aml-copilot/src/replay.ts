/**
 * Replays a case purely from its cassettes and real data — no live API call,
 * regardless of AML_LLM_MODE (this script forces replay). Because every LLM
 * call is content-addressed (the cassette key is a hash of the exact prompt),
 * and every deterministic computation is pure, re-running the pipeline against
 * the same real data and the same cassette files reproduces an identical
 * CasePacket. That reproducibility is the tenth definition-of-done check.
 *
 * Usage: bun run src/replay.ts <caseId>
 */
import { readFile } from "node:fs/promises";
import { runCase } from "./orchestrator/pipeline.ts";
import { getCaseRecord, _resetStoreForTests } from "./store/caseStore.ts";
import { initDb, _resetForTests } from "./data/loaders.ts";
import { DATA_OVERLAY_DIR } from "./config.ts";

async function main() {
  const caseId = process.argv[2];
  if (!caseId) {
    console.error("Usage: bun run src/replay.ts <caseId>");
    process.exit(1);
  }

  if (process.env.AML_LLM_MODE !== "replay") {
    console.error(
      `AML_LLM_MODE is "${process.env.AML_LLM_MODE ?? "unset"}", but replay forces "replay" semantics — ` +
        `set AML_LLM_MODE=replay (or leave it unset) before running this script.`,
    );
    process.exit(1);
  }

  const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
    caseId: string;
    accountId: string;
  }>;
  const target = cases.find((c) => c.caseId === caseId);
  if (!target) {
    console.error(`No mined case "${caseId}" found in ${DATA_OVERLAY_DIR}/cases.json`);
    process.exit(1);
  }

  _resetForTests();
  await initDb({ useSlice: true });
  _resetStoreForTests();

  const record = await runCase({ caseId: target.caseId, accountId: target.accountId, useSlice: true });

  console.log(JSON.stringify({ state: record.state, casePacket: record.casePacket }, null, 2));
}

if (import.meta.main) {
  await main();
}
