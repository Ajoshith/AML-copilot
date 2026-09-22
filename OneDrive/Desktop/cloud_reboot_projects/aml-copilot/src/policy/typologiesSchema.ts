import { z } from "zod";
import { stringify, parse } from "yaml";
import { readFile, writeFile } from "node:fs/promises";
import { POLICY_DIR, POLICY_VERSION } from "../config.ts";

export const TypologyClauseSchema = z.object({
  id: z.string(),
  text: z.string(),
});
export type TypologyClause = z.infer<typeof TypologyClauseSchema>;

export const TypologySectionSchema = z.object({
  category: z.string(),
  section: z.string(),
  slug: z.string(),
  clauses: z.array(TypologyClauseSchema),
});
export type TypologySection = z.infer<typeof TypologySectionSchema>;

export const TypologyCorpusSchema = z.object({
  policyVersion: z.string(),
  source: z.literal("FFIEC BSA/AML Manual Appendix F"),
  sourceUrl: z.literal("https://bsaaml.ffiec.gov/manual/Appendices/07"),
  fetchedAt: z.string(),
  sections: z.array(TypologySectionSchema),
});
export type TypologyCorpus = z.infer<typeof TypologyCorpusSchema>;

const YAML_PATH = () => `${POLICY_DIR}/typologies.yaml`;

export async function writeTypologiesYaml(sections: TypologySection[]): Promise<void> {
  const corpus: TypologyCorpus = {
    policyVersion: POLICY_VERSION,
    source: "FFIEC BSA/AML Manual Appendix F",
    sourceUrl: "https://bsaaml.ffiec.gov/manual/Appendices/07",
    fetchedAt: new Date().toISOString(),
    sections,
  };
  TypologyCorpusSchema.parse(corpus); // fail loudly if the shape is wrong before writing
  await writeFile(YAML_PATH(), stringify(corpus), "utf8");
}

let cached: TypologyCorpus | null = null;

export async function loadTypologyCorpus(): Promise<TypologyCorpus> {
  if (cached) return cached;
  const raw = await readFile(YAML_PATH(), "utf8");
  cached = TypologyCorpusSchema.parse(parse(raw));
  return cached;
}

/** Flat lookup of every clause id -> clause, across all sections. Used to validate
 * that the typology agent only ever cites clauses that really exist in the corpus. */
export async function clauseIndex(): Promise<Map<string, TypologyClause>> {
  const corpus = await loadTypologyCorpus();
  const map = new Map<string, TypologyClause>();
  for (const section of corpus.sections) {
    for (const clause of section.clauses) {
      map.set(clause.id, clause);
    }
  }
  return map;
}
