import { For, Show, createResource, createSignal, type JSX } from "solid-js";
import { api } from "../lib/eden";
import { authHeaders } from "../lib/identity";
import type { CaseRecordShape, ResolvedSourceData } from "../lib/caseTypes";
import {
  compactMoney,
  computationMap,
  fmtDate,
  dispositionMeta,
  fullMoney,
  highlightFacts,
  humanize,
  parseClauseId,
  structureSummary,
} from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { SourceBadge, SourceList } from "./Sources";

function CardHead(props: { icon: IconName; chip: string; title: string; sub?: string; right?: JSX.Element }) {
  return (
    <div class="card-head">
      <div class="card-title">
        <span class={`title-chip ${props.chip}`}><Icon name={props.icon} size={15} /></span>
        <div>
          <h3>{props.title}</h3>
          <Show when={props.sub}><p class="card-sub">{props.sub}</p></Show>
        </div>
      </div>
      {props.right}
    </div>
  );
}

function BulletList(props: { items: string[]; icon: IconName; tone: string; empty?: string }) {
  return (
    <Show when={props.items.length > 0} fallback={<p class="muted small">{props.empty ?? "None."}</p>}>
      <ul class={`icon-list tone-${props.tone}`}>
        <For each={props.items}>
          {(item) => (
            <li>
              <Icon name={props.icon} size={14} />
              <span>{highlightFacts(item)}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

/* ------------------------------------------------------------------ Overview */

export function OverviewPanel(props: { r: CaseRecordShape; onDecide: () => void; canDecide: boolean }) {
  return (
    <div class="panel-stack">
      <Show when={props.r.state === "ESCALATED_SANCTIONS"}>
        <SanctionsHero r={props.r} />
      </Show>

      <Show when={props.r.state === "BLOCKED_VERIFICATION"}>
        <div class="hero hero-danger">
          <span class="hero-icon"><Icon name="blocked" size={22} /></span>
          <div class="hero-body">
            <span class="hero-kicker">Pipeline stopped · verification failed</span>
            <h2 class="hero-title">Packet withheld from analyst</h2>
            <p class="hero-text">
              The verifier could not confirm one or more material facts, so no recommendation was released. This
              becomes a research task, not a disposition.
            </p>
            <BulletList
              items={[...(props.r.verification?.unsupportedClaims ?? []), ...(props.r.verification?.recalcMismatches ?? [])]}
              icon="x-circle"
              tone="danger"
            />
          </div>
        </div>
      </Show>

      <Show when={props.r.disposition}>{(d) => <DispositionRecorded d={d()} ai={props.r.casePacket?.recommendation ?? null} />}</Show>

      <Show when={props.r.casePacket}>
        {(p) => {
          const meta = () => dispositionMeta(p().recommendation);
          return (
            <>
              <section class={`verdict tone-${meta().tone}`} aria-label="AI recommendation">
                <span class="verdict-icon"><Icon name={meta().icon} size={26} /></span>
                <div class="verdict-body">
                  <span class="verdict-kicker">
                    AI recommendation
                  </span>
                  <h2 class="verdict-title">{meta().label}</h2>
                  <p class="verdict-blurb">{meta().blurb}</p>
                </div>
                <div class="verdict-side">
                  <ConfidenceRing value={p().confidence} />
                  <Show when={props.canDecide}>
                    <button type="button" class="btn btn-primary" onClick={props.onDecide}>
                      Review &amp; decide <Icon name="arrow" size={14} />
                    </button>
                  </Show>
                </div>
              </section>

              <article class="card">
                <CardHead icon="overview" chip="chip-packet" title="Why" sub="Coordinator's case memo, built only from verified findings" />
                <StructuredSummary text={p().summary} />
              </article>

              <Show when={p().findings.length > 0}>
                <article class="card">
                  <CardHead icon="evidence" chip="chip-evidence" title="Key findings" sub={`${p().findings.length} findings, each cited to source records`} />
                  <ol class="finding-list">
                    <For each={p().findings}>
                      {(f, i) => (
                        <li class="finding">
                          <span class="finding-num">{i() + 1}</span>
                          <div class="finding-body">
                            <p class="prose">{highlightFacts(f.text)}</p>
                            <SourceList sourceIds={f.sourceIds} />
                          </div>
                        </li>
                      )}
                    </For>
                  </ol>
                </article>
              </Show>

              <div class="grid-2">
                <article class="card card-soft">
                  <CardHead icon="lightbulb" chip="chip-counter" title="Counter-hypotheses" sub="Legitimate explanations the analyst must rule out" />
                  <BulletList items={p().counterHypotheses} icon="lightbulb" tone="counter" />
                </article>
                <article class="card card-soft">
                  <CardHead icon="gap" chip="chip-gap" title="Blocking gaps" sub="Must be resolved before a disposition" />
                  <BulletList items={p().blockingGaps} icon="gap" tone="warning" empty="No blocking gaps identified." />
                </article>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
}

function StructuredSummary(props: { text: string }) {
  const s = () => structureSummary(props.text);
  return (
    <div class="summary">
      <div class="summary-lead">
        <span class="summary-lead-label">Bottom line</span>
        <p>{highlightFacts(s().lead)}</p>
      </div>
      <For each={s().blocks}>
        {(b) => (
          <section class="summary-block">
            <span class={`title-chip summary-chip ${b.chip}`}><Icon name={b.icon} size={14} /></span>
            <div class="summary-body">
              <h4 class="summary-label">{b.label}</h4>
              <For each={b.paragraphs}>
                {(para) => (
                  <>
                    <Show when={para.intro}>
                      <p class="summary-text">{highlightFacts(para.intro)}</p>
                    </Show>
                    <Show when={para.items.length > 0}>
                      <ol class="summary-enum">
                        <For each={para.items}>
                          {(item, i) => (
                            <li>
                              <span class="summary-enum-num">{i() + 1}</span>
                              <span>{highlightFacts(item)}</span>
                            </li>
                          )}
                        </For>
                      </ol>
                    </Show>
                  </>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}

function ConfidenceRing(props: { value: number }) {
  const pct = () => Math.round(props.value * 100);
  const R = 22;
  const C = 2 * Math.PI * R;
  return (
    <div class="ring" role="img" aria-label={`Model confidence ${pct()} percent`}>
      <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
        <circle cx="29" cy="29" r={R} class="ring-track" />
        <circle
          cx="29"
          cy="29"
          r={R}
          class="ring-fill"
          stroke-dasharray={`${(C * pct()) / 100} ${C}`}
          transform="rotate(-90 29 29)"
        />
      </svg>
      <div class="ring-label">
        <strong>{pct()}%</strong>
        <span>confidence</span>
      </div>
    </div>
  );
}

function SanctionsHero(props: { r: CaseRecordShape }) {
  const s = () => props.r.sanctionsResult;
  return (
    <div class="hero hero-danger">
      <span class="hero-icon"><Icon name="alert" size={22} /></span>
      <div class="hero-body">
        <span class="hero-kicker">Pipeline exited · routed to sanctions team</span>
        <h2 class="hero-title">OFAC SDN name match</h2>
        <p class="hero-text">
          The account holder matched a real entry on the U.S. Treasury SDN list. The AML pipeline never adjudicates
          sanctions — typology, verification and the case packet were intentionally skipped.
        </p>
        <div class="match-card">
          <div>
            <span class="match-label">Matched entity</span>
            <strong class="match-name">{s()?.matchedName}</strong>
            <span class="muted small">
              Program {s()?.program ?? "—"} · list {fmtDate(s()?.listVersion, false) || "—"}
            </span>
          </div>
          <div class="match-score">
            <span class="match-label">Match score</span>
            <strong>{((s()?.score ?? 0) * 100).toFixed(0)}%</strong>
            <span class="meter"><span style={{ width: `${(s()?.score ?? 0) * 100}%` }} /></span>
          </div>
          <Show when={s()?.sourceId}>{(id) => <SourceBadge id={id()} />}</Show>
        </div>
      </div>
    </div>
  );
}

function DispositionRecorded(props: { d: NonNullable<CaseRecordShape["disposition"]>; ai: string | null }) {
  const meta = () => dispositionMeta(props.d.disposition);
  return (
    <section class="card card-success">
      <CardHead
        icon="check-circle"
        chip="chip-pass"
        title={`Decision recorded: ${meta().label}`}
        sub={`Signed by ${props.d.analystId}${props.ai ? (props.ai === props.d.disposition ? " · agreed with AI" : " · overrode AI") : ""}`}
      />
      <p class="prose">{props.d.rationale}</p>
      <Show when={props.d.overrideReason}>
        <div class="callout callout-warning">
          <Icon name="alert" size={14} />
          <span><strong>Override reason:</strong> {props.d.overrideReason}</span>
        </div>
      </Show>
    </section>
  );
}

/* ------------------------------------------------------------------ Evidence */

export function EvidencePanel(props: { r: CaseRecordShape }) {
  return (
    <article class="card">
      <CardHead
        icon="evidence"
        chip="chip-evidence"
        title="Evidence"
        sub="Narrated from the account timeline — every point cites the records it rests on"
      />
      <ol class="finding-list">
        <For each={props.r.evidence?.points ?? []}>
          {(p, i) => (
            <li class="finding">
              <span class="finding-num">{i() + 1}</span>
              <div class="finding-body">
                <p class="prose">{highlightFacts(p.text)}</p>
                <SourceList sourceIds={p.sourceIds} />
              </div>
            </li>
          )}
        </For>
      </ol>
    </article>
  );
}

/* ------------------------------------------------------------------ Customer */

export function CustomerPanel(props: { r: CaseRecordShape }) {
  const k = () => props.r.kycAssessment!;
  const staleTone = () => {
    const d = k().stalenessDays;
    if (d === null) return "danger";
    if (d > 365) return "danger";
    if (d > 180) return "warning";
    return "success";
  };
  return (
    <div class="panel-stack">
      <div class="stat-row">
        <div class={`stat tone-${staleTone()}`}>
          <span class="stat-label"><Icon name="clock" size={12} /> Last KYC review</span>
          <strong class="stat-value">{k().stalenessDays === null ? "Never" : `${k().stalenessDays}d ago`}</strong>
          <span class="stat-note">{k().stalenessDays === null ? "No review date on file" : k().stalenessDays! > 365 ? "Overdue for periodic review" : "Within review cycle"}</span>
        </div>
        <div class="stat tone-warning">
          <span class="stat-label"><Icon name="flag" size={12} /> Risk factors</span>
          <strong class="stat-value">{k().riskFactors.length}</strong>
          <span class="stat-note">Profile-vs-behavior deviations</span>
        </div>
        <div class={`stat ${k().dataGaps.length ? "tone-warning" : "tone-success"}`}>
          <span class="stat-label"><Icon name="gap" size={12} /> Data gaps</span>
          <strong class="stat-value">{k().dataGaps.length}</strong>
          <span class="stat-note">Flagged, never inferred</span>
        </div>
      </div>

      <article class="card">
        <CardHead icon="customer" chip="chip-kyc" title="Expected vs. observed activity" sub="KYC/CDD agent's comparison of the stated profile with computed behavior" />
        <p class="prose lead">{highlightFacts(k().expectedActivity)}</p>
      </article>

      <div class="grid-2">
        <article class="card card-soft">
          <CardHead icon="flag" chip="chip-risk" title="Risk factors" />
          <BulletList items={k().riskFactors} icon="flag" tone="warning" empty="No risk factors raised." />
        </article>
        <article class="card card-soft">
          <CardHead icon="gap" chip="chip-gap" title="Data gaps" />
          <BulletList items={k().dataGaps} icon="gap" tone="warning" empty="Profile is complete." />
        </article>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Analytics */

export function AnalyticsPanel(props: { r: CaseRecordShape }) {
  const m = () => computationMap(props.r.computations);
  const formats = () => {
    const rows: { name: string; count: number; total: number }[] = [];
    for (const [key, total] of m()) {
      const match = /^formatBreakdown:(.+):total$/.exec(key);
      if (match) rows.push({ name: match[1]!, total, count: m().get(`formatBreakdown:${match[1]}:count`) ?? 0 });
    }
    return rows.sort((a, b) => b.total - a.total);
  };
  const maxTotal = () => Math.max(1, ...formats().map((f) => f.total));
  const [showAll, setShowAll] = createSignal(false);

  const tile = (label: string, key: string, fmt: (n: number) => string, note?: string, icon: IconName = "analytics") => (
    <Show when={m().has(key)}>
      <div class="stat">
        <span class="stat-label"><Icon name={icon} size={12} /> {label}</span>
        <strong class="stat-value">{fmt(m().get(key)!)}</strong>
        <Show when={note}><span class="stat-note">{note}</span></Show>
      </div>
    </Show>
  );

  return (
    <div class="panel-stack">
      <div class="callout callout-neutral">
        <Icon name="database" size={14} />
        <span>Every number on this tab is computed by deterministic SQL over the source data — no model produced any of it.</span>
      </div>

      <div class="stat-grid">
        {tile("Transactions", "txnCount", (n) => n.toLocaleString(), undefined, "transfer")}
        {tile("Total received", "totalReceived", compactMoney)}
        {tile("Total paid", "totalPaid", compactMoney)}
        {tile("Pass-through ratio", "passThroughRatio", (n) => n.toFixed(2), "1.0 = everything in goes back out")}
        {tile("Velocity", "velocityTxnPerDay", (n) => `${n.toFixed(1)}/day`, undefined, "clock")}
        {tile("Counterparties in", "inDegree", (n) => String(n))}
        {tile("Counterparties out", "outDegree", (n) => String(n))}
        {tile("Near-threshold cash", "nearThresholdCashCount", (n) => String(n), "Deposits just under $10K")}
        {tile("Sanctions score", "sanctionsMatchScore", (n) => `${(n * 100).toFixed(0)}%`, undefined, "alert")}
      </div>

      <Show when={formats().length > 0}>
        <article class="card">
          <CardHead icon="analytics" chip="chip-analytics" title="Value by payment format" sub="Total value moved per channel, with transaction count" />
          <div class="bar-chart" role="table" aria-label="Value by payment format">
            <For each={formats()}>
              {(f) => (
                <div class="bar-row" role="row" title={`${f.name}: ${fullMoney(f.total)} across ${f.count} transactions`}>
                  <span class="bar-name" role="rowheader">{f.name}</span>
                  <span class="bar-track" role="cell">
                    <span class="bar-fill" style={{ width: `${Math.max(0.6, (f.total / maxTotal()) * 100)}%` }} />
                  </span>
                  <span class="bar-value" role="cell">
                    <strong>{compactMoney(f.total)}</strong>
                    <span class="muted">{f.count} txn</span>
                  </span>
                </div>
              )}
            </For>
          </div>
        </article>
      </Show>

      <article class="card">
        <CardHead
          icon="database"
          chip="chip-analytics"
          title="All computed signals"
          sub={`${props.r.computations.length} deterministic outputs the agents were given`}
          right={
            <button type="button" class="btn btn-ghost btn-sm" aria-expanded={showAll()} onClick={() => setShowAll((v) => !v)}>
              {showAll() ? "Hide" : "Show all"}
              <Icon name="chevron-right" size={12} class={showAll() ? "caret open" : "caret"} />
            </button>
          }
        />
        <Show when={showAll()}>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>Signal</th><th class="num">Value</th><th>Sources</th></tr>
              </thead>
              <tbody>
                <For each={props.r.computations}>
                  {(c) => (
                    <tr>
                      <td class="mono">{c.name}</td>
                      <td class="num mono">
                        {typeof c.value === "number"
                          ? Number.isInteger(c.value) ? c.value.toLocaleString() : c.value.toFixed(2)
                          : JSON.stringify(c.value)}
                      </td>
                      <td><SourceList sourceIds={c.sourceIds} /></td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ Typology */

const STRENGTH_LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3 };

function StrengthMeter(props: { strength: string }) {
  const level = () => STRENGTH_LEVEL[props.strength] ?? 0;
  return (
    <span class={`strength strength-${props.strength}`} aria-label={`Strength ${props.strength}`}>
      <span class="strength-bars" aria-hidden="true">
        <For each={[1, 2, 3]}>{(n) => <span classList={{ on: n <= level() }} />}</For>
      </span>
      {props.strength}
    </span>
  );
}

function TypologyMatchCard(props: { caseId: string; match: NonNullable<CaseRecordShape["typologyAssessment"]>["matches"][number] }) {
  const clause = () => parseClauseId(props.match.ffiecClauseId);
  const [text] = createResource(
    () => props.match.ffiecClauseId,
    async (id) => {
      const res = await api.cases({ id: props.caseId }).sources.get({ query: { id: `policy:${id}` }, headers: authHeaders() });
      const d = res.data as ResolvedSourceData | null;
      return d && d.layer === "policy" ? d.clause.text : null;
    },
  );
  return (
    <article class={`match strength-edge-${props.match.strength}`}>
      <div class="match-top">
        <span class="match-section">
          FFIEC App. F · {clause().section} #{clause().index}
        </span>
        <StrengthMeter strength={props.match.strength} />
      </div>
      <Show when={text()} fallback={<div class="skeleton" style={{ width: "75%", height: "20px" }} />}>
        <blockquote class="match-quote">“{text()}”</blockquote>
      </Show>
      <div class="match-foot">
        <span class="muted small">
          Policy {props.match.policyVersion ?? "—"} · {props.match.supportingSourceIds.length} supporting records
        </span>
        <SourceList sourceIds={props.match.supportingSourceIds} />
      </div>
    </article>
  );
}

export function TypologyPanel(props: { r: CaseRecordShape }) {
  const t = () => props.r.typologyAssessment!;
  return (
    <div class="panel-stack">
      <article class="card">
        <CardHead
          icon="typology"
          chip="chip-typology"
          title="Red-flag matches"
          sub="Mapped against the regulator-published FFIEC BSA/AML Manual, Appendix F — the agent can only cite clauses that exist"
        />
        <div class="match-list">
          <For each={t().matches} fallback={<p class="muted small">No red flags matched.</p>}>
            {(m) => <TypologyMatchCard caseId={props.r.caseId} match={m} />}
          </For>
        </div>
      </article>
      <div class="grid-2">
        <article class="card card-soft">
          <CardHead icon="lightbulb" chip="chip-counter" title="Counter-hypotheses" sub="Required — at least one per assessment" />
          <BulletList items={t().counterHypotheses} icon="lightbulb" tone="counter" />
        </article>
        <article class="card card-soft">
          <CardHead icon="gap" chip="chip-gap" title="Data gaps" sub="Become research tasks, not assumptions" />
          <BulletList items={t().dataGaps} icon="gap" tone="warning" empty="No data gaps declared." />
        </article>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Verification */

export function VerificationPanel(props: { r: CaseRecordShape }) {
  const v = () => props.r.verification!;
  const pass = () => v().verdict === "PASS";
  const verified = () => v().checks.filter((c) => c.status === "VERIFIED").length;
  return (
    <div class="panel-stack">
      <div class={`hero ${pass() ? "hero-success" : "hero-danger"}`}>
        <span class="hero-icon"><Icon name={pass() ? "verify" : "blocked"} size={22} /></span>
        <div class="hero-body">
          <span class="hero-kicker">Independent verifier · fails closed</span>
          <h2 class="hero-title">{pass() ? "Verified — packet released" : "Failed — packet withheld"}</h2>
          <p class="hero-text">
            {verified()} of {v().checks.length} material claims confirmed against source records.
            {" "}{v().unsupportedClaims.length} unsupported · {v().recalcMismatches.length} recalculation mismatches.
          </p>
        </div>
      </div>

      <article class="card">
        <CardHead icon="check-circle" chip="chip-pass" title="Claim checks" sub="Each material claim traced to the record that supports it" />
        <ul class="check-list">
          <For each={v().checks}>
            {(c) => {
              const ok = c.status === "VERIFIED";
              return (
                <li class="check" classList={{ fail: !ok }}>
                  <span class="check-icon"><Icon name={ok ? "check-circle" : "x-circle"} size={16} /></span>
                  <span class="check-claim">{highlightFacts(c.claim)}</span>
                  <span class="check-meta">
                    <span class={`tag ${ok ? "tag-success" : "tag-danger"}`}>{humanize(c.status.toLowerCase())}</span>
                    <Show when={c.sourceId}>{(id) => <SourceBadge id={id()} />}</Show>
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
      </article>

      <Show when={v().unsupportedClaims.length + v().recalcMismatches.length > 0}>
        <article class="card card-danger">
          <CardHead icon="x-circle" chip="chip-fail" title="Problems found" />
          <BulletList items={[...v().unsupportedClaims, ...v().recalcMismatches]} icon="x-circle" tone="danger" />
        </article>
      </Show>
    </div>
  );
}
