import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { cassetteKey, writeCassette } from "../../src/llm/cassette.ts";
import { MODEL_ID, AGENT_EFFORT, POLICY_VERSION, PROMPT_VERSION, CASSETTE_DIR } from "../../src/config.ts";

function pathFor(key: string): string {
  return `${CASSETTE_DIR}/${key}.json`;
}

/**
 * A cassette key is a hash of the REQUEST only (model/system/messages/schema/
 * versions) — never the response — so a test that seeds a placeholder cassette
 * for a real mined case (C-001, C-005, C-006, ...) can land on the exact same
 * key as scripts/seed-demo-cassettes.ts's cassette for that same case, since
 * both build their request from the same real transactions/notes/KYC data.
 * Blindly overwriting-then-deleting by key (the original implementation) would
 * silently clobber and then permanently delete that shared demo cassette the
 * moment any test touching the same case ran — which is exactly what happened:
 * the live API/UI and `scripts/evaluate.ts` started failing with "no cassette
 * found" for C-001/C-005/C-006 after nothing but `bun test` had run. This map
 * snapshots whatever was on disk (if anything) the first time this process
 * seeds a given key, so removeCassette can restore it instead of deleting it.
 */
const originalContentByKey = new Map<string, string | null>();

/**
 * Seeds a cassette under EXACTLY the key callAgent computes for the given
 * (systemPrompt, userContent, schemaName) triple — the same key a real recorded
 * cassette would have, so a run*Agent() call finds it in replay mode with no
 * live API call. Tests must build userContent with each agent's exported
 * buildXxxUserContent() function, never by hand, so the key can never drift
 * from what the real agent module constructs.
 */
export async function seedCassette(
  schemaName: string,
  systemPrompt: string,
  userContent: string,
  parsedOutput: unknown,
): Promise<string> {
  const key = cassetteKey({
    model: MODEL_ID,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
    schemaName,
    policyVersion: POLICY_VERSION,
    promptVersion: PROMPT_VERSION,
    effort: AGENT_EFFORT,
  });

  if (!originalContentByKey.has(key)) {
    const path = pathFor(key);
    originalContentByKey.set(key, existsSync(path) ? await readFile(path, "utf8") : null);
  }

  await writeCassette(key, { parsedOutput });
  return key;
}

/** Restores whatever cassette (if any) originally lived at this key before this
 * test process's first seedCassette() call for it, instead of deleting a file
 * that may belong to another test file or to the committed demo fixture set. */
export async function removeCassette(key: string): Promise<void> {
  const original = originalContentByKey.get(key);
  originalContentByKey.delete(key);
  if (original === undefined) {
    // Never seeded through this helper in this process — leave it alone.
    return;
  }
  if (original === null) {
    await rm(pathFor(key), { force: true });
  } else {
    await writeFile(pathFor(key), original, "utf8");
  }
}

export async function removeCassettes(keys: string[]): Promise<void> {
  await Promise.all(keys.map(removeCassette));
}
