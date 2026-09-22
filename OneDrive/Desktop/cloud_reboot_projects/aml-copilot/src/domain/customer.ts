import { z } from "zod";
import { SourceIdSchema } from "./ids.ts";

/**
 * KYC/CDD profile. This layer is entirely generated (data/overlay/), never real customer
 * data — real KYC data is PII with no public equivalent. Deliberately stale/incomplete
 * profiles exist to exercise the data-gap path (see case C-004).
 *
 * `accountHolderName` exists here, not in the transaction data, because the real IBM
 * AMLworld CSV is anonymized to numeric bank/account codes only — it has no names at
 * all. A name is required for sanctions screening to mean anything, so it's part of
 * the fabricated overlay; case C-005 deliberately sets one account's overlay name to
 * fuzzy-match a real OFAC SDN entry. The SDN list itself stays 100% real — only the
 * name attached to *our* account is invented.
 */
export const CustomerRecordSchema = z.object({
  sourceId: SourceIdSchema,
  accountId: z.string(),
  accountHolderName: z.string(),
  occupation: z.string().nullable(),
  businessType: z.string().nullable(),
  statedExpectedMonthlyVolume: z.number().nullable(),
  riskRating: z.enum(["low", "medium", "high"]),
  lastReviewDate: z.string().nullable(), // ISO date; null means never reviewed
  jurisdiction: z.string(),
});
export type CustomerRecord = z.infer<typeof CustomerRecordSchema>;

export const SdnEntrySchema = z.object({
  sourceId: SourceIdSchema,
  sdnName: z.string(),
  altNames: z.array(z.string()),
  program: z.string(),
  listVersion: z.string(), // download date of the OFAC file, stamped by fetch-data.ts
});
export type SdnEntry = z.infer<typeof SdnEntrySchema>;
