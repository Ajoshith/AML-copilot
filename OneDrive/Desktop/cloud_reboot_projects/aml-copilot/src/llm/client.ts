import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGroq } from "@langchain/groq";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LLM_PROVIDER, MODEL_ID, AGENT_EFFORT } from "../config.ts";

/** Anthropic's effort scale is finer-grained than Groq's reasoningEffort param
 * (which only "none"/"default"/"low"/"medium"/"high" and only affects a few
 * reasoning-capable Groq-hosted models) — xhigh/max both clamp down to "high". */
const GROQ_EFFORT_BY_ANTHROPIC_EFFORT: Record<string, "low" | "medium" | "high"> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

/**
 * Builds a fresh LangChain chat model for the configured provider
 * (AML_LLM_PROVIDER — see src/config.ts). This is the ONLY place a provider SDK
 * is chosen; every agent goes through callAgent() (src/llm/call.ts), never a
 * provider client directly, so switching providers is a one-line config change.
 *
 * A fresh instance is returned per call rather than a cached singleton, because
 * maxTokens legitimately varies per agent (the Typology agent needs a larger
 * budget than the rest) and constructing a LangChain chat model wrapper is a
 * cheap, connectionless operation (it just captures credentials/config; the
 * underlying HTTP client is created lazily on first request) — there is no
 * pooled resource here worth caching.
 */
export function createChatModel(opts: { maxTokens?: number } = {}): BaseChatModel {
  const maxTokens = opts.maxTokens ?? 16000;

  if (LLM_PROVIDER === "groq") {
    return new ChatGroq({
      model: MODEL_ID,
      maxTokens,
      reasoningEffort: GROQ_EFFORT_BY_ANTHROPIC_EFFORT[AGENT_EFFORT] ?? "high",
    });
  }

  return new ChatAnthropic({
    model: MODEL_ID,
    maxTokens,
    // Adaptive thinking is Anthropic-only; Groq reasoning models manage their
    // own internal reasoning and have no equivalent parameter.
    thinking: { type: "adaptive" },
    outputConfig: { effort: AGENT_EFFORT },
    // Required, not a preference: at these maxTokens with adaptive thinking the
    // Anthropic SDK rejects non-streamed requests outright ("Streaming is
    // required for operations that may take longer than 10 minutes"). LangChain
    // aggregates the stream back into a single message, so callAgent() still
    // sees one complete response, and streamUsage (on by default) keeps token
    // usage populated for the audit log.
    streaming: true,
  });
}
