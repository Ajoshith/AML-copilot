import { z } from "zod";
import { SourceIdSchema } from "./ids.ts";

/**
 * The output of any deterministic analytics function (src/analytics/*). Every number
 * that ends up in a case packet must trace back to one of these — the verifier
 * re-runs the same query and checks `value` matches, using `inputsHash` to confirm it
 * re-ran against the same inputs.
 */
export const ComputationSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string(), z.boolean()]),
  inputsHash: z.string(),
  sourceIds: z.array(SourceIdSchema),
  codeVersion: z.string(),
});
export type Computation = z.infer<typeof ComputationSchema>;
