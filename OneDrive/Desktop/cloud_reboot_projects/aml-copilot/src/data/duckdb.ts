import { Database, type TableData } from "duckdb";

/**
 * Single in-process DuckDB connection shared by loaders, store and analytics.
 * DuckDB queries the CSV/Parquet files directly rather than loading 5M+ rows into
 * JS objects — the columnar engine is the point: aggregation and window-function
 * math over the transaction data stays fast and stays SQL (i.e. auditable, no LLM).
 *
 * The native binding is not safe for truly concurrent in-flight calls on one
 * Database/Connection — under `bun test`, async calls from different test files
 * can interleave on the same event loop and hit the native layer at once,
 * surfacing as an opaque `DUCKDB_NODEJS_ERROR "Invalid"` with no message. `queue`
 * below serializes every query/exec through a single promise chain so calls
 * never overlap, regardless of how many callers fire them "simultaneously".
 */
const db = new Database(":memory:");

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  // Swallow rejections in the chain itself (not in what callers receive) so one
  // failed query doesn't permanently wedge the queue for everyone after it.
  queue = result.catch(() => {});
  return result;
}

export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return enqueue(
    () =>
      new Promise<T[]>((resolvePromise, reject) => {
        const cb = (err: Error | null, rows: TableData) => {
          if (err) reject(err);
          else resolvePromise(rows as unknown as T[]);
        };
        if (params.length > 0) {
          db.all(sql, ...params, cb);
        } else {
          db.all(sql, cb);
        }
      }),
  );
}

export function exec(sql: string): Promise<void> {
  return enqueue(
    () =>
      new Promise<void>((resolvePromise, reject) => {
        db.exec(sql, (err: Error | null) => {
          if (err) reject(err);
          else resolvePromise();
        });
      }),
  );
}

export { db };
