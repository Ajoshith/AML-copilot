import { describe, expect, test } from "bun:test";
import { query } from "../src/data/duckdb.ts";

describe("duckdb wrapper", () => {
  test("runs a basic query", async () => {
    const rows = await query<{ answer: number }>("SELECT 42 AS answer");
    expect(rows).toEqual([{ answer: 42 }]);
  });

  test("supports window functions (needed for patterns.ts)", async () => {
    const rows = await query<{ n: number; running: bigint | number }>(
      "SELECT n, SUM(n) OVER (ORDER BY n) AS running FROM (VALUES (1),(2),(3)) AS t(n)",
    );
    expect(rows.map((r) => Number(r.running))).toEqual([1, 3, 6]);
  });
});
