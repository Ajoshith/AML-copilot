import { createHash } from "node:crypto";
import type { Computation } from "../domain/computation.ts";
import type { SourceId } from "../domain/ids.ts";

/** Bump whenever a query in analytics/* changes in a way that could change its output
 * for the same inputs — the verifier compares this to detect a stale recomputation. */
export const ANALYTICS_CODE_VERSION = "1.0.0";

export function hashInputs(inputs: Record<string, unknown>): string {
  const json = JSON.stringify(inputs, Object.keys(inputs).sort());
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

export function computation(
  name: string,
  value: number | string | boolean,
  sourceIds: SourceId[],
  inputs: Record<string, unknown>,
): Computation {
  return {
    name,
    value,
    inputsHash: hashInputs(inputs),
    sourceIds,
    codeVersion: ANALYTICS_CODE_VERSION,
  };
}
