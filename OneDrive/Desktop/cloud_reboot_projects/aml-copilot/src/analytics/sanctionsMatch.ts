import { readFile } from "node:fs/promises";
import { query } from "../data/duckdb.ts";
import { initDb } from "../data/loaders.ts";
import { computation } from "./shared.ts";
import type { Computation } from "../domain/computation.ts";
import type { SourceId } from "../domain/ids.ts";
import { DATA_RAW_DIR } from "../config.ts";

/** Below this Jaro-Winkler score, a name pair is not considered a plausible match. */
const MATCH_THRESHOLD = 0.85;

interface SdnMatchRow {
  ent_num: string;
  sdn_name: string;
  program: string;
  score: number;
}

interface AltMatchRow {
  ent_num: string;
  alt_name: string;
  score: number;
}

export interface SanctionsMatchResult {
  matched: boolean;
  sourceId: SourceId | null;
  matchedName: string | null;
  program: string | null;
  score: number;
  listVersion: string;
}

let cachedListVersion: string | null = null;
async function getListVersion(): Promise<string> {
  if (cachedListVersion) return cachedListVersion;
  cachedListVersion = (await readFile(`${DATA_RAW_DIR}/ofac-list-version.txt`, "utf8")).trim();
  return cachedListVersion;
}

/**
 * Fuzzy-matches an account holder name against the real OFAC SDN list and its real
 * alternate-name table using DuckDB's built-in Jaro-Winkler similarity. This is
 * 100% deterministic string comparison — the AML agent never adjudicates a
 * sanctions hit; a match here always routes to the sanctions team (ESCALATED_SANCTIONS),
 * never back into the typology/SAR path.
 */
export async function screenSanctions(
  accountHolderName: string,
  opts: { useSlice?: boolean } = {},
): Promise<{ result: SanctionsMatchResult; computations: Computation[] }> {
  await initDb(opts);
  const listVersion = await getListVersion();
  const inputs = { accountHolderName, threshold: MATCH_THRESHOLD, listVersion };

  const sdnMatches = await query<SdnMatchRow>(
    `
    SELECT ent_num, sdn_name, program,
           jaro_winkler_similarity(upper(sdn_name), upper(?)) AS score
    FROM sdn_entries
    WHERE score >= ?
    ORDER BY score DESC, ent_num ASC
    LIMIT 1
    `,
    [accountHolderName, MATCH_THRESHOLD],
  );

  const altMatches = await query<AltMatchRow>(
    `
    SELECT ent_num, alt_name,
           jaro_winkler_similarity(upper(alt_name), upper(?)) AS score
    FROM sdn_alt_names
    WHERE score >= ?
    ORDER BY score DESC, ent_num ASC
    LIMIT 1
    `,
    [accountHolderName, MATCH_THRESHOLD],
  );

  const best =
    (sdnMatches[0]?.score ?? 0) >= (altMatches[0]?.score ?? 0) ? sdnMatches[0] : undefined;
  const bestAlt = !best ? altMatches[0] : undefined;

  if (best) {
    const sourceId = `sdn:ofac:${listVersion}:${best.ent_num}` as SourceId;
    const result: SanctionsMatchResult = {
      matched: true,
      sourceId,
      matchedName: best.sdn_name,
      program: best.program,
      score: best.score,
      listVersion,
    };
    return {
      result,
      computations: [computation("sanctionsMatchScore", best.score, [sourceId], inputs)],
    };
  }

  if (bestAlt) {
    const sourceId = `sdn:ofac:${listVersion}:${bestAlt.ent_num}` as SourceId;
    const result: SanctionsMatchResult = {
      matched: true,
      sourceId,
      matchedName: bestAlt.alt_name,
      program: null,
      score: bestAlt.score,
      listVersion,
    };
    return {
      result,
      computations: [computation("sanctionsMatchScore", bestAlt.score, [sourceId], inputs)],
    };
  }

  return {
    result: { matched: false, sourceId: null, matchedName: null, program: null, score: 0, listVersion },
    computations: [computation("sanctionsMatchScore", 0, [], inputs)],
  };
}
