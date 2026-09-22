/**
 * Scrubs SAR-sensitive fields from an audit row before it reaches a non-SAR-scoped
 * sink (the generic app log, a `readonly`-role API response). This is what makes
 * "SAR-confidential data never appears in the generic log" a checkable property
 * rather than a hope — see tests/confidentiality.test.ts.
 */

const SAR_SENSITIVE_KEYS = new Set([
  "recommendation",
  "disposition",
  "rationale",
  "overrideReason",
  "narrative",
  "sarConfidentialitySensitive",
  "summary",
  "findings",
  "counterHypotheses",
]);

export function redactForGenericLog<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (SAR_SENSITIVE_KEYS.has(key)) {
      redacted[key] = "[REDACTED:SAR-SENSITIVE]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactForGenericLog(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
