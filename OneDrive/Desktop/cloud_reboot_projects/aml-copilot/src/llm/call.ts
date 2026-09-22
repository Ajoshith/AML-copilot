import type { z } from "zod";
import { HumanMessage, SystemMessage, type AIMessage } from "@langchain/core/messages";
import { MODEL_ID, AGENT_EFFORT, POLICY_VERSION, PROMPT_VERSION, LLM_MODE, LLM_PROVIDER } from "../config.ts";
import { createChatModel } from "./client.ts";
import { cassetteKey, readCassette, writeCassette } from "./cassette.ts";
import { appendAuditEvent } from "../audit/log.ts";

/** Distinguishable from a generic failure so callers (the verifier, the
 * orchestrator) can route a refused request differently from a parse failure.
 * Anthropic-only: a "refusal" stop reason is a safety-classifier concept
 * specific to Anthropic's API, with no equivalent surfaced by Groq. */
export class RefusalError extends Error {}

export interface CallAgentParams<TSchema extends z.ZodTypeAny> {
  caseId: string;
  agentName: string;
  /** A stable name for the output schema (e.g. "TypologyAssessment"). Part of the
   * cassette key, so changing an agent's output shape invalidates its cassettes. */
  schemaName: string;
  systemPrompt: string;
  userContent: string;
  outputSchema: TSchema;
  maxTokens?: number;
}

/**
 * The single call path every agent uses to reach an LLM. Model, provider, effort
 * and thinking mode are fixed constants from src/config.ts / src/llm/client.ts —
 * no agent chooses its own model or imports a provider SDK. Going through
 * LangChain's `withStructuredOutput(schema, { method: "jsonSchema" })` here
 * (rather than a provider SDK's raw structured-output API) is what makes the
 * provider swappable: Anthropic serves this from its native guaranteed JSON
 * schema output; Groq serves the equivalent OpenAI-compatible strict
 * `json_schema` response format — same call shape either way. A parse failure
 * is a possible, typed outcome (`result.parsed === null`), never a best-effort
 * string parse.
 */
export async function callAgent<TSchema extends z.ZodTypeAny>(
  params: CallAgentParams<TSchema>,
): Promise<z.infer<TSchema>> {
  const { caseId, agentName, schemaName, systemPrompt, userContent, outputSchema, maxTokens = 16000 } = params;

  const messages = [{ role: "user" as const, content: userContent }];
  const key = cassetteKey({
    model: MODEL_ID,
    system: systemPrompt,
    messages,
    schemaName,
    policyVersion: POLICY_VERSION,
    promptVersion: PROMPT_VERSION,
    effort: AGENT_EFFORT,
  });

  const start = Date.now();
  let parsedOutput: unknown;
  let usage: Record<string, number> | undefined;

  if (LLM_MODE === "replay") {
    const cached = await readCassette(key);
    if (!cached) {
      throw new Error(
        `No cassette found for key ${key} (agent="${agentName}", case="${caseId}"). ` +
          `Run with AML_LLM_MODE=record to create it first — a missing cassette in replay ` +
          `mode is an error, never a silent live call.`,
      );
    }
    parsedOutput = cached.parsedOutput;
    usage = cached.usage;
  } else {
    const model = createChatModel({ maxTokens });
    const structured = model.withStructuredOutput(outputSchema, {
      name: schemaName,
      includeRaw: true,
      method: "jsonSchema",
    });

    const result = await structured.invoke([new SystemMessage(systemPrompt), new HumanMessage(userContent)]);

    // Both providers' `includeRaw: true` pipelines fall back to `parsed: null`
    // on any parse failure rather than throwing, so `result.raw` (and its
    // response_metadata / usage_metadata) is always available here — even on
    // a refusal or a malformed response. It is typed as the BaseMessage the
    // Runnable contract promises; every chat model resolves it to an AIMessage.
    const raw = result.raw as AIMessage;
    const stopReason = (raw.response_metadata as { stop_reason?: string } | undefined)?.stop_reason;
    if (LLM_PROVIDER === "anthropic" && stopReason === "refusal") {
      throw new RefusalError(`Model refused the request for agent "${agentName}" on case "${caseId}"`);
    }
    if (result.parsed === null || result.parsed === undefined) {
      throw new Error(`Structured output parse failed for agent "${agentName}" on case "${caseId}"`);
    }

    parsedOutput = result.parsed;
    const usageMeta = raw.usage_metadata;
    usage = {
      inputTokens: usageMeta?.input_tokens ?? 0,
      outputTokens: usageMeta?.output_tokens ?? 0,
      cacheReadInputTokens: usageMeta?.input_token_details?.cache_read ?? 0,
      cacheCreationInputTokens: usageMeta?.input_token_details?.cache_creation ?? 0,
    };

    if (LLM_MODE === "record") {
      await writeCassette(key, { parsedOutput, usage });
    }
  }

  await appendAuditEvent({
    type: "model_call",
    timestamp: new Date().toISOString(),
    caseId,
    agentName,
    model: MODEL_ID,
    promptVersion: PROMPT_VERSION,
    policyVersion: POLICY_VERSION,
    effort: AGENT_EFFORT,
    cassetteKey: key,
    cassetteMode: LLM_MODE,
    usage,
    latencyMs: Date.now() - start,
  });

  return outputSchema.parse(parsedOutput);
}
