import type { JSX } from "solid-js";
import type { IconName } from "../components/Icon";
import type { Computation } from "./caseTypes";

// Presentation only: picks out amounts, dates, percentages, multipliers and account
// IDs inside model prose without changing a word of it.
const CCY = String.raw`(?:\s?(?:USD|EUR|GBP|AUD|JPY|RUB|MXN|BRL|CAD|CNY|INR|SAR|Euro|US Dollar)\b)?`;
const FACT_PATTERN = new RegExp(
  [
    String.raw`~?\$\d[\d,]*(?:\.\d+)?(?:[KMB](?![a-z]))?(?:-\$?\d+(?:\.\d+)?[KMB])?` + CCY,
    String.raw`\b\d[\d,]*\.\d{2}\b` + CCY,
    String.raw`\b20\d{2}-\d{2}-\d{2}(?:T[\d:]+Z?)?\b`,
    String.raw`\b\d+(?:\.\d+)?%`,
    String.raw`~?\b\d+(?:\.\d+)?x(?:-\d+(?:\.\d+)?x)?\b`,
    // 9-char account IDs (e.g. 8075AC7C0, 809862880)
    String.raw`\b(?=[0-9A-F]*\d)[0-9A-F]{9}\b`,
  ].join("|"),
  "g",
);

function factClass(token: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(token)) return "fact fact-date";
  if (/^[0-9A-F]{9}$/.test(token)) return "fact fact-id";
  return "fact fact-amount";
}

export interface SummaryBlock {
  label: string;
  icon: IconName;
  chip: string;
  paragraphs: { intro: string; items: string[] }[];
}

const BLOCK_KINDS: { test: RegExp; label: string; icon: IconName; chip: string }[] = [
  { test: /\brecommend/i, label: "Next step", icon: "arrow", chip: "chip-packet" },
  { test: /typology|FFIEC|red flag/i, label: "Red flags", icon: "typology", chip: "chip-typology" },
  {
    test: /\brule[ds]? out|\blegitimate|\binnocent|\bplausible|\bunverified/i,
    label: "Alternative explanations",
    icon: "lightbulb",
    chip: "chip-counter",
  },
  { test: /\bKYC\b|\bCDD\b|profile|customer contact|stale/i, label: "Customer profile", icon: "customer", chip: "chip-kyc" },
];
const DEFAULT_KIND = { label: "Activity pattern", icon: "transfer" as IconName, chip: "chip-evidence" };

/** Splits "intro (1) a, (2) b, and (3) c." into an intro and list items. */
function splitEnumeration(sentence: string): { intro: string; items: string[] } {
  const parts = sentence.split(/\s*\(\d\)\s+/);
  if (parts.length < 3) return { intro: sentence, items: [] };
  const [intro, ...rest] = parts;
  const items = rest.map((p) => p.replace(/(?:[,;]\s*(?:and)?|\s+and)\s*$/, "").trim());
  return { intro: intro!.replace(/:\s*$/, ":").trim(), items };
}

/**
 * Structures a coordinator memo for scanning without rewording it: the first sentence
 * becomes the bottom line, inline (1)(2)(3) enumerations become lists, and the rest is
 * grouped by topic keyword.
 */
export function structureSummary(text: string): { lead: string; blocks: SummaryBlock[] } {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z(])/).map((s) => s.trim()).filter(Boolean);
  const blocks: SummaryBlock[] = [];
  const push = (kind: Omit<SummaryBlock, "paragraphs">, para: { intro: string; items: string[] }) => {
    const prev = blocks[blocks.length - 1];
    if (prev && prev.label === kind.label) prev.paragraphs.push(para);
    else blocks.push({ ...kind, paragraphs: [para] });
  };

  let lead = sentences[0] ?? "";
  const leadEnum = splitEnumeration(lead);
  if (leadEnum.items.length) {
    lead = leadEnum.intro;
    push(DEFAULT_KIND, { intro: "", items: leadEnum.items });
  }
  for (const sentence of sentences.slice(1)) {
    const para = splitEnumeration(sentence);
    const kind = BLOCK_KINDS.find((k) => k.test.test(sentence)) ?? DEFAULT_KIND;
    push(para.items.length ? DEFAULT_KIND : kind, para);
  }
  return { lead, blocks };
}

