import { Show, For, createResource, createSignal, createEffect, onCleanup, type JSX } from "solid-js";
import { api } from "../lib/eden";
import { authHeaders, role } from "../lib/identity";
import { refetchCaseList } from "../lib/caseListStore";

/**
 * Model prose is dense — real evidence points run 60-100+ words citing amounts,
 * dates, and percentages that ARE the material fact being asserted. Nielsen
 * Norman's scanning research (most users scan rather than read word-by-word)
 * is exactly why these get picked out inline instead of asking the reader to
 * find them by reading the whole paragraph. This is presentation only: it
 * never alters or reorders the model's own words, and it deliberately covers
 * only the narrow set of unambiguous, syntactically-detectable fact types
 * below (amounts, ISO dates, percentages) — reaching for more would start
 * looking like editorializing on evidence, which this tool must never do.
 */
const FACT_PATTERN = /\$?\d[\d,]*\.\d{2}(?:\s?(?:USD|EUR|GBP|AUD|JPY|RUB|MXN|BRL))?|\b20\d{2}-\d{2}-\d{2}(?:T[\d:]+Z?)?\b|\b\d+(?:\.\d+)?%/g;

function highlightFacts(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  for (const m of text.matchAll(FACT_PATTERN)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const isDate = /^\d{4}-\d{2}-\d{2}/.test(m[0]);
    parts.push(<mark class={isDate ? "fact fact-date" : "fact fact-amount"}>{m[0]}</mark>);
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const DISPOSITION_META: Record<string, { icon: string; tone: string; label: string }> = {
  CLOSE: { icon: "✓", tone: "verdict-close", label: "Close" },
  INVESTIGATE_FURTHER: { icon: "🔍", tone: "verdict-investigate", label: "Investigate Further" },
  ESCALATE_EDD: { icon: "⬆", tone: "verdict-escalate", label: "Escalate EDD" },
  ESCALATE_SANCTIONS: { icon: "⚠", tone: "verdict-danger", label: "Escalate Sanctions" },
  CONSIDER_SAR: { icon: "🚨", tone: "verdict-danger", label: "Consider SAR" },
};

interface CaseRecordShape {
  caseId: string;
  accountId: string | null;
  state: string | null;
  evidence: { points: { text: string; sourceIds: string[] }[] } | null;
  kycAssessment: {
    expectedActivity: string;
    riskFactors: string[];
    dataGaps: string[];
    stalenessDays: number | null;
  } | null;
  sanctionsResult: { matched: boolean; matchedName: string | null; score: number; sourceId: string | null } | null;
  computations: { name: string; value: unknown; sourceIds: string[] }[];
  typologyAssessment: {
    matches: { ffiecClauseId: string; strength: string; supportingSourceIds: string[] }[];
    counterHypotheses: string[];
    dataGaps: string[];
  } | null;
  verification: {
    verdict: "PASS" | "FAIL";
    checks: { claim: string; status: string }[];
    unsupportedClaims: string[];
    recalcMismatches: string[];
  } | null;
  casePacket: {
    summary: string;
    findings: { text: string; sourceIds: string[] }[];
    counterHypotheses: string[];
    recommendation: string;
    confidence: number;
    blockingGaps: string[];
  } | null;
  disposition: { analystId: string; disposition: string; rationale: string; overrideReason?: string } | null;
}

async function fetchCase(caseId: string): Promise<CaseRecordShape | { error: string } | null> {
  const res = await api.cases({ id: caseId }).get({ headers: authHeaders() });
  return res.data as CaseRecordShape | { error: string } | null;
}

function isError(x: unknown): x is { error: string } {
  return !!x && typeof x === "object" && "error" in x;
}

/** A source id is "real" (IBM transaction data / OFAC / FFIEC) if its layer
 * prefix is one of these; everything else (kyc/alert/note) is fabricated
 * overlay data — see src/domain/ids.ts. Kept as a tiny local check rather than
 * a cross-package import so the UI bundle has no dependency on backend code. */
function isOverlaySource(sourceId: string): boolean {
  return sourceId.startsWith("kyc:") || sourceId.startsWith("alert:") || sourceId.startsWith("note:");
}

type OpenSource = (sourceId: string, trigger: HTMLElement) => void;

function SourceBadge(props: { id: string; onOpen: OpenSource }) {
  return (
    <button
      type="button"
      class={isOverlaySource(props.id) ? "src-badge overlay" : "src-badge"}
      onClick={(e) => props.onOpen(props.id, e.currentTarget)}
    >
      {props.id}
    </button>
  );
}

/** ≤3 citations render inline exactly as a single badge would — no added click
 * for the common case. Real model output can cite 20+ sources on one finding;
 * past 3 they collapse behind a disclosure so the citation list never
 * outgrows the finding it supports. A real <button aria-expanded> per the
 * WAI-ARIA disclosure pattern (role=button + aria-expanded), not
 * <details>/<summary> — the APG pattern doesn't sanction that element and
 * screen-reader announcement of it varies. */
const SOURCE_COLLAPSE_THRESHOLD = 3;

function SourceList(props: { sourceIds: string[]; onOpen: OpenSource }) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Show
      when={props.sourceIds.length > SOURCE_COLLAPSE_THRESHOLD}
      fallback={<For each={props.sourceIds}>{(s) => <> <SourceBadge id={s} onOpen={props.onOpen} /></>}</For>}
    >
      {" "}
      <button
        type="button"
        class="source-disclosure"
        aria-expanded={expanded()}
        onClick={() => setExpanded((v) => !v)}
      >
        <span class="caret" classList={{ open: expanded() }} aria-hidden="true">▸</span>
        {props.sourceIds.length} sources
      </button>
      <Show when={expanded()}>
        <div class="source-disclosure-list">
          <For each={props.sourceIds}>{(s) => <SourceBadge id={s} onOpen={props.onOpen} />}</For>
        </div>
      </Show>
    </Show>
  );
}

