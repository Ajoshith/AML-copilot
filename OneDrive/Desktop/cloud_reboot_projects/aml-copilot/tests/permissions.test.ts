import { describe, expect, test, beforeEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { REGISTRY, invokeTool, PermissionDeniedError } from "../src/tools/registry.ts";
import { _resetIdempotencyForTests } from "../src/tools/permissions.ts";
import { _resetStoreForTests, getCaseRecord } from "../src/store/caseStore.ts";
import type { AgentContext } from "../src/tools/permissions.ts";
import { DATA_OVERLAY_DIR } from "../src/config.ts";

_resetForTests();
await initDb({ useSlice: true });

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
  caseId: string;
  accountId: string;
}>;
const c001 = cases.find((c) => c.caseId === "C-001")!;

beforeEach(() => {
  _resetIdempotencyForTests();
  _resetStoreForTests();
});

function evidenceCtx(caseId: string): AgentContext {
  return {
    caseId,
    agentName: "evidence",
    allowedTools: ["getTransactions", "getAlert"],
  };
}

describe("permission gate — READ_ONLY / DERIVED / DRAFT", () => {
  test("an allowlisted READ_ONLY tool succeeds", async () => {
    const result = await invokeTool(
      "getTransactions",
      { accountId: c001.accountId },
      c001.caseId,
      evidenceCtx(c001.caseId),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  test("a tool NOT in the agent's allowlist is denied", async () => {
    await expect(
      invokeTool("computeGraph", { accountId: c001.accountId }, c001.caseId, evidenceCtx(c001.caseId)),
    ).rejects.toThrow(PermissionDeniedError);
  });

  test("a case-scope mismatch is denied even for an allowlisted tool", async () => {
    await expect(
      invokeTool("getTransactions", { accountId: c001.accountId }, "SOME-OTHER-CASE", evidenceCtx(c001.caseId)),
    ).rejects.toThrow(PermissionDeniedError);
  });

  test("DRAFT writes land in aiDrafts, never officialRecord", async () => {
    const ctx: AgentContext = { caseId: c001.caseId, agentName: "coordinator", allowedTools: ["writeDraftNote"] };
    await invokeTool("writeDraftNote", { caseId: c001.caseId, text: "draft text" }, c001.caseId, ctx);
    const record = getCaseRecord(c001.caseId);
    expect(record.aiDrafts.notes).toContain("draft text");
    expect(record.officialRecord.status).toBeNull();
  });
});

describe("permission gate — SOR_WRITE", () => {
  const sorCtx: AgentContext = {
    caseId: "SOR-CASE",
    agentName: "coordinator",
    allowedTools: ["createResearchTask", "updateCaseStatus"],
  };

  test("denied with no credentials at all", async () => {
    await expect(
      invokeTool("createResearchTask", { caseId: "SOR-CASE", reason: "verify occupation" }, "SOR-CASE", sorCtx),
    ).rejects.toThrow(PermissionDeniedError);
  });

  test("denied with a token but no idempotency key", async () => {
    await expect(
      invokeTool(
        "createResearchTask",
        { caseId: "SOR-CASE", reason: "verify occupation" },
        "SOR-CASE",
        sorCtx,
        { approvalToken: "tok-1" },
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });

  test("allowed with both a token and a fresh idempotency key", async () => {
    const task = await invokeTool(
      "createResearchTask",
      { caseId: "SOR-CASE", reason: "verify occupation" },
      "SOR-CASE",
      sorCtx,
      { approvalToken: "tok-1", idempotencyKey: "idem-1" },
    );
    expect(task).toBeTruthy();
  });

  test("a reused idempotency key is denied on the second attempt", async () => {
    await invokeTool(
      "createResearchTask",
      { caseId: "SOR-CASE", reason: "first" },
      "SOR-CASE",
      sorCtx,
      { approvalToken: "tok-1", idempotencyKey: "idem-reuse" },
    );
    await expect(
      invokeTool(
        "createResearchTask",
        { caseId: "SOR-CASE", reason: "second" },
        "SOR-CASE",
        sorCtx,
        { approvalToken: "tok-2", idempotencyKey: "idem-reuse" },
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe("ADVERSE class does not exist in the registry", () => {
  test("no registered tool has permissionClass ADVERSE", () => {
    for (const spec of Object.values(REGISTRY)) {
      expect(spec.permissionClass).not.toBe("ADVERSE");
    }
  });

  test("no tool named anything like a SAR filing action exists", () => {
    const names = Object.keys(REGISTRY).map((n) => n.toLowerCase());
    for (const forbidden of ["filesar", "submitsar", "denycoverage", "blockfunds", "closeaccount"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  test("invoking a nonexistent tool name is denied, not silently ignored", async () => {
    const ctx: AgentContext = { caseId: "X", agentName: "test", allowedTools: ["fileSar"] };
    await expect(invokeTool("fileSar", {}, "X", ctx)).rejects.toThrow(PermissionDeniedError);
  });
});
