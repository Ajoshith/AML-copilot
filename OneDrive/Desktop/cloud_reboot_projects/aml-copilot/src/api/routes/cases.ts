import { Elysia } from "elysia";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { runCase } from "../../orchestrator/pipeline.ts";
import { getCaseRecord } from "../../store/caseStore.ts";
import { readCaseAuditLog } from "../../audit/log.ts";
import { readIdentity, isSarScoped } from "../identity.ts";
import { resolveSource, collectCitedSourceIds } from "../../data/sourceResolver.ts";
import { DATA_OVERLAY_DIR } from "../../config.ts";

const RunBodySchema = z.object({ accountId: z.string() });

interface MinedCaseSummary {
  caseId: string;
  accountId: string;
  classification: string;
  rationale: string;
  isLaundering: boolean;
}

export const casesRoutes = new Elysia({ prefix: "/cases" })
  .get("/", async () => {
    const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as MinedCaseSummary[];
    return {
      cases: cases.map((c) => ({ ...c, state: getCaseRecord(c.caseId).state })),
    };
  })

  .get("/:id", ({ params, headers, set }) => {
    const record = getCaseRecord(params.id);
    const { role } = readIdentity(headers);
    if (!isSarScoped(role)) {
      set.status = 403;
      return { error: "This role cannot view case content" };
    }
    return record;
  })

  .post("/:id/run", async ({ params, body, headers, set }) => {
    const parsed = RunBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid request body", issues: parsed.error.issues };
    }
    const { role } = readIdentity(headers);
    if (role === "readonly") {
      set.status = 403;
      return { error: "readonly role cannot start a case run" };
    }

    try {
      const record = await runCase({ caseId: params.id, accountId: parsed.data.accountId, useSlice: true });
      return { caseId: params.id, state: record.state };
    } catch (err) {
      set.status = 409;
      return { error: (err as Error).message };
    }
  })

  .get("/:id/packet", ({ params, headers, set }) => {
    const record = getCaseRecord(params.id);
    const { role } = readIdentity(headers);

    if (record.state === "BLOCKED_VERIFICATION") {
      set.status = 403;
      return { error: "Verification failed — packet withheld from analyst review", state: record.state };
    }
    if (record.casePacket === null) {
      set.status = 403;
      return { error: "No packet available for this case yet", state: record.state };
    }
    if (!isSarScoped(role)) {
      set.status = 403;
      return { error: "This role cannot view case packet content" };
    }
    return { caseId: params.id, state: record.state, casePacket: record.casePacket };
  })

  .get("/:id/audit", async ({ params, headers }) => {
    const { role } = readIdentity(headers);
    const rows = await readCaseAuditLog(params.id, { sarScoped: isSarScoped(role) });
    return { caseId: params.id, events: rows };
  })

  /**
   * Source drill-through — turns a citation the UI already shows into the real
   * record it names (blueprint §6: "preserve raw transactions and source
   * links"). `id` is a query param, not a path segment, because source ids
   * contain colons. Gated the same way /packet is (isSarScoped), since a
   * kyc:/alert:/note: source can carry SAR-confidentiality-sensitive content —
   * drill-through must never be a side door around that gate. The 403 below
   * for an uncited id is the actual access control: it keeps this route from
   * being usable to browse the 5M-row dataset one case at a time.
   */
  .get("/:id/sources", async ({ params, query, headers, set }) => {
    const sourceId = typeof query.id === "string" ? query.id : null;
    if (!sourceId) {
      set.status = 400;
      return { error: "?id=<source_id> query param is required" };
    }

    const { role } = readIdentity(headers);
    if (!isSarScoped(role)) {
      set.status = 403;
      return { error: "This role cannot view source content" };
    }

    const record = getCaseRecord(params.id);
    if (!record.accountId) {
      set.status = 404;
      return { error: "Case has not been run yet" };
    }

    const cited = await collectCitedSourceIds(record);
    if (!cited.has(sourceId)) {
      set.status = 403;
      return { error: "This source id is not cited anywhere in this case" };
    }

    const resolved = await resolveSource(sourceId, { accountId: record.accountId, useSlice: true });
    if (!resolved) {
      set.status = 404;
      return { error: "Source id is cited but could not be resolved" };
    }
    return { sourceId, ...resolved };
  });
