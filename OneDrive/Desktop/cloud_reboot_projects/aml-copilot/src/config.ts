import { resolve } from "node:path";

/**
 * Bumping this invalidates every LLM cassette — the cassette key includes it.
 * Bump when typologies.yaml or procedures.md change.
 */
export const POLICY_VERSION = "2026.09.0";

/**
 * Bump when any agent's system prompt changes.
 * 1.1.0 — Verifier scope corrected to the blueprint's §5 step 6 ("packet fails
 *   closed if MATERIAL facts cannot be verified"). 1.0.0 failed 100% of cases by
 *   treating the Typology agent's required data-gap declarations as internal
 *   contradictions and by judging strength calibration, neither of which the
 *   blueprint asks of it; per §9 incomplete data becomes a research task and a
 *   blocking gap on the recommendation, not a withheld packet. The verifier is
 *   also now given the deterministic computations it is asked to verify against.
 */
export const PROMPT_VERSION = "1.1.0";

export type LlmProvider = "anthropic" | "groq";

/**
 * Every agent goes through src/llm/call.ts -> src/llm/client.ts, which is the
 * ONLY place a provider SDK is chosen (via LangChain's ChatAnthropic/ChatGroq
 * wrappers) — no agent module ever imports a provider SDK directly. Switching
 * providers (e.g. to Groq) is this one env var; nothing else in src/agents/ or
 * src/orchestrator/ changes.
 */
function readLlmProvider(): LlmProvider {
  const raw = process.env.AML_LLM_PROVIDER ?? "anthropic";
  if (raw !== "anthropic" && raw !== "groq") {
    throw new Error(`AML_LLM_PROVIDER must be one of anthropic|groq, got "${raw}"`);
  }
  return raw;
}

export const LLM_PROVIDER: LlmProvider = readLlmProvider();

const DEFAULT_MODEL_ID: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-5",
  // A reasoning-capable Groq-hosted model, so AGENT_EFFORT has an actual effect
  // (Groq's reasoningEffort param only does anything on gpt-oss-*/qwen3-32b).
  groq: "openai/gpt-oss-120b",
};

/** Override with AML_MODEL_ID for either provider (e.g. a specific Groq model). */
export const MODEL_ID = process.env.AML_MODEL_ID ?? DEFAULT_MODEL_ID[LLM_PROVIDER];

/**
 * Every agent runs at "high" effort. Originally split medium/high per agent under
 * Opus 5; switched to a flat "high" across the board when the model was changed to
 * Sonnet 5, to compensate for the lower model tier with deeper adaptive thinking.
 * This is Anthropic's `effort` scale (low/medium/high/xhigh/max); src/llm/client.ts
 * maps it down to Groq's coarser reasoningEffort (none/default/low/medium/high)
 * when LLM_PROVIDER is "groq".
 */
export const AGENT_EFFORT = "high" as const;

export const ROOT_DIR = resolve(import.meta.dir, "..");
export const DATA_RAW_DIR = resolve(ROOT_DIR, "data/raw");
export const DATA_SLICE_DIR = resolve(ROOT_DIR, "data/slice");
export const DATA_OVERLAY_DIR = resolve(ROOT_DIR, "data/overlay");
export const POLICY_DIR = resolve(ROOT_DIR, "src/policy");
export const CASSETTE_DIR = resolve(ROOT_DIR, "fixtures/cassettes");
export const AUDIT_DIR = resolve(ROOT_DIR, "audit");

export type LlmMode = "record" | "replay" | "live";

function readLlmMode(): LlmMode {
  const raw = process.env.AML_LLM_MODE ?? "replay";
  if (raw !== "record" && raw !== "replay" && raw !== "live") {
    throw new Error(`AML_LLM_MODE must be one of record|replay|live, got "${raw}"`);
  }
  return raw;
}

export const LLM_MODE: LlmMode = readLlmMode();

export const PORT = Number(process.env.PORT ?? 8787);
