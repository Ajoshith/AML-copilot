import { z } from "zod";
import { SourceIdSchema } from "./ids.ts";

/** One row of HI-Small_Trans.csv, normalized. Columns match the real IBM AMLworld schema. */
export const PaymentFormatSchema = z.enum([
  "Cheque",
  "Credit Card",
  "ACH",
  "Cash",
  "Wire",
  "Reinvestment",
  "Bitcoin",
]);
export type PaymentFormat = z.infer<typeof PaymentFormatSchema>;

export const TransactionSchema = z.object({
  sourceId: SourceIdSchema,
  timestamp: z.string(), // ISO 8601, parsed from the CSV's own timestamp column
  fromBank: z.string(),
  fromAccount: z.string(),
  toBank: z.string(),
  toAccount: z.string(),
  amountReceived: z.number(),
  receivingCurrency: z.string(),
  amountPaid: z.number(),
  paymentCurrency: z.string(),
  paymentFormat: PaymentFormatSchema,
  isLaundering: z.boolean(), // ground truth from the IBM dataset, used only for evaluation
});
export type Transaction = z.infer<typeof TransactionSchema>;