/** The layer-tagged shape GET /cases/:id/sources resolves to — mirrors
 * src/data/sourceResolver.ts's ResolvedSource union on the backend. */
type ResolvedSourceData =
  | { sourceId: string; layer: "txn"; transaction: {
      timestamp: string; fromBank: string; fromAccount: string; toBank: string; toAccount: string;
      amountPaid: number; paymentCurrency: string; amountReceived: number; receivingCurrency: string;
      paymentFormat: string; isLaundering: boolean;
    } }
  | { sourceId: string; layer: "sdn"; entNum: string; sdnName: string; program: string }
  | { sourceId: string; layer: "kyc"; record: {
      accountHolderName: string; occupation: string | null; businessType: string | null;
      riskRating: string; lastReviewDate: string | null; jurisdiction: string;
    } }
  | { sourceId: string; layer: "alert"; record: { ruleId: string; ruleVersion: string; firedAt: string; dueDate: string } }
  | { sourceId: string; layer: "note"; record: { text: string } }
  | { sourceId: string; layer: "policy"; clause: { id: string; text: string } };

/** One place, one switch, plain data in — plain JSX out. Deliberately not
 * expressed as nested <Show>/cast chains: this data arrives as a single
 * already-resolved object (not a tree of independently-reactive signals), so
 * a plain function is both simpler and exactly as reactive as it needs to be
 * (the caller re-renders this each time the resolved value changes). */
