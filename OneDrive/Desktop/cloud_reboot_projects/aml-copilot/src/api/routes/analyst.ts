import { Elysia } from "elysia";
import { z } from "zod";
import { AnalystDecisionSchema } from "../../domain/case.ts";

// analystId is derived from the X-Analyst-Id header, never accepted in the
// request body — a caller cannot claim to be a different analyst than the one
// the identity layer resolved.
const DecisionBodySchema = AnalystDecisionSchema.omit({ analystId: true });
import { assertTransition, IllegalTransitionError } from "../../orchestrator/state.ts";
import { getCaseRecord, updateCaseRecord } from "../../store/caseStore.ts";
import { appendAuditEvent } from "../../audit/log.ts";
import { invokeTool, PermissionDeniedError } from "../../tools/registry.ts";
import { readIdentity } from "../identity.ts";

const DraftNarrativeBodySchema = z.object({ text: z.string().min(1) });

/**
 * The hard stop lives here, not in a prompt. AWAITING_ANALYST -> DISPOSITION_RECORDED
 * is the ONLY transition this route drives, and it requires:
 *   - a role of exactly "analyst" (401/403 otherwise)
 *   - a non-empty analystId (401 otherwise)
 *   - the case to actually be in AWAITING_ANALYST (409 otherwise — no skipping ahead)
 *   - an overrideReason whenever the analyst's disposition differs from the AI's
 *     own recommendation, captured separately for automation-bias tracking.
 * No model call, tool, or code path anywhere else in this codebase can reach
 * DISPOSITION_RECORDED.
 */
export const analystRoutes = new Elysia({ prefix: "/cases" })
  .post("/:id/analyst/decision", async ({ params, body, headers, set }) => {
    const { analystId, role } = readIdentity(headers);

    if (!analystId) {
      set.status = 401;
      return { error: "X-Analyst-Id header is required to record a decision" };
    }
    if (role !== "analyst") {
      set.status = 403;
      return { error: `Role "${role}" cannot record an analyst decision` };
    }

    const parsed = DecisionBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid decision body", issues: parsed.error.issues };
    }
    const decision = { ...parsed.data, analystId };

    const record = getCaseRecord(params.id);
    if (record.state !== "AWAITING_ANALYST") {
      set.status = 409;
      return { error: `Case is in state "${record.state}", not AWAITING_ANALYST — no decision can be recorded` };
    }

    const aiRecommendation = record.casePacket?.recommendation;
    if (aiRecommendation && decision.disposition !== aiRecommendation && !decision.overrideReason) {
      set.status = 400;
      return {
        error: `Disposition "${decision.disposition}" differs from the AI recommendation ` +
          `"${aiRecommendation}" — overrideReason is required`,
      };
    }

    try {
      assertTransition("AWAITING_ANALYST", "DISPOSITION_RECORDED");
    } catch (err) {
      set.status = 409;
      return { error: (err as IllegalTransitionError).message };
    }

    updateCaseRecord(params.id, { state: "DISPOSITION_RECORDED", disposition: decision });
    await appendAuditEvent({
      type: "analyst_decision",
      timestamp: new Date().toISOString(),
      caseId: params.id,
      analystId,
      disposition: decision.disposition,
      rationale: decision.rationale,
      overrideReason: decision.overrideReason,
      aiRecommendation,
    });
    await appendAuditEvent({
      type: "state_transition",
      timestamp: new Date().toISOString(),
      caseId: params.id,
      fromState: "AWAITING_ANALYST",
      toState: "DISPOSITION_RECORDED",
      reason: `analyst ${analystId} recorded disposition ${decision.disposition}`,
    });

    // Step 9/10 (simplified): the SAR handoff is a stub — there is no filing
    // tool anywhere to hand off to. Move straight to QA, recording whether this
    // matched the AI's own recommendation (override tracking).
    assertTransition("DISPOSITION_RECORDED", "QA");
    updateCaseRecord(params.id, { state: "QA" });
    await appendAuditEvent({
      type: "state_transition",
      timestamp: new Date().toISOString(),
      caseId: params.id,
      fromState: "DISPOSITION_RECORDED",
      toState: "QA",
      reason: "case closed to QA after analyst disposition",
    });

    return {
      caseId: params.id,
      state: "QA",
      disposition: decision.disposition,
      matchedAiRecommendation: aiRecommendation ? decision.disposition === aiRecommendation : null,
    };
  })

  .post("/:id/analyst/draft-narrative", async ({ params, body, headers, set }) => {
    const { role } = readIdentity(headers);
    if (role !== "analyst") {
      set.status = 403;
      return { error: `Role "${role}" cannot request a draft narrative` };
    }

    const parsed = DraftNarrativeBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid request body", issues: parsed.error.issues };
    }

    try {
      const result = await invokeTool(
        "writeDraftNarrative",
        { caseId: params.id, text: parsed.data.text },
        params.id,
        { caseId: params.id, agentName: "analyst-directed", allowedTools: ["writeDraftNarrative"] },
      );
      return { caseId: params.id, written: result };
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        set.status = 403;
        return { error: err.message };
      }
      throw err;
    }
  });
