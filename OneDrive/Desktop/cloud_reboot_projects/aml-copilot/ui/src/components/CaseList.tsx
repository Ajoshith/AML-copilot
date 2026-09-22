import { For, Show } from "solid-js";
import type { CaseSummary } from "../lib/caseListStore";

function stateBadgeClass(state: string | null): string {
  if (state === null) return "badge badge-notrun";
  if (state === "AWAITING_ANALYST") return "badge badge-waiting";
  if (state === "BLOCKED_VERIFICATION") return "badge badge-blocked";
  if (state === "ESCALATED_SANCTIONS") return "badge badge-sanctions";
  if (state === "QA" || state === "DISPOSITION_RECORDED") return "badge badge-done";
  return "badge badge-running";
}

function stateLabel(state: string | null): string {
  return state ?? "NOT RUN";
}

export function CaseList(props: {
  cases: CaseSummary[] | undefined;
  loading: boolean;
  selected: string | null;
  onSelect: (caseId: string) => void;
}) {
  return (
    <div class="case-list">
      <div class="case-list-header">
        <h2>Cases</h2>
        <Show when={props.cases}>{(c) => <span class="case-count">{c().length}</span>}</Show>
      </div>
      <div class="case-list-scroll">
        <Show when={!props.loading} fallback={<p class="muted">Loading…</p>}>
          <ul>
            <For each={props.cases}>
              {(c: CaseSummary) => (
                <li
                  class={c.caseId === props.selected ? "case-item selected" : "case-item"}
                  tabIndex={0}
                  role="button"
                  aria-pressed={c.caseId === props.selected}
                  onClick={() => props.onSelect(c.caseId)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onSelect(c.caseId)}
                >
                  <div class="case-item-top">
                    <strong>{c.caseId}</strong>
                    <span class={stateBadgeClass(c.state)}>{stateLabel(c.state)}</span>
                  </div>
                  <div class="case-item-classification">{c.classification}</div>
                  <Show when={c.isLaundering}>
                    <div class="flag-inline">real Is Laundering=true</div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}
