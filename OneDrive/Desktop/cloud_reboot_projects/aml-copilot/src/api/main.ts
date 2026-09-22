import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { readFile } from "node:fs/promises";
import { casesRoutes } from "./routes/cases.ts";
import { analystRoutes } from "./routes/analyst.ts";
import { getCaseRecord } from "../store/caseStore.ts";
import { DATA_OVERLAY_DIR, PORT } from "../config.ts";

const app = new Elysia()
  .use(cors())
  .get("/", () => ({ service: "aml-copilot-api", status: "ok" }))
  .get("/metrics", async () => {
    const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
      caseId: string;
      accountId: string;
      isLaundering: boolean;
    }>;

    const byState: Record<string, number> = {};
    let overrides = 0;
    let dispositionsRecorded = 0;

    for (const c of cases) {
      const record = getCaseRecord(c.caseId);
      const state = record.state ?? "NOT_RUN";
      byState[state] = (byState[state] ?? 0) + 1;
      if (record.disposition) {
        dispositionsRecorded += 1;
        if (record.disposition.overrideReason) overrides += 1;
      }
    }

    return { totalCases: cases.length, byState, dispositionsRecorded, overrides };
  })
  .use(casesRoutes)
  .use(analystRoutes)
  .listen(PORT);

console.log(`Elysia API listening on http://localhost:${PORT}`);

export type App = typeof app;
