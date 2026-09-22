/**
 * The permission gate. This is plain code with no model in the loop — see the
 * plan's tool permission table. Five classes:
 *   READ_ONLY / DERIVED / DRAFT  — auto-allow once the allowlist and case-scope
 *                                  checks pass.
 *   SOR_WRITE                    — additionally requires an approval token and an
 *                                  idempotency key (human-issued or deterministic
 *                                  business rule; either is acceptable, but one
 *                                  must be present and unused).
 *   ADVERSE                      — no tool is ever registered under this class.
 *                                  There is nothing to permission-check because
 *                                  the capability doesn't exist — see
 *                                  tests/hardStop.test.ts.
 */

export type PermissionClass = "READ_ONLY" | "DERIVED" | "DRAFT" | "SOR_WRITE" | "ADVERSE";

export interface AgentContext {
  caseId: string;
  agentName: string;
  allowedTools: readonly string[];
}

export interface SorWriteCredentials {
  approvalToken?: string;
  idempotencyKey?: string;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
}

const usedIdempotencyKeys = new Set<string>();

/** Test-only: clears idempotency-key memory between test cases. */
export function _resetIdempotencyForTests(): void {
  usedIdempotencyKeys.clear();
}

export function checkPermission(
  toolName: string,
  permissionClass: PermissionClass,
  requestedCaseId: string,
  ctx: AgentContext,
  credentials: SorWriteCredentials = {},
): PermissionCheckResult {
  if (permissionClass === "ADVERSE") {
    return { allowed: false, reason: "ADVERSE-class tools do not exist and can never be invoked" };
  }

  if (!ctx.allowedTools.includes(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is not in agent "${ctx.agentName}"'s allowlist`,
    };
  }

  if (requestedCaseId !== ctx.caseId) {
    return {
      allowed: false,
      reason: `Case scope mismatch: requested "${requestedCaseId}" but context is scoped to "${ctx.caseId}"`,
    };
  }

  if (permissionClass === "SOR_WRITE") {
    const { approvalToken, idempotencyKey } = credentials;
    if (!approvalToken || !idempotencyKey) {
      return {
        allowed: false,
        reason: "SOR_WRITE requires both an approval token and an idempotency key",
      };
    }
    if (usedIdempotencyKeys.has(idempotencyKey)) {
      return {
        allowed: false,
        reason: `Idempotency key "${idempotencyKey}" has already been used`,
      };
    }
    usedIdempotencyKeys.add(idempotencyKey);
    return { allowed: true, reason: "SOR_WRITE approval token and fresh idempotency key present" };
  }

  // READ_ONLY / DERIVED / DRAFT: allowlist + case-scope checks above are sufficient.
  return { allowed: true, reason: `${permissionClass} auto-allowed after allowlist/scope checks` };
}
