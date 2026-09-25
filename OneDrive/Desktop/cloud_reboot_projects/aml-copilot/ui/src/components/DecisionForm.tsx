import { For, Show, createSignal } from "solid-js";
import { api } from "../lib/eden";
import { analystId, authHeaders } from "../lib/identity";
import { refetchCaseList } from "../lib/caseListStore";
import { dispositionMeta } from "../lib/format";
import { pushToast } from "../lib/toast";
import { Icon } from "./Icon";

const DISPOSITIONS = ["CLOSE", "INVESTIGATE_FURTHER", "ESCALATE_EDD", "CONSIDER_SAR"] as const;
const MIN_RATIONALE = 20;

export function DecisionForm(props: { caseId: string; aiRecommendation: string | null; onDecided: () => void }) {
  const [disposition, setDisposition] = createSignal<string>(
    DISPOSITIONS.includes(props.aiRecommendation as never) ? props.aiRecommendation! : "INVESTIGATE_FURTHER",
  );
  const [rationale, setRationale] = createSignal("");
  const [overrideReason, setOverrideReason] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  const differs = () => props.aiRecommendation !== null && disposition() !== props.aiRecommendation;
  const rationaleOk = () => rationale().trim().length >= MIN_RATIONALE;
  const overrideOk = () => !differs() || overrideReason().trim().length >= MIN_RATIONALE;
  const canSubmit = () => !submitting() && rationaleOk() && overrideOk() && analystId().trim().length > 0;

  async function submit(e: Event) {
    e.preventDefault();
    if (!canSubmit()) return;
    setSubmitting(true);
    setError(null);
    const body: Record<string, string> = { disposition: disposition(), rationale: rationale().trim() };
    if (differs()) body.overrideReason = overrideReason().trim();

    const res = await api.cases({ id: props.caseId }).analyst.decision.post(body, { headers: authHeaders() });
    setSubmitting(false);
    const data = res.data as { error?: string } | null;
    if (res.error || data?.error) {
      setError(data?.error ?? "The decision could not be recorded.");
      return;
    }
    pushToast({
      tone: "success",
      title: `Decision recorded for ${props.caseId}`,
      body: `${dispositionMeta(disposition()).label} · signed by ${analystId()}`,
    });
    props.onDecided();
    refetchCaseList();
  }

  return (
    <form class="card decision-form" onSubmit={submit}>
      <div class="card-head">
        <div class="card-title">
          <span class="title-chip chip-decision"><Icon name="decision" size={15} /></span>
          <div>
            <h3>Record your decision</h3>
            <p class="card-sub">Only a human analyst can dispose of this case. The AI cannot advance it past this point.</p>
          </div>
        </div>
      </div>

      <div class="callout callout-info">
        <Icon name="lock" size={14} />
        <span>
          No SAR filing tool exists in this system. <strong>Consider SAR</strong> records your disposition and hands the
          case to the bank's SAR workflow outside this prototype.
        </span>
      </div>

      <fieldset class="disposition-fieldset">
        <legend class="field-label">Disposition</legend>
        <div class="disposition-options">
          <For each={DISPOSITIONS}>
            {(value) => {
              const meta = dispositionMeta(value);
              return (
                <label class={`disposition-option tone-${meta.tone}`} classList={{ checked: disposition() === value }}>
                  <input
                    type="radio"
                    name="disposition"
                    value={value}
                    checked={disposition() === value}
                    onChange={() => setDisposition(value)}
                  />
                  <span class="disposition-icon"><Icon name={meta.icon} size={16} /></span>
                  <span class="disposition-text">
                    <span class="disposition-label">
                      {meta.label}
                      <Show when={props.aiRecommendation === value}>
                        <span class="tag tag-accent">AI pick</span>
                      </Show>
                    </span>
                    <span class="disposition-blurb">{meta.blurb}</span>
                  </span>
                  <span class="radio-dot" aria-hidden="true" />
                </label>
              );
            }}
          </For>
        </div>
      </fieldset>

      <div class="field">
        <div class="field-row">
          <label class="field-label" for="rationale">Rationale</label>
          <span class="field-count" classList={{ ok: rationaleOk() }}>
            {rationale().trim().length}/{MIN_RATIONALE}+
          </span>
        </div>
        <textarea
          id="rationale"
          rows={4}
          placeholder="What did you review, and why does this disposition follow from it?"
          value={rationale()}
          onInput={(e) => setRationale(e.currentTarget.value)}
        />
      </div>

      <Show when={differs()}>
        <div class="field field-override">
          <div class="field-row">
            <label class="field-label" for="override">
              <Icon name="alert" size={12} /> Override reason — required
            </label>
            <span class="field-count" classList={{ ok: overrideOk() }}>
              {overrideReason().trim().length}/{MIN_RATIONALE}+
            </span>
          </div>
          <p class="field-hint">
            You are departing from the AI recommendation ({dispositionMeta(props.aiRecommendation).label}). Overrides
            are recorded separately to measure automation bias.
          </p>
          <textarea
            id="override"
            rows={3}
            placeholder="Why does your judgment differ from the AI recommendation?"
            value={overrideReason()}
            onInput={(e) => setOverrideReason(e.currentTarget.value)}
          />
        </div>
      </Show>

      <Show when={error()}>
        <div class="callout callout-danger" role="alert">
          <Icon name="x-circle" size={14} />
          <span>{error()}</span>
        </div>
      </Show>

      <div class="form-footer">
        <span class="signer">
          Signing as <strong class="mono">{analystId() || "—"}</strong>
        </span>
        <button type="submit" class="btn btn-primary" disabled={!canSubmit()}>
          <Show when={submitting()} fallback={<Icon name="check" size={15} />}>
            <span class="spinner" />
          </Show>
          {submitting() ? "Recording…" : "Record decision"}
        </button>
      </div>
    </form>
  );
}
