import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { AUDIT_DIR } from "../config.ts";
import { redactForGenericLog } from "./redact.ts";

export const ToolCheckEventSchema = z.object({
  type: z.literal("tool_check"),
  timestamp: z.string(),
  caseId: z.string(),
  toolName: z.string(),
  agentName: z.string(),
  decision: z.enum(["allow", "deny"]),
  reason: z.string(),
});

export const ModelCallEventSchema = z.object({
  type: z.literal("model_call"),
  timestamp: z.string(),
  caseId: z.string(),
  agentName: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  policyVersion: z.string(),
  effort: z.string(),
  cassetteKey: z.string(),
  cassetteMode: z.enum(["record", "replay", "live"]),
  usage: z.record(z.string(), z.number()).optional(),
  latencyMs: z.number(),
});

export const StateTransitionEventSchema = z.object({
  type: z.literal("state_transition"),
  timestamp: z.string(),
  caseId: z.string(),
  fromState: z.string(),
  toState: z.string(),
  reason: z.string(),
});

export const AnalystDecisionEventSchema = z.object({
  type: z.literal("analyst_decision"),
  timestamp: z.string(),
  caseId: z.string(),
  analystId: z.string(),
  disposition: z.string(),
  rationale: z.string(),
  overrideReason: z.string().optional(),
  aiRecommendation: z.string().optional(),
});

export const AuditEventSchema = z.discriminatedUnion("type", [
  ToolCheckEventSchema,
  ModelCallEventSchema,
  StateTransitionEventSchema,
  AnalystDecisionEventSchema,
]);
export type AuditEvent = z.infer<typeof AuditEventSchema>;

function caseLogPath(caseId: string): string {
  return `${AUDIT_DIR}/case-${caseId}.jsonl`;
}
function genericLogPath(): string {
  return `${AUDIT_DIR}/generic.jsonl`;
}

/**
 * Appends one audit event to the case-scoped log (full detail, SAR-sensitive
 * content included) and a redacted copy to the generic app log. This is the only
 * write path for audit events — every tool check, model call, state transition and
 * analyst decision goes through here, which is what makes a case replayable and
 * what makes "no SAR content in the generic log" an enforced property, not a hope.
 */
export async function appendAuditEvent(event: AuditEvent): Promise<void> {
  const validated = AuditEventSchema.parse(event);
  await mkdir(AUDIT_DIR, { recursive: true });

  const line = JSON.stringify(validated) + "\n";
  await appendFile(caseLogPath(validated.caseId), line, "utf8");

  const redactedLine = JSON.stringify(redactForGenericLog(validated)) + "\n";
  await appendFile(genericLogPath(), redactedLine, "utf8");
}

/** SAR-scoped roles see the full case log; anyone else gets the redacted view —
 * mirrors the same role gate the API applies to /cases/:id/audit. */
export async function readCaseAuditLog(
  caseId: string,
  opts: { sarScoped: boolean },
): Promise<Record<string, unknown>[]> {
  const path = caseLogPath(caseId);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const rows = raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return opts.sarScoped ? rows : rows.map(redactForGenericLog);
}

export async function readGenericLog(): Promise<Record<string, unknown>[]> {
  const path = genericLogPath();
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}
