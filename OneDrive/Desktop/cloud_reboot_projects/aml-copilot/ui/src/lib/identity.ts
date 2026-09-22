import { createSignal } from "solid-js";

/**
 * The workbench lets you pick a role/analyst id in the UI itself — a visible
 * stand-in for real IAM/SSO (the backend's src/api/identity.ts says the same).
 * Switching roles here is exactly how you can see the confidentiality gates
 * (readonly cannot view packet content) and the hard stop (only "analyst" can
 * record a decision) actually bite, live.
 */
export const [role, setRole] = createSignal<"analyst" | "sanctions" | "readonly">("analyst");
export const [analystId, setAnalystId] = createSignal("alice");

export function authHeaders(): Record<string, string> {
  return {
    "x-role": role(),
    "x-analyst-id": analystId(),
  };
}