function renderSourceBody(d: ResolvedSourceData): JSX.Element {
  switch (d.layer) {
    case "txn":
      return (
        <dl class="kv">
          <dt>Timestamp</dt><dd>{d.transaction.timestamp}</dd>
          <dt>From</dt><dd>{d.transaction.fromAccount} (bank {d.transaction.fromBank})</dd>
          <dt>To</dt><dd>{d.transaction.toAccount} (bank {d.transaction.toBank})</dd>
          <dt>Amount paid</dt><dd>{d.transaction.amountPaid.toLocaleString()} {d.transaction.paymentCurrency}</dd>
          <dt>Amount received</dt><dd>{d.transaction.amountReceived.toLocaleString()} {d.transaction.receivingCurrency}</dd>
          <dt>Format</dt><dd>{d.transaction.paymentFormat}</dd>
          <dt>Real IBM label</dt><dd>Is Laundering = {String(d.transaction.isLaundering)}</dd>
        </dl>
      );
    case "sdn":
      return (
        <dl class="kv">
          <dt>Entity</dt><dd>{d.sdnName}</dd>
          <dt>Program</dt><dd>{d.program}</dd>
          <dt>Entity #</dt><dd>{d.entNum}</dd>
        </dl>
      );
    case "kyc":
      return (
        <dl class="kv">
          <dt>Account holder</dt><dd>{d.record.accountHolderName}</dd>
          <dt>Occupation</dt><dd>{d.record.occupation ?? "not on file"}</dd>
          <dt>Business type</dt><dd>{d.record.businessType ?? "not on file"}</dd>
          <dt>Risk rating</dt><dd>{d.record.riskRating}</dd>
          <dt>Last review</dt><dd>{d.record.lastReviewDate ?? "never reviewed"}</dd>
          <dt>Jurisdiction</dt><dd>{d.record.jurisdiction}</dd>
        </dl>
      );
    case "alert":
      return (
        <dl class="kv">
          <dt>Rule</dt><dd>{d.record.ruleId} ({d.record.ruleVersion})</dd>
          <dt>Fired</dt><dd>{d.record.firedAt}</dd>
          <dt>Due</dt><dd>{d.record.dueDate}</dd>
        </dl>
      );
    case "note":
      return <p class="note-text">{d.record.text}</p>;
    case "policy":
      return <p class="clause-text">{d.clause.text}</p>;
  }
}

/** The source panel is deliberately NON-modal (WAI-ARIA dialog pattern:
 * "mark a dialog modal only when application code prevents interaction with
 * external content and visual styling obscures that content for all users;
 * otherwise use a non-modal dialog") — an analyst needs to read the cited
 * record while still reading the finding that cites it, so a focus trap and
 * backdrop would work against the feature. Esc closes; focus returns to the
 * invoking badge; no aria-modal, no trap, no backdrop. */
