/**
 * Generates a read-only HTML report over the 8 real mined cases, using only the
 * deterministic analytics/data layer (timeline, aggregates, graph, patterns,
 * sanctions screening) — no LLM call, so this works with zero API credit and
 * independently of whether the agent cassettes are placeholder or real recorded
 * output. This is NOT the investigator workbench (that's the SolidJS UI in
 * ui/) — it's a quick, dependency-free way to see the real transaction data
 * and its deterministic computations without running the full agent pipeline.
 */
import { readFile } from "node:fs/promises";
import { initDb } from "../src/data/loaders.ts";
import { getAccountTimeline } from "../src/analytics/timeline.ts";
import { computeAggregates } from "../src/analytics/aggregates.ts";
import { computeGraph } from "../src/analytics/graph.ts";
import { detectPatterns } from "../src/analytics/patterns.ts";
import { screenSanctions } from "../src/analytics/sanctionsMatch.ts";
import { getKycRecord, getAlertsForAccount, getNotesForAccount } from "../src/data/overlayStore.ts";
import { DATA_OVERLAY_DIR } from "../src/config.ts";
import { isRealSource, type SourceId } from "../src/domain/ids.ts";
import type { MinedCase } from "./select-cases.ts";

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function sourceBadge(id: string): string {
  const real = isRealSource(id as SourceId);
  const cls = real ? "src-real" : "src-overlay";
  return `<span class="src ${cls}" title="${real ? "Real data source" : "Generated overlay"}">${esc(id)}</span>`;
}

async function renderCase(c: MinedCase): Promise<string> {
  const [timeline, aggregates, graph, patterns, kyc, alerts, notes] = await Promise.all([
    getAccountTimeline(c.accountId, { useSlice: true }),
    computeAggregates(c.accountId, { useSlice: true }),
    computeGraph(c.accountId, { useSlice: true }),
    detectPatterns(c.accountId, { useSlice: true }),
    getKycRecord(c.accountId),
    getAlertsForAccount(c.accountId),
    getNotesForAccount(c.accountId),
  ]);

  const sanctions = kyc ? await screenSanctions(kyc.accountHolderName, { useSlice: true }) : null;

  const timelineRows = timeline
    .slice(0, 12)
    .map(
      (t) => `<tr>
        <td>${sourceBadge(t.sourceId)}</td>
        <td>${esc(t.timestamp.slice(0, 16).replace("T", " "))}</td>
        <td>${esc(t.fromAccount)}</td>
        <td>${esc(t.toAccount)}</td>
        <td>${esc(t.amountPaid.toFixed(2))} ${esc(t.paymentCurrency)}</td>
        <td>${esc(t.paymentFormat)}</td>
        <td>${t.isLaundering ? '<span class="flag">IS_LAUNDERING=true</span>' : ""}</td>
      </tr>`,
    )
    .join("\n");

  const computationRows = [...aggregates, ...graph, ...patterns]
    .map(
      (comp) => `<tr>
        <td>${esc(comp.name)}</td>
        <td>${esc(comp.value)}</td>
        <td>${comp.sourceIds.length} source${comp.sourceIds.length === 1 ? "" : "s"}</td>
      </tr>`,
    )
    .join("\n");

  const noteRows = notes
    .map((n) => `<li>${sourceBadge(n.sourceId)} ${esc(n.text)}</li>`)
    .join("\n");

  const sanctionsBlock = sanctions
    ? sanctions.result.matched
      ? `<div class="sanctions-hit">⚠ SANCTIONS MATCH — ${esc(sanctions.result.matchedName)} (score ${sanctions.result.score.toFixed(3)}, ${sourceBadge(sanctions.result.sourceId!)})</div>`
      : `<div class="sanctions-clear">No sanctions match (score ${sanctions.result.score.toFixed(3)})</div>`
    : "";

  return `
  <section class="case">
    <h2>${esc(c.caseId)} <span class="classification">${esc(c.classification)}</span>
      ${c.isLaundering ? '<span class="flag">real Is Laundering=true label</span>' : ""}
    </h2>
    <p class="rationale">${esc(c.rationale)}</p>
    <p class="meta">Account: <code>${esc(c.accountId)}</code>
      &nbsp;|&nbsp; Holder: <strong>${esc(kyc?.accountHolderName ?? "(no KYC record)")}</strong>
      &nbsp;|&nbsp; Risk rating: ${esc(kyc?.riskRating ?? "n/a")}
      &nbsp;|&nbsp; Alert rule: ${esc(alerts[0]?.ruleId ?? "n/a")} ${esc(alerts[0]?.ruleVersion ?? "")}
    </p>
    ${sanctionsBlock}
    <h3>Timeline (real IBM AMLworld data, first ${Math.min(12, timeline.length)} of ${timeline.length})</h3>
    <table class="tl">
      <thead><tr><th>source_id</th><th>timestamp</th><th>from</th><th>to</th><th>amount</th><th>format</th><th></th></tr></thead>
      <tbody>${timelineRows || '<tr><td colspan="7">(no transactions)</td></tr>'}</tbody>
    </table>
    <h3>Deterministic computations</h3>
    <table class="comp">
      <thead><tr><th>name</th><th>value</th><th>grounded in</th></tr></thead>
      <tbody>${computationRows}</tbody>
    </table>
    <h3>Overlay notes (fabricated — untrusted-content surface)</h3>
    <ul class="notes">${noteRows || "<li>(none)</li>"}</ul>
  </section>`;
}

