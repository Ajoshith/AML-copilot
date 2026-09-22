import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CASSETTE_DIR } from "../config.ts";

/**
 * Cassette key = sha256(model, system, messages, schemaName, policyVersion,
 * promptVersion, effort). Any change to policy or prompt version invalidates every
 * cassette that depended on it — a stale cassette can never silently mask a policy
 * update. `AML_LLM_MODE=replay` (the test default) reads from these files only; a
 * missing cassette is an error, never a silent live call — see llm/call.ts.
 */
export interface CassetteKeyInput {
  model: string;
  system: string;
  messages: unknown;
  schemaName: string;
  policyVersion: string;
  promptVersion: string;
  effort: string;
}

/**
 * A deterministic, deep stable-stringify: object keys are sorted recursively
 * (so key insertion order never affects the hash) while every value at every
 * depth is preserved — including inside arrays. This is NOT the same as
 * `JSON.stringify(value, Object.keys(value).sort())`: passing an array as
 * `JSON.stringify`'s second argument uses it as a property whitelist applied
 * at every nesting level, which silently drops any nested key (e.g. a
 * message's `role`/`content`) not present in that top-level list — collapsing
 * every distinct prompt to the same serialized `{}` and therefore the same
 * cassette key. Caught via a stale-cassette collision during manual testing;
 * see tests/llmCassette.test.ts for the regression test.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cassetteKey(input: CassetteKeyInput): string {
  const json = stableStringify(input);
  return createHash("sha256").update(json).digest("hex");
}

export interface CassetteRecord {
  parsedOutput: unknown;
  usage?: Record<string, number>;
}

function pathFor(key: string): string {
  return `${CASSETTE_DIR}/${key}.json`;
}

export async function readCassette(key: string): Promise<CassetteRecord | null> {
  const path = pathFor(key);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as CassetteRecord;
}

export async function writeCassette(key: string, record: CassetteRecord): Promise<void> {
  await mkdir(CASSETTE_DIR, { recursive: true });
  await writeFile(pathFor(key), JSON.stringify(record, null, 2), "utf8");
}
