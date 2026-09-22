import { z } from "zod";
import { SourceIdSchema } from "./ids.ts";

/**
 * Analyst notes / wire memo free text. Entirely fabricated overlay content — this
 * is the untrusted-content surface: retrieved text an agent reads but must never
 * treat as instructions. Case C-006's notes carry the injection-test payload corpus.
 */
export const NoteSchema = z.object({
  sourceId: SourceIdSchema,
  accountId: z.string(),
  text: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;
