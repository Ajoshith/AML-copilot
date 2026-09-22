import { z } from "zod";
import * as handlers from "./handlers.ts";
import { checkPermission, type AgentContext, type PermissionClass, type SorWriteCredentials } from "./permissions.ts";
import { appendAuditEvent } from "../audit/log.ts";

export class PermissionDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    reason: string,
  ) {
    super(`Permission denied for tool "${toolName}": ${reason}`);
    this.name = "PermissionDeniedError";
  }
}

export interface ToolSpec<TInput> {
  name: string;
  permissionClass: PermissionClass;
  description: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput) => unknown | Promise<unknown>;
}

function tool<TInput>(spec: ToolSpec<TInput>): ToolSpec<TInput> {
  return spec;
}

const accountInput = z.object({ accountId: z.string(), useSlice: z.boolean().optional() });
const caseTextInput = z.object({ caseId: z.string(), text: z.string() });

/**
 * The complete tool registry. This IS the enforcement mechanism for "no SAR
 * filing tool exists": there is no entry here with `permissionClass: "ADVERSE"`
 * and no entry whose name is a filing/submission verb for a regulatory report —
 * tests/hardStop.test.ts greps this exact file to confirm that stays true.
 */
export const REGISTRY = {
  // READ_ONLY
  getAlert: tool({
    name: "getAlert",
    permissionClass: "READ_ONLY",
    description: "Retrieve the transaction-monitoring alert(s) for an account.",
    inputSchema: z.object({ accountId: z.string() }),
    handler: handlers.getAlert,
  }),
  getTransactions: tool({
    name: "getTransactions",
    permissionClass: "READ_ONLY",
    description: "Retrieve the real transaction timeline for an account.",
    inputSchema: accountInput,
    handler: handlers.getTransactions,
  }),
  getKyc: tool({
    name: "getKyc",
    permissionClass: "READ_ONLY",
    description: "Retrieve the KYC/CDD profile for an account.",
    inputSchema: z.object({ accountId: z.string() }),
    handler: handlers.getKyc,
  }),
  getPriorCases: tool({
    name: "getPriorCases",
    permissionClass: "READ_ONLY",
    description: "Retrieve prior case history for an account, if any.",
    inputSchema: z.object({ accountId: z.string() }),
    handler: handlers.getPriorCases,
  }),
  searchPolicy: tool({
    name: "searchPolicy",
    permissionClass: "READ_ONLY",
    description: "Search the FFIEC red-flag policy corpus by keyword.",
    inputSchema: z.object({ keyword: z.string() }),
    handler: handlers.searchPolicy,
  }),

  // DERIVED
  computeAggregates: tool({
    name: "computeAggregates",
    permissionClass: "DERIVED",
    description: "Deterministically compute transaction totals/counts for an account.",
    inputSchema: accountInput,
    handler: handlers.computeAggregates,
  }),
  computeGraph: tool({
    name: "computeGraph",
    permissionClass: "DERIVED",
    description: "Deterministically compute counterparty degree/structure for an account.",
    inputSchema: accountInput,
    handler: handlers.computeGraph,
  }),
  detectPatterns: tool({
    name: "detectPatterns",
    permissionClass: "DERIVED",
    description: "Deterministically compute structuring/velocity/pass-through signals.",
    inputSchema: accountInput,
    handler: handlers.detectPatterns,
  }),
  screenSanctions: tool({
    name: "screenSanctions",
    permissionClass: "DERIVED",
    description: "Deterministically fuzzy-match a name against the real OFAC SDN list.",
    inputSchema: z.object({ accountHolderName: z.string(), useSlice: z.boolean().optional() }),
    handler: handlers.screenSanctions,
  }),

  // DRAFT
  writeDraftNote: tool({
    name: "writeDraftNote",
    permissionClass: "DRAFT",
    description: "Write a draft note to the case's AI draft namespace (never the official record).",
    inputSchema: caseTextInput,
    handler: handlers.writeDraftNote,
  }),
  writeDraftNarrative: tool({
    name: "writeDraftNarrative",
    permissionClass: "DRAFT",
    description: "Write a draft SAR narrative to the case's AI draft namespace.",
    inputSchema: caseTextInput,
    handler: handlers.writeDraftNarrative,
  }),

  // SOR_WRITE
  createResearchTask: tool({
    name: "createResearchTask",
    permissionClass: "SOR_WRITE",
    description: "Create an internal research task on the case (requires approval token).",
    inputSchema: z.object({ caseId: z.string(), reason: z.string() }),
    handler: handlers.createResearchTask,
  }),
  updateCaseStatus: tool({
    name: "updateCaseStatus",
    permissionClass: "SOR_WRITE",
    description: "Update the case's official status (requires approval token).",
    inputSchema: z.object({ caseId: z.string(), status: z.string() }),
    handler: handlers.updateCaseStatus,
  }),

  // No ADVERSE-class entries, and no entry that files, submits, denies, blocks
  // or closes anything. This is not a policy statement — the capability is
  // structurally absent from this object.
} as const;

export type ToolName = keyof typeof REGISTRY;

/**
 * The single call path every tool invocation must go through: permission check,
 * audit log (allow AND deny both recorded), then — only if allowed — the handler.
 * Agents and the orchestrator never call handlers directly.
 */
export async function invokeTool(
  toolName: string,
  rawInput: unknown,
  requestedCaseId: string,
  ctx: AgentContext,
  credentials: SorWriteCredentials = {},
): Promise<unknown> {
  const spec = (REGISTRY as Record<string, ToolSpec<unknown> | undefined>)[toolName];

  if (!spec) {
    await appendAuditEvent({
      type: "tool_check",
      timestamp: new Date().toISOString(),
      caseId: requestedCaseId,
      toolName,
      agentName: ctx.agentName,
      decision: "deny",
      reason: "No such tool is registered",
    });
    throw new PermissionDeniedError(toolName, "No such tool is registered");
  }

  const permission = checkPermission(toolName, spec.permissionClass, requestedCaseId, ctx, credentials);

  await appendAuditEvent({
    type: "tool_check",
    timestamp: new Date().toISOString(),
    caseId: requestedCaseId,
    toolName,
    agentName: ctx.agentName,
    decision: permission.allowed ? "allow" : "deny",
    reason: permission.reason,
  });

  if (!permission.allowed) {
    throw new PermissionDeniedError(toolName, permission.reason);
  }

  const parsedInput = spec.inputSchema.parse(rawInput);
  return spec.handler(parsedInput);
}
