import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { cassetteKey, writeCassette } from "../src/llm/cassette.ts";
import { callAgent } from "../src/llm/call.ts";
import { CASSETTE_DIR, POLICY_VERSION, PROMPT_VERSION, MODEL_ID, AGENT_EFFORT } from "../src/config.ts";

const TestSchema = z.object({ greeting: z.string() });

describe("cassette key", () => {
  test("is deterministic for identical inputs", () => {
    const input = {
      model: "claude-sonnet-5",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      schemaName: "Test",
      policyVersion: POLICY_VERSION,
      promptVersion: "1.0.0",
      effort: "high",
    };
    expect(cassetteKey(input)).toBe(cassetteKey(input));
  });

  test("changes when policyVersion changes — a policy refresh can't hide behind a stale cassette", () => {
    const base = {
      model: "claude-sonnet-5",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      schemaName: "Test",
      promptVersion: "1.0.0",
      effort: "high",
    };
    const keyA = cassetteKey({ ...base, policyVersion: "2026.01.0" });
    const keyB = cassetteKey({ ...base, policyVersion: "2026.02.0" });
    expect(keyA).not.toBe(keyB);
  });
});

describe("callAgent in replay mode (AML_LLM_MODE=replay, the test default)", () => {
  test("a missing cassette is an error, never a silent live call", async () => {
    await expect(
      callAgent({
        caseId: "NO-SUCH-CASE",
        agentName: "test-agent",
        schemaName: "TestSchema-missing-" + crypto.randomUUID(),
        systemPrompt: "sys",
        userContent: "this exact cassette does not exist",
        outputSchema: TestSchema,
      }),
    ).rejects.toThrow(/No cassette found/);
  });

  test("a pre-seeded cassette is read, validated, and returned without any network call", async () => {
    const schemaName = "TestSchema-seeded";
    const systemPrompt = "sys";
    const userContent = "hello";
    // Must be built from the SAME config constants callAgent uses — hardcoding
    // any of them (this previously pinned "claude-sonnet-5") makes the seeded
    // key silently drift from the requested one as soon as the configured
    // provider/model/effort changes, and the test then fails for an unrelated
    // reason.
    const key = cassetteKey({
      model: MODEL_ID,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      schemaName,
      policyVersion: POLICY_VERSION,
      promptVersion: PROMPT_VERSION,
      effort: AGENT_EFFORT,
    });
    await writeCassette(key, { parsedOutput: { greeting: "hello from cassette" } });

    const result = await callAgent({
      caseId: "SEEDED-CASE",
      agentName: "test-agent",
      schemaName,
      systemPrompt,
      userContent,
      outputSchema: TestSchema,
    });
    expect(result.greeting).toBe("hello from cassette");

    await rm(`${CASSETTE_DIR}/${key}.json`, { force: true });
  });

  test("a cassette whose content fails schema validation throws, not silently coerced", async () => {
    const schemaName = "TestSchema-invalid";
    const systemPrompt = "sys";
    const userContent = "invalid case";
    const key = cassetteKey({
      model: MODEL_ID,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      schemaName,
      policyVersion: POLICY_VERSION,
      promptVersion: PROMPT_VERSION,
      effort: AGENT_EFFORT,
    });
    await writeCassette(key, { parsedOutput: { wrongField: 123 } });

    await expect(
      callAgent({
        caseId: "INVALID-CASE",
        agentName: "test-agent",
        schemaName,
        systemPrompt,
        userContent,
        outputSchema: TestSchema,
      }),
    ).rejects.toThrow();

    await rm(`${CASSETTE_DIR}/${key}.json`, { force: true });
  });
});
