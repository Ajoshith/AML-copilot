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

  test("C-001 money in and out are directional and in US-dollar equivalent", async () => {
    const byName = new Map(
      [...(await computeAggregates(c001.accountId, { useSlice: true })), ...(await detectPatterns(c001.accountId, { useSlice: true }))].map(
        (c) => [c.name, c.value],
      ),
    );
    // 77 rows: 31 from other accounts, 35 to other accounts, 11 to itself.
    expect(byName.get("txnCount")).toBe(77);
    expect(byName.get("inflowCount")).toBe(31);
    expect(byName.get("outflowCount")).toBe(35);
    expect(byName.get("selfTransferCount")).toBe(11);
    // Previously reported as "$324.8M received" (every row, seven currencies summed).
    expect(byName.get("totalInUsd")).toBeCloseTo(111_584.25, 0);
    expect(byName.get("totalOutUsd")).toBeCloseTo(117_196_632.23, 0);
    // Previously capped and reported as 1.00.
    expect(byName.get("outflowToInflowRatio")).toBeCloseTo(1050.2973, 3);
    expect(byName.has("totalReceived")).toBe(false);
    expect(byName.has("passThroughRatio")).toBe(false);
  });

  test("no computed total adds different currencies together", async () => {
    const aggregates = await computeAggregates(c001.accountId, { useSlice: true });
    const timeline = await getAccountTimeline(c001.accountId, { useSlice: true });
    // Each native per-currency total equals the sum of that currency's own rows only.
    for (const c of aggregates.filter((c) => /^inflow:/.test(c.name))) {
      const ccy = c.name.slice("inflow:".length);
      const expected = timeline
        .filter((t) => t.toAccount === c001.accountId && t.fromAccount !== c001.accountId && t.receivingCurrency === ccy)
        .reduce((s, t) => s + t.amountReceived, 0);
      expect(Number(c.value)).toBeCloseTo(expected, 2);
    }
    // Every cross-currency total is labelled as a US-dollar equivalent.
    const money = aggregates.filter((c) => /total/i.test(c.name) && !/count/i.test(c.name));
    expect(money.length).toBeGreaterThan(0);
    for (const c of money) expect(c.name).toMatch(/Usd$/);
  });

  test("the exchange rates reproduce the dataset's own cross-currency payments", async () => {
    const { FX_UNITS_PER_USD } = await import("../src/analytics/fx.ts");
    let checked = 0;
    for (const c of cases) {
      for (const t of await getAccountTimeline(c.accountId, { useSlice: true })) {
        if (t.paymentCurrency !== "US Dollar" || t.receivingCurrency === "US Dollar" || t.amountPaid <= 1) continue;
        const implied = t.amountReceived / t.amountPaid;
        const rate = FX_UNITS_PER_USD[t.receivingCurrency]!;
        expect(Math.abs(implied - rate) / rate).toBeLessThan(0.01);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
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