export async function generateReportHtml(): Promise<string> {
  await initDb({ useSlice: true });
  const cases = JSON.parse(await readFile(`${DATA_OVERLAY_DIR}/cases.json`, "utf8")) as MinedCase[];
  const sections = await Promise.all(cases.map(renderCase));

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>AML Investigation Co-Pilot — Real Data Report</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; background: #0f1420; color: #e6e9f0; margin: 0; padding: 2rem; }
  h1 { font-weight: 600; }
  .subtitle { color: #9aa4bf; margin-top: -0.5rem; margin-bottom: 2rem; }
  .case { background: #171d2e; border: 1px solid #2a3350; border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1.75rem; }
  .case h2 { margin-top: 0; }
  .classification { font-size: 0.75rem; background: #2a3350; color: #9db3ff; padding: 0.15rem 0.5rem; border-radius: 6px; margin-left: 0.5rem; }
  .flag { font-size: 0.7rem; background: #4a1f2b; color: #ff9db0; padding: 0.15rem 0.5rem; border-radius: 6px; margin-left: 0.5rem; }
  .rationale { color: #c3cae0; }
  .meta { color: #9aa4bf; font-size: 0.9rem; }
  .sanctions-hit { background: #4a1f2b; color: #ff9db0; padding: 0.5rem 0.75rem; border-radius: 6px; font-weight: 600; margin: 0.75rem 0; }
  .sanctions-clear { color: #7fdca0; font-size: 0.9rem; margin: 0.5rem 0; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #2a3350; }
  th { color: #9aa4bf; font-weight: 500; }
  .src { font-family: ui-monospace, monospace; font-size: 0.75rem; padding: 0.1rem 0.35rem; border-radius: 4px; }
  .src-real { background: #143028; color: #7fdca0; }
  .src-overlay { background: #332a14; color: #e0c07f; }
  .notes { font-size: 0.85rem; color: #c3cae0; }
  .notes li { margin-bottom: 0.4rem; }
  .legend { font-size: 0.8rem; color: #9aa4bf; margin-bottom: 2rem; }
</style>
</head>
<body>
  <h1>AML Investigation Co-Pilot</h1>
  <p class="subtitle">Real data report — deterministic data/analytics layer only, no LLM calls. For the full agent pipeline and case packets, see the SolidJS workbench (ui/) or <code>bun run src/replay.ts &lt;caseId&gt;</code>.</p>
  <p class="legend">
    <span class="src src-real">real source</span> = IBM AMLworld transaction / OFAC SDN / FFIEC clause &nbsp;&nbsp;
    <span class="src src-overlay">overlay source</span> = generated KYC/alert/note (fabricated, clearly labelled)
  </p>
  ${sections.join("\n")}
</body>
</html>`;
}