function SourcePanel(props: {
  sourceId: string | null;
  loading: boolean;
  data: ResolvedSourceData | { error: string } | null;
  onClose: () => void;
}) {
  let panelRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.sourceId) panelRef?.focus();
  });

  return (
    <Show when={props.sourceId}>
      <div
        ref={panelRef}
        class="source-panel"
        role="dialog"
        aria-labelledby="source-panel-title"
        tabIndex={-1}
        onKeyDown={(e) => e.key === "Escape" && props.onClose()}
      >
        <div class="source-panel-header">
          <h4 id="source-panel-title">Source</h4>
          <button type="button" class="source-panel-close" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div class="source-panel-body">
          <span class={isOverlaySource(props.sourceId!) ? "src-badge overlay" : "src-badge"}>{props.sourceId}</span>
          <Show when={props.loading}>
            <p class="muted" style={{ "margin-top": "12px" }}>Loading…</p>
          </Show>
          <Show when={!props.loading && props.data}>
            {(d) => (
              <div style={{ "margin-top": "12px" }}>
                <Show when={"error" in d() ? d() : null}>{(err) => <p class="error-text">{(err() as { error: string }).error}</p>}</Show>
                <Show when={!("error" in d()) ? (d() as ResolvedSourceData) : null}>
                  {(resolved) => renderSourceBody(resolved())}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}

/** The pipeline's linear happy path. A case that exits early (sanctions match,
 * verification failure) is drawn as having completed every step up through the
 * one it actually stopped at — the terminal banner explains why it stopped, so
 * the tracker's job is just to show real progress, not to imply steps ran that
 * did not. */
const PIPELINE_STEPS = [
  { key: "INGESTED", label: "Ingest" },
  { key: "EVIDENCE", label: "Evidence" },
  { key: "KYC", label: "KYC/CDD" },
  { key: "ANALYTICS", label: "Analytics" },
  { key: "TYPOLOGY", label: "Typology" },
  { key: "VERIFICATION", label: "Verify" },
  { key: "PACKET_READY", label: "Packet" },
] as const;

function stepIndex(state: string | null): number {
  if (!state) return -1;
  const i = PIPELINE_STEPS.findIndex((s) => s.key === state);
  if (i >= 0) return i;
  if (state === "ESCALATED_SANCTIONS") return PIPELINE_STEPS.findIndex((s) => s.key === "ANALYTICS") + 1;
  if (state === "BLOCKED_VERIFICATION") return PIPELINE_STEPS.findIndex((s) => s.key === "VERIFICATION") + 1;
  return PIPELINE_STEPS.length; // AWAITING_ANALYST, DISPOSITION_RECORDED, QA
}

function PipelineProgress(props: { state: string | null }) {
  const idx = () => stepIndex(props.state);
  const currentLabel = () => PIPELINE_STEPS.find((s) => s.key === props.state)?.label ?? "Starting";
  return (
    <div class="pipeline-progress">
      <div class="pipeline-steps">
        <For each={PIPELINE_STEPS}>
          {(step, i) => (
            <div
              class="pipeline-step"
              classList={{ done: i() < idx(), active: i() === idx() }}
              title={step.label}
            />
          )}
        </For>
      </div>
      <div class="pipeline-label">
        <span class="spinner" />
        Running — {currentLabel()}
        <Show when={props.state}> ({props.state})</Show>
      </div>
    </div>
  );
}

function StrengthPill(props: { strength: string }) {
  return <span class={`strength-pill strength-${props.strength}`}>{props.strength}</span>;
}

export function CaseWorkbench(props: { caseId: string; accountId: string }) {
  const [record, { refetch }] = createResource(() => props.caseId, fetchCase);
  const [running, setRunning] = createSignal(false);
  const [runError, setRunError] = createSignal<string | null>(null);
  const [liveState, setLiveState] = createSignal<string | null>(null);

  const [panelSourceId, setPanelSourceId] = createSignal<string | null>(null);
  const [panelLoading, setPanelLoading] = createSignal(false);
  const [panelData, setPanelData] = createSignal<ResolvedSourceData | { error: string } | null>(null);
  let panelTrigger: HTMLElement | null = null;

  const openSource: OpenSource = async (sourceId, trigger) => {
    panelTrigger = trigger;
    setPanelSourceId(sourceId);
    setPanelLoading(true);
    setPanelData(null);
    const res = await api.cases({ id: props.caseId }).sources.get({
      query: { id: sourceId },
      headers: authHeaders(),
    });
    setPanelLoading(false);
    setPanelData((res.data ?? { error: "Request failed" }) as ResolvedSourceData | { error: string });
  };

  function closePanel() {
    setPanelSourceId(null);
    panelTrigger?.focus();
    panelTrigger = null;
  }

  // A dedicated accessor whose return type is CaseRecordShape | undefined (never
  // a plain boolean) so <Show> can correctly narrow the callback parameter's type.
  // Solid's createResource keeps the PREVIOUS case's resolved value visible while
  // a new caseId is loading (its default anti-flicker behavior) — without the
  // `rec.caseId === props.caseId` check below, switching cases would briefly (or,
  // if the fetch is fast, not-so-briefly) render the old case's evidence/packet
  // under the new case's header.
  const validRecord = (): CaseRecordShape | undefined => {
    const rec = record();
    return rec && !isError(rec) && rec.caseId === props.caseId ? rec : undefined;
  };

  async function handleRun() {
    setRunning(true);
    setRunError(null);
    setLiveState("INGESTED");

    // A real investigation run (five sequential agent calls at high reasoning
    // effort) can take a couple of minutes — nothing before this polled for
    // intermediate progress, so the analyst stared at a static "Running…"
    // button the whole time. Poll the case record so the step tracker below
    // reflects reality while the run is in flight.
    const pollId = setInterval(async () => {
      const res = await fetchCase(props.caseId);
      if (res && !isError(res) && res.state) setLiveState(res.state);
    }, 1500);

    const res = await api.cases({ id: props.caseId }).run.post(
      { accountId: props.accountId },
      { headers: authHeaders() },
    );
    clearInterval(pollId);
    setRunning(false);
    setLiveState(null);
    if (res.error || (res.data && isError(res.data))) {
      setRunError((res.data as { error: string })?.error ?? "Run failed");
    }
    refetch();
    refetchCaseList();
  }
  onCleanup(() => setRunning(false));

  return (
    <div class="workbench">
      <div class="workbench-header">
        <h2>{props.caseId}</h2>
        <span class="muted">account {props.accountId}</span>
        <Show when={validRecord()}>{(r) => <span class="state-pill">{r().state}</span>}</Show>
      </div>

      {/* IMPORTANT: <Show>'s render-callback (the `r` accessor here) only fires
          ONCE per truthy transition — it does NOT re-run just because the
          resolved value's contents change (e.g. a run completing, a decision
          being recorded). Capturing `r()` into a plain variable once at the top
          (the original bug here) freezes that snapshot for the rest of this
          case's lifetime. Every read below therefore calls `r()` again at its
          own JSX position, which Solid tracks as its own reactive computation
          and re-evaluates whenever the resource updates. Do not reintroduce a
          `const rec = r()` shortcut — it silently breaks live updates. */}
      <Show when={validRecord()} fallback={<p class="muted">Loading…</p>}>
        {(r) => (
          <Show
            when={r().state !== null}
            fallback={
              <div class="section">
                <p class="muted">This case has not been run yet.</p>
                <Show when={running()}>
                  <PipelineProgress state={liveState()} />
                </Show>
                <button disabled={running()} onClick={handleRun}>
                  {running() ? "Running…" : "Run investigation"}
                </button>
                <Show when={runError()}>
                  <p class="error-text">{runError()}</p>
                </Show>
              </div>
            }
          >
            <Show when={r().state === "ESCALATED_SANCTIONS"}>
              <div class="section sanctions-alert">
                <h3 class="section-title"><span class="icon">⚠</span> Escalated to Sanctions</h3>
                <p>
                  Matched <strong>{r().sanctionsResult?.matchedName}</strong> (score{" "}
                  {r().sanctionsResult?.score.toFixed(3)}). This case never entered the AML typology
                  path — the AML pipeline does not adjudicate sanctions matches.
                </p>
              </div>
            </Show>

            <Show when={r().state === "BLOCKED_VERIFICATION"}>
              <div class="section blocked-alert">
                <h3 class="section-title"><span class="icon">⛔</span> Blocked at Verification</h3>
                <p>The packet was withheld — it never reached the analyst.</p>
                <ul>
                  <For each={r().verification?.unsupportedClaims}>{(c) => <li>{c}</li>}</For>
                  <For each={r().verification?.recalcMismatches}>{(c) => <li>{c}</li>}</For>
                </ul>
              </div>
            </Show>

            <Show when={r().evidence}>
              <div class="section">
                <h3 class="section-title"><span class="section-chip chip-evidence">📄</span> Evidence</h3>
                <ul>
                  <For each={r().evidence!.points}>
                    {(p) => (
                      <li>
                        {highlightFacts(p.text)}{" "}
                        <SourceList sourceIds={p.sourceIds} onOpen={openSource} />
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            <Show when={r().kycAssessment}>
              <div class="section">
                <h3 class="section-title"><span class="section-chip chip-kyc">🪪</span> KYC / CDD</h3>
                <p>{highlightFacts(r().kycAssessment!.expectedActivity)}</p>
                <p class="muted">
                  Review staleness:{" "}
                  {r().kycAssessment!.stalenessDays === null
                    ? "no review date on file (data gap)"
                    : `${r().kycAssessment!.stalenessDays} days`}
                </p>
                <Show when={r().kycAssessment!.dataGaps.length > 0}>
                  <p class="warn-text">Data gaps: {r().kycAssessment!.dataGaps.join("; ")}</p>
                </Show>
              </div>
            </Show>

            <Show when={r().typologyAssessment}>
              <div class="section">
                <h3 class="section-title"><span class="section-chip chip-typology">🧭</span> Typology</h3>
                <For each={r().typologyAssessment!.matches}>
                  {(m) => (
                    <div class="typology-match">
                      <button
                        type="button"
                        class="clause-link"
                        onClick={(e) => openSource(`policy:${m.ffiecClauseId}`, e.currentTarget)}
                      >
                        <code>{m.ffiecClauseId}</code>
                      </button>
                      <StrengthPill strength={m.strength} />
                    </div>
                  )}
                </For>
                <p class="counter-hypo">
                  <em>Counter-hypotheses:</em> {r().typologyAssessment!.counterHypotheses.join(" / ")}
                </p>
                <Show when={r().typologyAssessment!.dataGaps.length > 0}>
                  <div class="data-gaps">
                    <p class="warn-text">Data gaps: {r().typologyAssessment!.dataGaps.join("; ")}</p>
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={r().verification}>
              <div class="section">
                <h3 class="section-title">
                  <span class={`section-chip ${r().verification!.verdict === "PASS" ? "chip-pass" : "chip-fail"}`}>
                    {r().verification!.verdict === "PASS" ? "✅" : "❌"}
                  </span>{" "}
                  Verification —{" "}
                  <span class={r().verification!.verdict === "PASS" ? "verdict-pass" : "verdict-fail"}>
                    {r().verification!.verdict}
                  </span>
                </h3>
              </div>
            </Show>

            <Show when={r().casePacket}>
              <div class={`section packet ${DISPOSITION_META[r().casePacket!.recommendation]?.tone ?? ""}`}>
                <h3 class="section-title"><span class="section-chip">📋</span> Case Packet</h3>

                {/* Bottom-line-up-front: the recommendation is the reason this
                    section exists, so it leads — not a footnote after the
                    supporting narrative. This is the standard convention for
                    investigation memos in this exact domain, not a UI trend. */}
                <div class="verdict-block">
                  <span class="verdict-icon">{DISPOSITION_META[r().casePacket!.recommendation]?.icon ?? "•"}</span>
                  <div class="verdict-text">
                    <span class="verdict-label">Recommendation</span>
                    <span class="verdict-value">
                      {DISPOSITION_META[r().casePacket!.recommendation]?.label ?? r().casePacket!.recommendation}
                    </span>
                  </div>
                  <div class="verdict-confidence">
                    <span class="confidence-label">confidence {r().casePacket!.confidence.toFixed(2)}</span>
                    <span class="confidence-track">
                      <span
                        class="confidence-fill"
                        style={{ width: `${Math.round(r().casePacket!.confidence * 100)}%` }}
                      />
                    </span>
                  </div>
                </div>

                <p class="packet-why-label">Why</p>
                <p>{highlightFacts(r().casePacket!.summary)}</p>
                <Show when={r().casePacket!.findings.length > 0}>
                  <ul>
                    <For each={r().casePacket!.findings}>
                      {(f) => (
                        <li>
                          {highlightFacts(f.text)}{" "}
                          <SourceList sourceIds={f.sourceIds} onOpen={openSource} />
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <Show when={r().casePacket!.blockingGaps.length > 0}>
                  <p class="warn-text">Blocking gaps before disposition: {r().casePacket!.blockingGaps.join("; ")}</p>
                </Show>
              </div>
            </Show>

            <Show when={r().state === "AWAITING_ANALYST" && role() === "analyst"}>
              <DecisionForm caseId={props.caseId} aiRecommendation={r().casePacket?.recommendation ?? null} onDecided={refetch} />
            </Show>

            <Show when={r().disposition}>
              <div class="section decision-recorded">
                <h3 class="section-title"><span class="section-chip">🖊️</span> Analyst Decision Recorded</h3>
                <p>
                  <strong>{r().disposition!.disposition}</strong> by {r().disposition!.analystId}
                </p>
                <p>{r().disposition!.rationale}</p>
                <Show when={r().disposition!.overrideReason}>
                  <p class="warn-text">Override reason: {r().disposition!.overrideReason}</p>
                </Show>
              </div>
            </Show>
          </Show>
        )}
      </Show>

      <SourcePanel sourceId={panelSourceId()} loading={panelLoading()} data={panelData()} onClose={closePanel} />
    </div>
  );
}

const DISPOSITIONS = [
  { value: "CLOSE", label: "Close" },
  { value: "INVESTIGATE_FURTHER", label: "Investigate further" },
  { value: "ESCALATE_EDD", label: "Escalate EDD" },
  { value: "CONSIDER_SAR", label: "Consider SAR" },
] as const;

function DecisionForm(props: { caseId: string; aiRecommendation: string | null; onDecided: () => void }) {
  const [disposition, setDisposition] = createSignal("CLOSE");
  const [rationale, setRationale] = createSignal("");
  const [overrideReason, setOverrideReason] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  const differs = () => props.aiRecommendation !== null && disposition() !== props.aiRecommendation;

  async function submit() {
    setSubmitting(true);
    setError(null);
    const body: Record<string, string> = { disposition: disposition(), rationale: rationale() };
    if (differs()) body.overrideReason = overrideReason();

    const res = await api.cases({ id: props.caseId }).analyst.decision.post(body, { headers: authHeaders() });
    setSubmitting(false);
    const data = res.data as { error?: string } | null;
    if (data?.error) {
      setError(data.error);
      return;
    }
    props.onDecided();
    refetchCaseList();
  }

  return (
    <div class="section decision-form">
      <h3 class="section-title"><span class="section-chip">⚖️</span> Analyst Decision — the hard stop</h3>
      <p class="notice">
        No SAR filing tool exists anywhere in this system. Choosing "Consider SAR" only records your
        disposition and hands the case to the bank's real SAR workflow outside this prototype.
      </p>

      <label class="field-label" for="disposition-group">
        Disposition
      </label>
      <div class="disposition-options" id="disposition-group" role="radiogroup">
        <For each={DISPOSITIONS}>
          {(opt) => (
            <label class="disposition-option" classList={{ checked: disposition() === opt.value }}>
              <input
                type="radio"
                name="disposition"
                value={opt.value}
                checked={disposition() === opt.value}
                onChange={() => setDisposition(opt.value)}
              />
              <span class="label">{opt.label}</span>
              <Show when={props.aiRecommendation === opt.value}>
                <span class="match-tag">AI recommendation</span>
              </Show>
            </label>
          )}
        </For>
      </div>

      <div class="field-block">
        <label class="field-label" for="rationale">Rationale</label>
        <textarea
          id="rationale"
          placeholder="What did you review, and why does this disposition follow?"
          value={rationale()}
          onInput={(e) => setRationale(e.currentTarget.value)}
        />
      </div>

      <Show when={differs()}>
        <div class="field-block">
          <label class="field-label" for="override">Override reason (required)</label>
          <textarea
            id="override"
            class="override"
            placeholder={`Your disposition differs from the AI recommendation (${props.aiRecommendation}) — explain why.`}
            value={overrideReason()}
            onInput={(e) => setOverrideReason(e.currentTarget.value)}
          />
        </div>
      </Show>

      <button
        class="btn-primary"
        disabled={submitting() || rationale().length === 0 || (differs() && overrideReason().length === 0)}
        onClick={submit}
      >
        {submitting() ? "Submitting…" : "Record decision"}
      </button>
      <Show when={error()}>
        <p class="error-text">{error()}</p>
      </Show>
    </div>
  );
}
