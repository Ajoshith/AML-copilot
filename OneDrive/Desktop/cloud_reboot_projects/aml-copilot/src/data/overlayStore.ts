import { readFile } from "node:fs/promises";
import { z } from "zod";
import { DATA_OVERLAY_DIR } from "../config.ts";
import { CustomerRecordSchema, type CustomerRecord } from "../domain/customer.ts";
import { AlertSchema, type Alert } from "../domain/alert.ts";
import { NoteSchema, type Note } from "../domain/note.ts";

let kycByAccount: Map<string, CustomerRecord> | null = null;
let alertsByAccount: Map<string, Alert[]> | null = null;
let notesByAccount: Map<string, Note[]> | null = null;

async function loadKyc(): Promise<Map<string, CustomerRecord>> {
  if (kycByAccount) return kycByAccount;
  const raw = await readFile(`${DATA_OVERLAY_DIR}/kyc.json`, "utf8");
  const records = z.array(CustomerRecordSchema).parse(JSON.parse(raw));
  kycByAccount = new Map(records.map((r) => [r.accountId, r]));
  return kycByAccount;
}

async function loadAlerts(): Promise<Map<string, Alert[]>> {
  if (alertsByAccount) return alertsByAccount;
  const raw = await readFile(`${DATA_OVERLAY_DIR}/alerts.json`, "utf8");
  const records = z.array(AlertSchema).parse(JSON.parse(raw));
  alertsByAccount = new Map();
  for (const alert of records) {
    const list = alertsByAccount.get(alert.accountId) ?? [];
    list.push(alert);
    alertsByAccount.set(alert.accountId, list);
  }
  return alertsByAccount;
}

async function loadNotes(): Promise<Map<string, Note[]>> {
  if (notesByAccount) return notesByAccount;
  const raw = await readFile(`${DATA_OVERLAY_DIR}/notes.json`, "utf8");
  const records = z.array(NoteSchema).parse(JSON.parse(raw));
  notesByAccount = new Map();
  for (const note of records) {
    const list = notesByAccount.get(note.accountId) ?? [];
    list.push(note);
    notesByAccount.set(note.accountId, list);
  }
  return notesByAccount;
}

export async function getKycRecord(accountId: string): Promise<CustomerRecord | null> {
  return (await loadKyc()).get(accountId) ?? null;
}

export async function getAlertsForAccount(accountId: string): Promise<Alert[]> {
  return (await loadAlerts()).get(accountId) ?? [];
}

export async function getNotesForAccount(accountId: string): Promise<Note[]> {
  return (await loadNotes()).get(accountId) ?? [];
}

/** Test-only: clears cached overlay data so tests can reload after regenerating it. */
export function _resetOverlayCacheForTests(): void {
  kycByAccount = null;
  alertsByAccount = null;
  notesByAccount = null;
}
