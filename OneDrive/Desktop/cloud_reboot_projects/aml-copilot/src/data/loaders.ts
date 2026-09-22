import { existsSync } from "node:fs";
import { exec } from "./duckdb.ts";
import { DATA_RAW_DIR, DATA_SLICE_DIR } from "../config.ts";

/**
 * Loads the real IBM AMLworld transactions, real OFAC SDN/alt-name lists, and real
 * FFIEC typology corpus into DuckDB views so every downstream analytics query is
 * plain SQL over real data. Column names below are exactly what DuckDB infers from
 * the raw CSV headers (verified against the actual file) — "Account" appears twice
 * in the source (from/to), so DuckDB renames the second occurrence "Account_1".
 *
 * The 475 MB raw CSV is queried directly by DuckDB's columnar CSV reader rather than
 * loaded into a JS array — this is the whole reason DuckDB is in the stack.
 */

const toSqlPath = (p: string) => p.replace(/\\/g, "/");

const TRANSACTIONS_CSV = toSqlPath(`${DATA_RAW_DIR}/HI-Small_Trans.csv`);
const TRANSACTIONS_SLICE_PARQUET_FS = `${DATA_SLICE_DIR}/transactions.parquet`;
const TRANSACTIONS_SLICE_PARQUET_SQL = toSqlPath(TRANSACTIONS_SLICE_PARQUET_FS);
const SDN_CSV = toSqlPath(`${DATA_RAW_DIR}/sdn.csv`);
const ALT_CSV = toSqlPath(`${DATA_RAW_DIR}/alt.csv`);

let initialized = false;

/**
 * `useSlice: true` (the default — used by tests) points the `transactions_raw` view
 * at the small committed Parquet slice instead of the 475 MB raw CSV, so `bun test`
 * needs no download. `useSlice: false` is for scripts that mine cases from the full
 * dataset. Falls back to the raw CSV if the slice hasn't been built yet.
 */
export async function initDb(opts: { useSlice?: boolean } = {}): Promise<void> {
  const useSlice = opts.useSlice ?? true;
  if (initialized) return;

  const sliceExists = existsSync(TRANSACTIONS_SLICE_PARQUET_FS);

  if (useSlice && sliceExists) {
    // The slice's row id is a column BAKED INTO the Parquet file at build time
    // (see build-overlay.ts's writeSlice) — never recomputed with row_number()
    // here. row_number() OVER () with no ORDER BY lets DuckDB return rows in
    // whatever order its (possibly multi-threaded) scan happens to produce,
    // which is NOT guaranteed stable across separate processes — two different
    // processes reading the identical file could assign the same real
    // transaction two different row ids, silently breaking every source_id
    // that was ever computed from it. A column value, unlike scan order, is
    // always correctly associated with its row regardless of scan order.
    await exec(`
      CREATE OR REPLACE VIEW transactions_raw AS
      SELECT
        original_row_id                               AS row_id,
        "Timestamp"                                   AS ts,
        "From Bank"                                   AS from_bank,
        "Account"                                     AS from_account,
        "To Bank"                                     AS to_bank,
        "Account_1"                                   AS to_account,
        "Amount Received"                             AS amount_received,
        "Receiving Currency"                          AS receiving_currency,
        "Amount Paid"                                 AS amount_paid,
        "Payment Currency"                            AS payment_currency,
        "Payment Format"                              AS payment_format,
        CAST("Is Laundering" AS BOOLEAN)               AS is_laundering
      FROM read_parquet('${TRANSACTIONS_SLICE_PARQUET_SQL}')
    `);
  } else {
    // Full CSV path (mining/build scripts only). No stored row-id column
    // exists here, so row_id is assigned via an explicit deterministic
    // ORDER BY over real data columns — never a bare, unordered row_number().
    await exec(`
      CREATE OR REPLACE VIEW transactions_raw AS
      SELECT
        row_number() OVER (
          ORDER BY "Timestamp", "Account", "Account_1", "From Bank", "To Bank",
                   "Amount Paid", "Payment Format"
        ) - 1                                          AS row_id,
        "Timestamp"                                   AS ts,
        "From Bank"                                   AS from_bank,
        "Account"                                     AS from_account,
        "To Bank"                                     AS to_bank,
        "Account_1"                                   AS to_account,
        "Amount Received"                             AS amount_received,
        "Receiving Currency"                          AS receiving_currency,
        "Amount Paid"                                 AS amount_paid,
        "Payment Currency"                            AS payment_currency,
        "Payment Format"                              AS payment_format,
        CAST("Is Laundering" AS BOOLEAN)               AS is_laundering
      FROM read_csv('${TRANSACTIONS_CSV}',
        header = true,
        columns = {
          'Timestamp': 'TIMESTAMP',
          'From Bank': 'VARCHAR',
          'Account': 'VARCHAR',
          'To Bank': 'VARCHAR',
          'Account_1': 'VARCHAR',
          'Amount Received': 'DOUBLE',
          'Receiving Currency': 'VARCHAR',
          'Amount Paid': 'DOUBLE',
          'Payment Currency': 'VARCHAR',
          'Payment Format': 'VARCHAR',
          'Is Laundering': 'BIGINT'
        })
    `);
  }

  await exec(`
    CREATE OR REPLACE VIEW sdn_entries AS
    SELECT
      column0::VARCHAR AS ent_num,
      column1::VARCHAR AS sdn_name,
      column3::VARCHAR AS program
    FROM read_csv('${SDN_CSV}', header = false, columns = {
      'column0': 'VARCHAR', 'column1': 'VARCHAR', 'column2': 'VARCHAR', 'column3': 'VARCHAR',
      'column4': 'VARCHAR', 'column5': 'VARCHAR', 'column6': 'VARCHAR', 'column7': 'VARCHAR',
      'column8': 'VARCHAR', 'column9': 'VARCHAR', 'column10': 'VARCHAR', 'column11': 'VARCHAR'
    }, ignore_errors = true)
  `);

  await exec(`
    CREATE OR REPLACE VIEW sdn_alt_names AS
    SELECT
      column0::VARCHAR AS alt_num,
      column1::VARCHAR AS ent_num,
      column3::VARCHAR AS alt_name
    FROM read_csv('${ALT_CSV}', header = false, columns = {
      'column0': 'VARCHAR', 'column1': 'VARCHAR', 'column2': 'VARCHAR',
      'column3': 'VARCHAR', 'column4': 'VARCHAR'
    }, ignore_errors = true)
  `);

  initialized = true;
}

/** Test-only: forces the next initDb() call to re-run (e.g. after switching sources). */
export function _resetForTests(): void {
  initialized = false;
}

export function sourceIdForRow(rowId: number | bigint): string {
  return `txn:ibm:HI-Small:${rowId}`;
}
