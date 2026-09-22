import { AnalystRoleSchema, type AnalystRole } from "../domain/case.ts";

/**
 * Header-based identity stub — a clearly-labelled prototype stand-in for real
 * IAM/SSO. Production would replace this with a verified session/token; nothing
 * else in the API cares how identity was established, only that `role` and (for
 * the analyst-decision path) `analystId` are present and valid.
 */
export interface RequestIdentity {
  analystId: string | null;
  role: AnalystRole;
}

export function readIdentity(headers: Record<string, string | undefined>): RequestIdentity {
  const roleHeader = headers["x-role"];
  const parsedRole = AnalystRoleSchema.safeParse(roleHeader);
  const role: AnalystRole = parsedRole.success ? parsedRole.data : "readonly";
  const analystId = headers["x-analyst-id"] ?? null;
  return { analystId, role };
}

export function isSarScoped(role: AnalystRole): boolean {
  return role === "analyst" || role === "sanctions";
}