export function highlightFacts(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  for (const m of text.matchAll(FACT_PATTERN)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(<mark class={factClass(m[0])}>{m[0]}</mark>);
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export interface DispositionMeta {
  icon: IconName;
  tone: "success" | "info" | "warning" | "danger";
  label: string;
  blurb: string;
}

export const DISPOSITION_META: Record<string, DispositionMeta> = {
  CLOSE: { icon: "check-circle", tone: "success", label: "Close", blurb: "Activity explained; no further action." },
  INVESTIGATE_FURTHER: {
    icon: "search",
    tone: "info",
    label: "Investigate further",
    blurb: "Material questions remain open before a disposition.",
  },
  ESCALATE_EDD: {
    icon: "flag",
    tone: "warning",
    label: "Escalate to EDD",
    blurb: "Customer warrants enhanced due diligence review.",
  },
  ESCALATE_SANCTIONS: {
    icon: "alert",
    tone: "danger",
    label: "Escalate to sanctions",
    blurb: "Sanctions team owns the match — AML does not adjudicate.",
  },
  CONSIDER_SAR: {
    icon: "alert",
    tone: "danger",
    label: "Consider SAR",
    blurb: "Evidence may meet the suspicious-activity threshold.",
  },
};

export function dispositionMeta(key: string | null | undefined): DispositionMeta {
  return (key && DISPOSITION_META[key]) || { icon: "info", tone: "info", label: key ?? "—", blurb: "" };
}

export interface StateMeta {
  label: string;
  tone: "neutral" | "info" | "warning" | "danger" | "success";
  icon: IconName;
}

export function stateMeta(state: string | null): StateMeta {
  switch (state) {
    case null:
      return { label: "Not run", tone: "neutral", icon: "clock" };
    case "AWAITING_ANALYST":
      return { label: "Needs decision", tone: "warning", icon: "decision" };
    case "BLOCKED_VERIFICATION":
      return { label: "Blocked", tone: "danger", icon: "blocked" };
    case "ESCALATED_SANCTIONS":
      return { label: "Sanctions", tone: "danger", icon: "alert" };
    case "DISPOSITION_RECORDED":
    case "QA":
      return { label: "Decided", tone: "success", icon: "check" };
    default:
      return { label: "Running", tone: "info", icon: "clock" };
  }
}

export function humanize(slug: string): string {
  const s = slug.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "ffiec-appF:funds-transfers:6" -> { section: "Funds transfers", index: "6" } */
export function parseClauseId(id: string): { section: string; index: string } {
  const parts = id.split(":");
  return { section: humanize(parts[1] ?? id), index: parts[2] ?? "" };
}

export function compactMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function fullMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function computationMap(list: Computation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of list) if (typeof c.value === "number") m.set(c.name, c.value);
  return m;
}

export function isOverlaySource(sourceId: string): boolean {
  return sourceId.startsWith("kyc:") || sourceId.startsWith("alert:") || sourceId.startsWith("note:");
}

export const LAYER_LABEL: Record<string, string> = {
  txn: "IBM AMLworld transaction",
  sdn: "OFAC SDN entry",
  policy: "FFIEC Appendix F red flag",
  kyc: "KYC / CDD profile",
  alert: "TM alert",
  note: "Analyst note / wire memo",
};

export function sourceLayer(sourceId: string): string {
  return sourceId.split(":")[0] ?? "";
}

/** Drops the redundant provenance prefix for display: "txn:ibm:HI-Small:423257" -> "423257". */
export function shortSourceId(sourceId: string): string {
  const parts = sourceId.split(":");
  if (parts[0] === "txn") return `#${parts[parts.length - 1]}`;
  if (parts[0] === "policy") return parts.slice(2).join(":");
  if (parts[0] === "note") return `note ${parts[parts.length - 1]}`;
  if (parts[0] === "sdn") return `SDN ${parts[parts.length - 1]}`;
  return parts.slice(2).join(":") || sourceId;
}

/** Eden Treaty revives ISO strings into Date objects, so accept either. */
export function fmtDate(v: unknown, withTime = true): string {
  if (v === null || v === undefined || v === "") return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const iso = d.toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso.slice(0, 10);
}
