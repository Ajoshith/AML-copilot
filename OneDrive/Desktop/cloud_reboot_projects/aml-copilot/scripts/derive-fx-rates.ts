/**
 * Derives the exchange rates the IBM AMLworld simulation used, from its own
 * transactions, and writes them to data/reference/fx-rates.json.
 *
 * The dataset records both sides of every cross-currency payment (amount paid in one
 * currency, amount received in another). Its simulator used one fixed rate per
 * currency: across thousands of rows each rate varies by under 0.1%, it is identical
 * on every day, and cross rates are consistent (EUR->JPY direct equals the two USD
 * rates combined). So the median of received/paid over rows paid in US Dollars is the
 * rate, recovered from the data rather than taken from an outside source.
 *
 * Needs the full CSV (bun run data:fetch). The output is committed so the pipeline and
 * tests never need the CSV.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { query } from "../src/data/duckdb.ts";
import { initDb } from "../src/data/loaders.ts";
import { ROOT_DIR } from "../src/config.ts";

interface RateRow {
  currency: string;
  units_per_usd: number;
  samples: bigint;
  min_rate: number;
  max_rate: number;
}

async function main() {
  await initDb({ useSlice: false });
  const rows = await query<RateRow>(`
    SELECT receiving_currency                   AS currency,
           median(amount_received / amount_paid) AS units_per_usd,
           count(*)                              AS samples,
           min(amount_received / amount_paid)    AS min_rate,
           max(amount_received / amount_paid)    AS max_rate
    FROM transactions_raw
    WHERE payment_currency = 'US Dollar'
      AND receiving_currency <> 'US Dollar'
      AND amount_paid > 1
    GROUP BY receiving_currency
    ORDER BY receiving_currency
  `);

  const rates: Record<string, { unitsPerUsd: number; samples: number; maxDeviationPct: number }> = {
    "US Dollar": { unitsPerUsd: 1, samples: 0, maxDeviationPct: 0 },
  };
  for (const r of rows) {
    const deviation = Math.max(r.max_rate - r.units_per_usd, r.units_per_usd - r.min_rate) / r.units_per_usd;
    rates[r.currency] = {
      unitsPerUsd: Number(r.units_per_usd.toPrecision(10)),
      samples: Number(r.samples),
      maxDeviationPct: Number((deviation * 100).toFixed(4)),
    };
  }

  const out = {
    source: "Derived from IBM AMLworld HI-Small_Trans.csv: median of Amount Received / Amount Paid over rows paid in US Dollars",
    note: "The simulator used one fixed rate per currency. Amounts are converted to US-dollar equivalents for comparison only; the native amounts stay the record of truth.",
    rates,
  };
  const dir = `${ROOT_DIR}/data/reference`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/fx-rates.json`, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${Object.keys(rates).length} rates to data/reference/fx-rates.json`);
  for (const [c, v] of Object.entries(rates)) console.log(`  ${c.padEnd(18)} ${v.unitsPerUsd}  (n=${v.samples}, max deviation ${v.maxDeviationPct}%)`);
}

if (import.meta.main) {
  await main();
  process.exit(0);
}
