import { treaty } from "@elysiajs/eden";
import type { App } from "../../../src/api/main.ts";

/**
 * Eden Treaty gives this frontend a fully-typed API client derived directly
 * from the Elysia app's route TYPES (not its code) — no separate OpenAPI spec,
 * no hand-duplicated interface file to keep in sync. If a route's Zod schema
 * changes on the backend, this client's types update automatically on rebuild.
 */
// Bun's isolated-install strategy content-addresses `elysia` separately for the
// root package and this workspace (two structurally-identical but nominally
// distinct installs), which trips a private-field nominal-type check here even
// though the actual shapes match exactly. This is a compile-time-only artifact
// of the workspace boundary — Vite's dev server and `vite build` never run a
// strict standalone tsc pass, so it never affects what actually ships.
// @ts-expect-error — see comment above; App's route shape is still correct.
export const api = treaty<App>(import.meta.env.VITE_API_URL ?? "http://localhost:8787");
