import { For, Show, createContext, createEffect, createSignal, useContext, type JSX } from "solid-js";
import type { ResolvedSourceData } from "../lib/caseTypes";
import { LAYER_LABEL, fmtDate, fullMoney, isOverlaySource, shortSourceId, sourceLayer } from "../lib/format";
import { Icon, type IconName } from "./Icon";

export type OpenSource = (sourceId: string, trigger: HTMLElement) => void;
export const SourceContext = createContext<OpenSource>(() => {});

const LAYER_ICON: Record<string, IconName> = {
  txn: "transfer",
  sdn: "alert",
  policy: "typology",
  kyc: "customer",
  alert: "flag",
  note: "note",
};

export function SourceBadge(props: { id: string }) {
  const open = useContext(SourceContext);
  const layer = () => sourceLayer(props.id);
  return (
    <button
      type="button"
      class="src-badge"
      classList={{ overlay: isOverlaySource(props.id) }}
      title={`${props.id} — ${isOverlaySource(props.id) ? "generated overlay" : "real source"}. Click to inspect.`}
      aria-label={`Source ${props.id}`}
      onClick={(e) => open(props.id, e.currentTarget)}
    >
      <Icon name={LAYER_ICON[layer()] ?? "database"} size={11} />
      {shortSourceId(props.id)}
    </button>
  );
}

// ≤3 citations stay inline; longer runs collapse behind an APG disclosure button
// (role=button + aria-expanded) so a 20-source citation never outgrows its finding.
const COLLAPSE_AT = 3;

export function SourceList(props: { sourceIds: string[] }) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <span class="source-list">
      <Show
        when={props.sourceIds.length > COLLAPSE_AT}
        fallback={<For each={props.sourceIds}>{(s) => <SourceBadge id={s} />}</For>}
      >
        <button
          type="button"
          class="source-disclosure"
          aria-expanded={expanded()}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name="chevron-right" size={12} class={expanded() ? "caret open" : "caret"} />
          {props.sourceIds.length} sources
        </button>
        <Show when={expanded()}>
          <span class="source-disclosure-list">
            <For each={props.sourceIds}>{(s) => <SourceBadge id={s} />}</For>
          </span>
        </Show>
      </Show>
    </span>
  );
}

function Field(props: { label: string; children: JSX.Element; mono?: boolean }) {
  return (
    <>
      <dt>{props.label}</dt>
      <dd classList={{ mono: props.mono }}>{props.children}</dd>
    </>
  );
}

function renderSourceBody(d: ResolvedSourceData): JSX.Element {
  switch (d.layer) {
    case "txn": {
      const t = d.transaction;
      const fx = t.paymentCurrency !== t.receivingCurrency;
      return (
        <>
          <div class="src-hero">
            <span class="src-hero-amount">{fullMoney(t.amountPaid)}</span>
            <span class="src-hero-ccy">{t.paymentCurrency}</span>
            <span class="src-hero-format">{t.paymentFormat}</span>
          </div>
          <div class="src-flow">
            <div class="src-flow-party">
              <span class="src-flow-label">From</span>
              <span class="mono">{t.fromAccount}</span>
              <span class="muted small">bank {t.fromBank}</span>
            </div>
            <Icon name="arrow" size={18} class="src-flow-arrow" />
            <div class="src-flow-party">
              <span class="src-flow-label">To</span>
              <span class="mono">{t.toAccount}</span>
              <span class="muted small">bank {t.toBank}</span>
            </div>
          </div>
          <dl class="kv">
            <Field label="Timestamp" mono>{fmtDate(t.timestamp)}</Field>
            <Field label="Received">
              {fullMoney(t.amountReceived)} {t.receivingCurrency}
              <Show when={fx}>
                <span class="tag tag-info">FX</span>
              </Show>
            </Field>
            <Field label="IBM label">
              <span class={t.isLaundering ? "tag tag-danger" : "tag tag-neutral"}>
                Is Laundering = {String(t.isLaundering)}
              </span>
            </Field>
          </dl>
        </>
      );
    }
    case "sdn":
      return (
        <>
          <div class="src-hero">
            <span class="src-hero-name">{d.sdnName}</span>
          </div>
          <dl class="kv">
            <Field label="Program">{d.program}</Field>
            <Field label="Entity #" mono>{d.entNum}</Field>
          </dl>
        </>
      );
    case "kyc":
      return (
        <dl class="kv">
          <Field label="Account holder">{d.record.accountHolderName}</Field>
          <Field label="Occupation">{d.record.occupation ?? <span class="muted">not on file</span>}</Field>
          <Field label="Business type">{d.record.businessType ?? <span class="muted">not on file</span>}</Field>
          <Field label="Risk rating">{d.record.riskRating}</Field>
          <Field label="Last review">{d.record.lastReviewDate ? fmtDate(d.record.lastReviewDate, false) : <span class="muted">never reviewed</span>}</Field>
          <Field label="Jurisdiction">{d.record.jurisdiction}</Field>
        </dl>
      );
    case "alert":
      return (
        <dl class="kv">
          <Field label="Rule" mono>{d.record.ruleId}</Field>
          <Field label="Version" mono>{d.record.ruleVersion}</Field>
          <Field label="Fired" mono>{fmtDate(d.record.firedAt)}</Field>
          <Field label="Due" mono>{fmtDate(d.record.dueDate)}</Field>
        </dl>
      );
    case "note":
      return (
        <>
          <div class="callout callout-warning">
            <Icon name="alert" size={14} />
            <span>Untrusted free text. Agents treat it strictly as data — instructions inside it are never followed.</span>
          </div>
          <blockquote class="note-quote">{d.record.text}</blockquote>
        </>
      );
    case "policy":
      return <blockquote class="clause-quote">{d.clause.text}</blockquote>;
  }
}

