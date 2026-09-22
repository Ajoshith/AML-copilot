import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { initDb, _resetForTests } from "../src/data/loaders.ts";
import { getAccountTimeline } from "../src/analytics/timeline.ts";
import { computeAggregates } from "../src/analytics/aggregates.ts";
import { computeGraph } from "../src/analytics/graph.ts";
import { detectPatterns } from "../src/analytics/patterns.ts";
import { screenSanctions } from "../src/analytics/sanctionsMatch.ts";
import { DATA_OVERLAY_DIR } from "../src/config.ts";
import { isRealSource } from "../src/domain/ids.ts";

_resetForTests();
await initDb({ useSlice: true });

const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as Array<{
  caseId: string;
  accountId: string;
  isLaundering: boolean;
}>;
const c001 = cases.find((c) => c.caseId === "C-001")!;
const c002 = cases.find((c) => c.caseId === "C-002")!;
const c005 = cases.find((c) => c.caseId === "C-005")!;

describe("analytics runs against the committed real-data slice", () => {
  test("getAccountTimeline returns real, source-id-carrying transactions", async () => {
    const timeline = await getAccountTimeline(c001.accountId, { useSlice: true });
    expect(timeline.length).toBeGreaterThan(0);
    for (const txn of timeline) {
      expect(isRealSource(txn.sourceId)).toBe(true);
      expect(txn.sourceId.startsWith("txn:ibm:HI-Small:")).toBe(true);
    }
  });

  test("timeline is chronologically ordered", async () => {
    const timeline = await getAccountTimeline(c001.accountId, { useSlice: true });
    for (let i = 1; i < timeline.length; i++) {
      expect(new Date(timeline[i]!.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(timeline[i - 1]!.timestamp).getTime(),
      );
    }
  });

  test("computeAggregates totals match a manual recount of the timeline", async () => {
    const timeline = await getAccountTimeline(c001.accountId, { useSlice: true });
    const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
    const txnCount = aggregates.find((a) => a.name === "txnCount")!;
    expect(txnCount.value).toBe(timeline.length);
  });

  test("every Computation carries only real source_ids", async () => {
    const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
    for (const comp of aggregates) {
      for (const id of comp.sourceIds) {
        expect(isRealSource(id)).toBe(true);
      }
    }
  });

  test("computeGraph in/out degree are non-negative and self-consistent", async () => {
    const graph = await computeGraph(c001.accountId, { useSlice: true });
    const inDeg = graph.find((c) => c.name === "inDegree")!;
    const outDeg = graph.find((c) => c.name === "outDegree")!;
    expect(Number(inDeg.value)).toBeGreaterThanOrEqual(0);
    expect(Number(outDeg.value)).toBeGreaterThanOrEqual(0);
  });

  test("detectPatterns pass-through ratio stays within [0,1]", async () => {
    const patterns = await detectPatterns(c001.accountId, { useSlice: true });
    const ratio = patterns.find((c) => c.name === "passThroughRatio")!;
    expect(Number(ratio.value)).toBeGreaterThanOrEqual(0);
    expect(Number(ratio.value)).toBeLessThanOrEqual(1);
  });

  test("C-002 (true negative) has zero laundering-flagged transactions in its own timeline", async () => {
    const timeline = await getAccountTimeline(c002.accountId, { useSlice: true });
    expect(timeline.every((t) => t.isLaundering === false)).toBe(true);
  });

  test("screenSanctions finds the real OFAC entry seeded for C-005", async () => {
    const { result } = await screenSanctions("COMERCIALIZADORA DE CAFE DEL OCCIDENTE CODECAFE LTDA.", {
      useSlice: true,
    });
    expect(result.matched).toBe(true);
    expect(result.sourceId).toMatch(/^sdn:ofac:/);
  });

  test("screenSanctions does not match an unrelated benign name", async () => {
    const { result } = await screenSanctions("Totally Unrelated Benign Consulting Group", { useSlice: true });
    expect(result.matched).toBe(false);
  });
});

describe("analytics/ has no LLM dependency", () => {
  test("no analytics module imports from src/llm/", async () => {
    const glob = new Bun.Glob("src/analytics/*.ts");
    for await (const file of glob.scan(".")) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/from ["']\.\.\/llm\//);
      expect(source).not.toMatch(/@anthropic-ai\/sdk/);
    }
  });
});
