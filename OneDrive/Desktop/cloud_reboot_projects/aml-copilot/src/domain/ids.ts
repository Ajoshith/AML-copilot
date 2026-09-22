import { z } from "zod";

/**
 * Every fact in the system carries a source_id naming its provenance layer, e.g.
 * "txn:ibm:HI-Small:4412903", "sdn:ofac:2026-08-14:12345", "kyc:overlay:ACC-8347:v3",
 * "policy:ffiec-appF:funds-transfers:7". The prefix before the first ":" is the layer,
 * used by the UI to render overlay-sourced facts distinctly from real-source facts.
 */
export const SourceIdSchema = z
  .string()
  .regex(/^(txn|sdn|kyc|alert|policy|note):[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.:-]+$/, {
    message: "source_id must look like <layer>:<provenance>:<key>",
  });
export type SourceId = z.infer<typeof SourceIdSchema>;

export const REAL_SOURCE_LAYERS = new Set(["txn", "sdn", "policy"]);
export const OVERLAY_SOURCE_LAYERS = new Set(["kyc", "alert", "note"]);

export function sourceLayer(id: SourceId): string {
  return id.split(":", 1)[0]!;
}

export function isRealSource(id: SourceId): boolean {
  return REAL_SOURCE_LAYERS.has(sourceLayer(id));
}

export type CaseId = string;
