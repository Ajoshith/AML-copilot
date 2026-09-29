import type { CustomerRecord } from "../domain/customer.ts";

/**
 * The customer risk rating a bank would assign at onboarding: a function of static
 * customer attributes only. It deliberately takes no transaction data, no case
 * classification and never the IBM `Is Laundering` label. The KYC agent reads this
 * rating, so anything else feeding it would smuggle the evaluation's answer key back
 * into the prompt. (An earlier version rated every labelled-laundering account "high".)
 *
 * The scoring follows the usual risk-based approach: cash-intensive, trade-based and
 * real-estate occupations score higher; legal entities and sole proprietorships score
 * higher than individuals; and a profile too incomplete to assess defaults to "high",
 * because a bank cannot rate what it cannot see.
 */
const OCCUPATION_RISK: Record<string, number> = {
  "Restaurant owner": 2, // cash-intensive
  "Retail shop manager": 2, // cash-intensive
  "Import/export consultant": 2, // trade-based
  "Real estate agent": 2,
  "Independent contractor": 0,
  "Freelance graphic designer": 0,
};
const UNLISTED_OCCUPATION_RISK = 1;

const BUSINESS_TYPE_RISK: Record<string, number> = {
  Individual: 0,
  "Sole proprietorship": 1,
  LLC: 1,
};
const UNLISTED_BUSINESS_TYPE_RISK = 1;

export type RiskRating = CustomerRecord["riskRating"];

export function riskRatingFor(attrs: {
  occupation: string | null;
  businessType: string | null;
}): RiskRating {
  if (attrs.occupation === null || attrs.businessType === null) return "high";
  const score =
    (OCCUPATION_RISK[attrs.occupation] ?? UNLISTED_OCCUPATION_RISK) +
    (BUSINESS_TYPE_RISK[attrs.businessType] ?? UNLISTED_BUSINESS_TYPE_RISK);
  if (score >= 3) return "high";
  if (score === 2) return "medium";
  return "low";
}
