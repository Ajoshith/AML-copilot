import { readFileSync } from "node:fs";
import { ROOT_DIR } from "../config.ts";

/**
 * The fixed exchange rates the IBM AMLworld simulator used, recovered from its own
 * cross-currency rows by scripts/derive-fx-rates.ts. Used only to put amounts in
 * different currencies on one scale. Native amounts remain the record of truth, and
 * every USD figure built from these is named "...Usd" so it is never mistaken for one.
 */
const table = JSON.parse(readFileSync(`${ROOT_DIR}/data/reference/fx-rates.json`, "utf8")) as {
  rates: Record<string, { unitsPerUsd: number }>;
};

export const FX_UNITS_PER_USD: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(table.rates).map(([currency, r]) => [currency, r.unitsPerUsd]),
);

/** Converts a native amount to US-dollar equivalent. An unknown currency is an error,
 * never a silent 1:1 conversion, which is exactly the mixing this module exists to stop. */
export function toUsd(amount: number, currency: string): number {
  const rate = FX_UNITS_PER_USD[currency];
  if (rate === undefined) throw new Error(`No exchange rate for currency "${currency}" in data/reference/fx-rates.json`);
  return amount / rate;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