// Non-modal on purpose (APG dialog pattern): the analyst compares the cited record
// against the finding that cites it, so no backdrop or focus trap. Esc closes and
// focus returns to the invoking badge.
export function SourcePanel(props: {
  sourceId: string | null;
  loading: boolean;
  data: ResolvedSourceData | { error: string } | null;
  onClose: () => void;
}) {
  let panelRef: HTMLDivElement | undefined;
  createEffect(() => {
    if (props.sourceId) panelRef?.focus();
  });

  const resolved = () => (props.data && !("error" in props.data) ? props.data : null);
  const error = () => (props.data && "error" in props.data ? props.data.error : null);

  return (
    <Show when={props.sourceId}>
      {(id) => (
        <aside
          ref={panelRef}
          class="source-panel"
          role="dialog"
          aria-labelledby="source-panel-title"
          tabIndex={-1}
          onKeyDown={(e) => e.key === "Escape" && props.onClose()}
        >
          <header class="source-panel-header">
            <div class="source-panel-heading">
              <span class="source-panel-kicker">
                <Icon name={LAYER_ICON[sourceLayer(id())] ?? "database"} size={12} />
                {LAYER_LABEL[sourceLayer(id())] ?? "Source"}
              </span>
              <h2 id="source-panel-title" class="mono">{id()}</h2>
            </div>
            <button type="button" class="icon-btn" aria-label="Close source panel" onClick={props.onClose}>
              <Icon name="x" size={16} />
            </button>
          </header>
          <div class="source-panel-provenance" classList={{ overlay: isOverlaySource(id()) }}>
            <Icon name={isOverlaySource(id()) ? "info" : "database"} size={12} />
            {isOverlaySource(id())
              ? "Generated overlay data — not from a real-world source"
              : "Real public data — resolved live from the source dataset"}
          </div>
          <div class="source-panel-body">
            <Show when={props.loading}>
              <div class="skeleton-stack">
                <div class="skeleton" style={{ width: "60%", height: "28px" }} />
                <div class="skeleton" style={{ width: "100%" }} />
                <div class="skeleton" style={{ width: "85%" }} />
                <div class="skeleton" style={{ width: "70%" }} />
              </div>
            </Show>
            <Show when={!props.loading && error()}>
              <div class="callout callout-danger">
                <Icon name="x-circle" size={14} />
                <span>{error()}</span>
              </div>
            </Show>
            <Show when={!props.loading && resolved()}>{(d) => renderSourceBody(d())}</Show>
          </div>
          <footer class="source-panel-footer">
            <kbd>Esc</kbd> to close
          </footer>
        </aside>
      )}
    </Show>
  );
}
