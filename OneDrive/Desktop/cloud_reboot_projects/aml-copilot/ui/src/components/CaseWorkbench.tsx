import { For, Match, Show, Switch, createEffect, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import { api } from "../lib/eden";
import { authHeaders, role } from "../lib/identity";
import { refetchCaseList, type CaseSummary } from "../lib/caseListStore";
import type { CaseRecordShape, ResolvedSourceData } from "../lib/caseTypes";
import { compactMoney, computationMap, humanize, stateMeta } from "../lib/format";
import { pushToast } from "../lib/toast";
import { Icon, type IconName } from "./Icon";
import { SourceContext, SourcePanel, type OpenSource } from "./Sources";
import { DecisionForm } from "./DecisionForm";
import { AnalyticsPanel, CustomerPanel, EvidencePanel, OverviewPanel, TypologyPanel, VerificationPanel } from "./Panels";

type Fetched = CaseRecordShape | { error: string; status?: number } | null;

async function fetchCase(caseId: string): Promise<Fetched> {
  const res = await api.cases({ id: caseId }).get({ headers: authHeaders() });
  if (res.error) return { error: String((res.error.value as { error?: string })?.error ?? "Request failed"), status: res.status };
  return res.data as CaseRecordShape;
}

function isError(x: unknown): x is { error: string; status?: number } {
  return !!x && typeof x === "object" && "error" in x;
}

/* ------------------------------------------------------------ Pipeline stepper */

const STEPS = [
  { key: "INGESTED", label: "Ingest" },
  { key: "EVIDENCE", label: "Evidence" },
  { key: "KYC", label: "KYC/CDD" },
  { key: "ANALYTICS", label: "Analytics" },
  { key: "TYPOLOGY", label: "Typology" },
  { key: "VERIFICATION", label: "Verify" },
  { key: "PACKET_READY", label: "Packet" },
  { key: "AWAITING_ANALYST", label: "Analyst" },
] as const;

type StepStatus = "done" | "current" | "stopped" | "todo" | "skipped";

function stepStatuses(state: string | null, running: boolean): StepStatus[] {
  const idx = (k: string) => STEPS.findIndex((s) => s.key === k);
  const out: StepStatus[] = STEPS.map(() => "todo");
  if (!state) return out;
  const fill = (upTo: number) => {
    for (let i = 0; i < upTo; i++) out[i] = "done";
  };
  if (state === "ESCALATED_SANCTIONS") {
    fill(idx("ANALYTICS"));
    out[idx("ANALYTICS")] = "stopped";
    for (let i = idx("ANALYTICS") + 1; i < STEPS.length; i++) out[i] = "skipped";
    return out;
  }
  if (state === "BLOCKED_VERIFICATION") {
    fill(idx("VERIFICATION"));
    out[idx("VERIFICATION")] = "stopped";
    for (let i = idx("VERIFICATION") + 1; i < STEPS.length; i++) out[i] = "skipped";
    return out;
  }
  if (state === "DISPOSITION_RECORDED" || state === "QA") {
    fill(STEPS.length);
    return out;
  }
  const i = idx(state);
  if (i >= 0) {
    fill(i);
    out[i] = running || state === "AWAITING_ANALYST" ? "current" : "done";
  }
  return out;
}

function PipelineStepper(props: { state: string | null; running: boolean }) {
  const statuses = () => stepStatuses(props.state, props.running);
  return (
    <ol class="stepper" aria-label="Investigation pipeline">
      <For each={STEPS}>
        {(step, i) => (
          <li class={`step step-${statuses()[i()]}`} aria-current={statuses()[i()] === "current" ? "step" : undefined}>
            <span class="step-dot">
              <Switch fallback={<span class="step-num">{i() + 1}</span>}>
                <Match when={statuses()[i()] === "done"}><Icon name="check" size={11} /></Match>
                <Match when={statuses()[i()] === "stopped"}><Icon name="x" size={11} /></Match>
                <Match when={statuses()[i()] === "current" && props.running}><span class="spinner spinner-xs" /></Match>
              </Switch>
            </span>
            <span class="step-label">{step.label}</span>
          </li>
        )}
      </For>
    </ol>
  );
}

/* ------------------------------------------------------------------- Tabs */

type TabKey = "overview" | "evidence" | "customer" | "analytics" | "typology" | "verification" | "decision";

interface TabDef {
  key: TabKey;
  label: string;
  icon: IconName;
  count?: number;
  alert?: boolean;
}

function tabsFor(r: CaseRecordShape): TabDef[] {
  const tabs: TabDef[] = [{ key: "overview", label: "Overview", icon: "overview" }];
  if (r.evidence) tabs.push({ key: "evidence", label: "Evidence", icon: "evidence", count: r.evidence.points.length });
  if (r.kycAssessment)
    tabs.push({ key: "customer", label: "Customer", icon: "customer", count: r.kycAssessment.riskFactors.length || undefined });
  if (r.computations.length) tabs.push({ key: "analytics", label: "Analytics", icon: "analytics" });
  if (r.typologyAssessment)
    tabs.push({ key: "typology", label: "Typology", icon: "typology", count: r.typologyAssessment.matches.length });
  if (r.verification)
    tabs.push({ key: "verification", label: "Verification", icon: "verify", alert: r.verification.verdict === "FAIL" });
  if (r.state === "AWAITING_ANALYST" || r.disposition)
    tabs.push({ key: "decision", label: "Decision", icon: "decision", alert: r.state === "AWAITING_ANALYST" });
  return tabs;
}

/* -------------------------------------------------------------- Workbench */

export function CaseWorkbench(props: { summary: CaseSummary }) {
  const caseId = () => props.summary.caseId;
  // Keyed on role too, so switching roles re-evaluates what this viewer may see.
  const [record, { refetch }] = createResource(() => ({ id: caseId(), role: role() }), (k) => fetchCase(k.id));
  const [running, setRunning] = createSignal(false);
  const [liveState, setLiveState] = createSignal<string | null>(null);
  const [runError, setRunError] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<TabKey>("overview");

  const [panelSourceId, setPanelSourceId] = createSignal<string | null>(null);
  const [panelLoading, setPanelLoading] = createSignal(false);
  const [panelData, setPanelData] = createSignal<ResolvedSourceData | { error: string } | null>(null);
  let panelTrigger: HTMLElement | null = null;

  createEffect(
    on(caseId, () => {
      setTab("overview");
      setPanelSourceId(null);
      setRunError(null);
    }, { defer: true }),
  );

  const openSource: OpenSource = async (sourceId, trigger) => {
    panelTrigger = trigger;
    setPanelSourceId(sourceId);
    setPanelLoading(true);
    setPanelData(null);
    const res = await api.cases({ id: caseId() }).sources.get({ query: { id: sourceId }, headers: authHeaders() });
    if (panelSourceId() !== sourceId) return;
    setPanelLoading(false);
    const err = (res.error?.value as { error?: string } | undefined)?.error;
    setPanelData(err ? { error: err } : ((res.data ?? { error: "Request failed" }) as ResolvedSourceData | { error: string }));
  };

  function closePanel() {
    setPanelSourceId(null);
    panelTrigger?.focus();
    panelTrigger = null;
  }

  // Solid keeps the previous case's resolved value while the next one loads;
  // guard on caseId so the old case never renders under the new header.
  const rec = (): CaseRecordShape | undefined => {
    const r = record();
    return r && !isError(r) && r.caseId === caseId() ? r : undefined;
  };
  const err = () => {
    const r = record();
    return isError(r) ? r : undefined;
  };
  const tabs = () => (rec() ? tabsFor(rec()!) : []);
  const activeTab = () => (tabs().some((t) => t.key === tab()) ? tab() : "overview");
  const canDecide = () => rec()?.state === "AWAITING_ANALYST" && role() === "analyst";

  async function handleRun() {
    setRunning(true);
    setRunError(null);
    setLiveState("INGESTED");
    const pollId = setInterval(async () => {
      const r = await fetchCase(caseId());
      if (r && !isError(r) && r.state) setLiveState(r.state);
    }, 1200);
    const res = await api.cases({ id: caseId() }).run.post({ accountId: props.summary.accountId }, { headers: authHeaders() });
    clearInterval(pollId);
    setRunning(false);
    setLiveState(null);
    const errMsg = (res.error?.value as { error?: string } | undefined)?.error;
    if (errMsg) {
      setRunError(errMsg);
      pushToast({ tone: "danger", title: `Run failed for ${caseId()}`, body: errMsg });
    } else {
      const state = (res.data as { state?: string } | null)?.state ?? null;
      pushToast({ tone: "info", title: `${caseId()} investigated`, body: stateMeta(state).label });
    }
    refetch();
    refetchCaseList();
  }

  // Number keys jump between tabs; ignored while typing in a field.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= tabs().length) setTab(tabs()[n - 1]!.key);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  function onTabKey(e: KeyboardEvent) {
    const list = tabs();
    const i = list.findIndex((t) => t.key === activeTab());
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % list.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + list.length) % list.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(list[next]!.key);
    document.getElementById(`tab-${list[next]!.key}`)?.focus();
  }

  const facts = () => {
    const r = rec();
    if (!r) return [];
    const m = computationMap(r.computations);
    const out: { label: string; value: string }[] = [];
    if (m.has("txnCount")) out.push({ label: "Txns", value: m.get("txnCount")!.toLocaleString() });
    if (m.has("totalReceived")) out.push({ label: "Received", value: compactMoney(m.get("totalReceived")!) });
    if (m.has("totalPaid")) out.push({ label: "Paid", value: compactMoney(m.get("totalPaid")!) });
    if (m.has("passThroughRatio")) out.push({ label: "Pass-thru", value: m.get("passThroughRatio")!.toFixed(2) });
    if (r.kycAssessment)
      out.push({
        label: "KYC review",
        value: r.kycAssessment.stalenessDays === null ? "never" : `${r.kycAssessment.stalenessDays}d ago`,
      });
    return out;
  };

  const shownState = () => (running() ? liveState() : (rec()?.state ?? null));

  return (
    <SourceContext.Provider value={openSource}>
      <div class="workbench">
        <header class="case-header">
          <div class="case-header-top">
            <div class="case-heading">
              <div class="case-kicker">
                <span>Case</span>
                <Icon name="chevron-right" size={11} />
                <span class="mono">acct {props.summary.accountId}</span>
              </div>
              <h1 class="case-title">
                {caseId()}
                <span class="case-type">{humanize(props.summary.classification)}</span>
              </h1>
            </div>
            <div class="case-header-actions">
              <span
                class={`truth-tag ${props.summary.isLaundering ? "truth-pos" : "truth-neg"}`}
                title="IBM AMLworld ground-truth label for this account — shown for evaluation, never given to the agents"
              >
                <Icon name="database" size={12} />
                Ground truth: {props.summary.isLaundering ? "laundering" : "clean"}
              </span>
              <Show when={rec() || running()}>
                <span class={`state-pill tone-${stateMeta(shownState()).tone}`}>
                  <Icon name={stateMeta(shownState()).icon} size={12} />
                  {running() ? "Running" : stateMeta(shownState()).label}
                </span>
              </Show>
              <Show when={canDecide()}>
                <button type="button" class="btn btn-primary" onClick={() => setTab("decision")}>
                  <Icon name="decision" size={15} /> Decide
                </button>
              </Show>
            </div>
          </div>

          <Show when={shownState() || running()}>
            <PipelineStepper state={shownState()} running={running()} />
          </Show>

          <Show when={facts().length > 0}>
            <dl class="fact-strip">
              <For each={facts()}>
                {(f) => (
                  <div class="fact-item">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                )}
              </For>
            </dl>
          </Show>
        </header>

        <Switch>
          <Match when={err()}>
            {(e) => (
              <div class="empty">
                <span class="empty-icon tone-danger"><Icon name="lock" size={26} /></span>
                <h2>{e().status === 403 ? "Case content is restricted for this role" : "Could not load case"}</h2>
                <p>
                  {e().status === 403
                    ? `The "${role()}" role is not SAR-scoped, so investigation content is withheld. Switch to analyst or sanctions in the top bar to view it.`
                    : e().error}
                </p>
              </div>
            )}
          </Match>

          <Match when={!rec()}>
            <div class="panel-stack" aria-busy="true">
              <div class="skeleton" style={{ height: "120px" }} />
              <div class="skeleton" style={{ height: "220px" }} />
            </div>
          </Match>

          <Match when={rec()?.state === null || running()}>
            <div class="ready">
              <span class="ready-icon"><Icon name={running() ? "search" : "play"} size={26} /></span>
              <h2>{running() ? "Investigation in progress" : "Ready to investigate"}</h2>
              <p class="ready-rationale">{props.summary.rationale}</p>
              <Show
                when={running()}
                fallback={
                  <>
                    <p class="muted small">
                      Five bounded agents will gather evidence, assess the customer profile, map red flags, verify every
                      material fact, and draft a case packet. The pipeline stops at the analyst — it cannot decide.
                    </p>
                    <button type="button" class="btn btn-primary btn-lg" disabled={role() === "readonly"} onClick={handleRun}>
                      <Icon name="play" size={15} /> Run investigation
                    </button>
                    <Show when={role() === "readonly"}>
                      <p class="muted small">The readonly role cannot start runs.</p>
                    </Show>
                  </>
                }
              >
                <p class="muted small">
                  Currently at <strong>{humanize((liveState() ?? "INGESTED").toLowerCase())}</strong>. Live runs at high
                  reasoning effort can take a couple of minutes; replayed runs finish in seconds.
                </p>
              </Show>
              <Show when={runError()}>
                <div class="callout callout-danger" role="alert">
                  <Icon name="x-circle" size={14} />
                  <span>{runError()}</span>
                </div>
              </Show>
            </div>
          </Match>

          <Match when={rec()}>
            {(r) => (
              <>
                <div class="tabs" role="tablist" aria-label="Case sections" onKeyDown={onTabKey}>
                  <For each={tabs()}>
                    {(t, i) => (
                      <button
                        type="button"
                        role="tab"
                        id={`tab-${t.key}`}
                        aria-selected={activeTab() === t.key}
                        aria-controls="case-tabpanel"
                        tabIndex={activeTab() === t.key ? 0 : -1}
                        class="tab"
                        classList={{ active: activeTab() === t.key }}
                        title={`${t.label} (${i() + 1})`}
                        onClick={() => setTab(t.key)}
                      >
                        <Icon name={t.icon} size={14} />
                        {t.label}
                        <Show when={t.count !== undefined}>
                          <span class="tab-count">{t.count}</span>
                        </Show>
                        <Show when={t.alert}>
                          <span class="tab-alert" aria-label="needs attention" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>

                <div class="tabpanel" id="case-tabpanel" role="tabpanel" aria-labelledby={`tab-${activeTab()}`}>
                  <Switch>
                    <Match when={activeTab() === "overview"}>
                      <OverviewPanel r={r()} canDecide={canDecide()} onDecide={() => setTab("decision")} />
                    </Match>
                    <Match when={activeTab() === "evidence"}>
                      <EvidencePanel r={r()} />
                    </Match>
                    <Match when={activeTab() === "customer"}>
                      <CustomerPanel r={r()} />
                    </Match>
                    <Match when={activeTab() === "analytics"}>
                      <AnalyticsPanel r={r()} />
                    </Match>
                    <Match when={activeTab() === "typology"}>
                      <TypologyPanel r={r()} />
                    </Match>
                    <Match when={activeTab() === "verification"}>
                      <VerificationPanel r={r()} />
                    </Match>
                    <Match when={activeTab() === "decision"}>
                      <Show
                        when={canDecide()}
                        fallback={
                          <Show
                            when={r().disposition}
                            fallback={
                              <div class="empty">
                                <span class="empty-icon"><Icon name="lock" size={26} /></span>
                                <h2>Only an analyst can decide</h2>
                                <p>Switch the role to <strong>analyst</strong> in the top bar to record a disposition.</p>
                              </div>
                            }
                          >
                            <OverviewPanel r={{ ...r(), casePacket: null }} canDecide={false} onDecide={() => {}} />
                          </Show>
                        }
                      >
                        <DecisionForm
                          caseId={caseId()}
                          aiRecommendation={r().casePacket?.recommendation ?? null}
                          onDecided={() => {
                            refetch();
                            setTab("overview");
                          }}
                        />
                      </Show>
                    </Match>
                  </Switch>
                </div>
              </>
            )}
          </Match>
        </Switch>

        <SourcePanel sourceId={panelSourceId()} loading={panelLoading()} data={panelData()} onClose={closePanel} />
      </div>
    </SourceContext.Provider>
  );
}
