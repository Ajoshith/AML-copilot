import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { appendAuditEvent, readCaseAuditLog, readGenericLog } from "../src/audit/log.ts";
import { redactForGenericLog } from "../src/audit/redact.ts";
import { AUDIT_DIR } from "../src/config.ts";

const TEST_CASE_ID = `CONF-TEST-${crypto.randomUUID()}`;

async function cleanup() {
  const path = `${AUDIT_DIR}/case-${TEST_CASE_ID}.jsonl`;
  if (existsSync(path)) await rm(path, { force: true });
}

describe("redactForGenericLog", () => {
  test("scrubs known SAR-sensitive keys", () => {
    const redacted = redactForGenericLog({
      caseId: "X",
      disposition: "CONSIDER_SAR",
      rationale: "because of structuring evidence",
      overrideReason: undefined,
      analystId: "alice",
    });
    expect(redacted.disposition).toBe("[REDACTED:SAR-SENSITIVE]");
    expect(redacted.rationale).toBe("[REDACTED:SAR-SENSITIVE]");
    expect(redacted.caseId).toBe("X"); // not sensitive, passes through
    expect(redacted.analystId).toBe("alice"); // not sensitive, passes through
  });

  test("recurses into nested objects", () => {
    const redacted = redactForGenericLog({
      caseId: "X",
      packet: { summary: "suspicious structuring pattern", recommendation: "CONSIDER_SAR" },
    });
    const packet = redacted.packet as Record<string, unknown>;
    expect(packet.summary).toBe("[REDACTED:SAR-SENSITIVE]");
    expect(packet.recommendation).toBe("[REDACTED:SAR-SENSITIVE]");
  });
});

describe("the audit log never leaks SAR content into the generic sink", () => {
  test("an analyst_decision event with SAR-sensitive fields is redacted in the generic log", async () => {
    await cleanup();

    await appendAuditEvent({
      type: "analyst_decision",
      timestamp: new Date().toISOString(),
      caseId: TEST_CASE_ID,
      analystId: "analyst-42",
      disposition: "CONSIDER_SAR",
      rationale: "Structuring pattern consistent with FFIEC red flag; recommend SAR consideration.",
      aiRecommendation: "CONSIDER_SAR",
    });

    const fullLog = await readCaseAuditLog(TEST_CASE_ID, { sarScoped: true });
    expect(fullLog.length).toBe(1);
    expect(fullLog[0]!.disposition).toBe("CONSIDER_SAR");
    expect(fullLog[0]!.rationale).toContain("Structuring pattern");

    const redactedLog = await readCaseAuditLog(TEST_CASE_ID, { sarScoped: false });
    expect(redactedLog[0]!.disposition).toBe("[REDACTED:SAR-SENSITIVE]");
    expect(redactedLog[0]!.rationale).toBe("[REDACTED:SAR-SENSITIVE]");
    // analystId and caseId are not SAR-sensitive — a readonly-role viewer can
    // still see who acted and on which case, just not the substantive content.
    expect(redactedLog[0]!.analystId).toBe("analyst-42");
    expect(redactedLog[0]!.caseId).toBe(TEST_CASE_ID);

    const genericLog = await readGenericLog();
    const ourEntries = genericLog.filter((e) => e.caseId === TEST_CASE_ID);
    expect(ourEntries.length).toBe(1);
    expect(ourEntries[0]!.disposition).toBe("[REDACTED:SAR-SENSITIVE]");
    expect(JSON.stringify(ourEntries[0])).not.toContain("Structuring pattern");
    expect(JSON.stringify(genericLog)).not.toContain("Structuring pattern consistent with FFIEC red flag");

    await cleanup();
  });

  test("a tool_check event (no SAR-sensitive keys) passes through unredacted in both views", async () => {
    await cleanup();

    await appendAuditEvent({
      type: "tool_check",
      timestamp: new Date().toISOString(),
      caseId: TEST_CASE_ID,
      toolName: "getTransactions",
      agentName: "evidence",
      decision: "allow",
      reason: "READ_ONLY auto-allowed after allowlist/scope checks",
    });

    const sarScoped = await readCaseAuditLog(TEST_CASE_ID, { sarScoped: true });
    const readonly = await readCaseAuditLog(TEST_CASE_ID, { sarScoped: false });
    expect(sarScoped[0]!.toolName).toBe("getTransactions");
    expect(readonly[0]!.toolName).toBe("getTransactions"); // no redaction needed — not SAR content

    await cleanup();
  });
});
