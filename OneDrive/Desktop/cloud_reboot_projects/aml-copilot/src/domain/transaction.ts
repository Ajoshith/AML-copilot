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
  isLaundering: z.boolean(), // IBM ground truth: for evaluation and the human analyst's view only, never for an agent
});
export type Transaction = z.infer<typeof TransactionSchema>;

/**
 * What an agent is allowed to see of a transaction: an explicit allowlist, so a field
 * added to Transaction later stays hidden from agents until someone adds it here on
 * purpose. Zod objects strip unknown keys on parse, so parsing yields exactly these
 * fields. The IBM `isLaundering` label is deliberately absent: it is the answer key the
 * evaluation scores against, and an agent that can read it is grading its own homework.
 */
export const AgentTransactionSchema = TransactionSchema.pick({
  sourceId: true,
  timestamp: true,
  fromBank: true,
  fromAccount: true,
  toBank: true,
  toAccount: true,
  amountReceived: true,
  receivingCurrency: true,
  amountPaid: true,
  paymentCurrency: true,
  paymentFormat: true,
});
export type AgentTransaction = z.infer<typeof AgentTransactionSchema>;

export function toAgentTransaction(t: Transaction): AgentTransaction {
  return AgentTransactionSchema.parse(t);
}
