import { For, Show, createSignal } from "solid-js";
import type { CaseSummary } from "../lib/caseListStore";
import { humanize, stateMeta } from "../lib/format";
import { Icon } from "./Icon";

type Filter = "all" | "decide" | "escalated" | "decided" | "notrun";

const FILTERS: { key: Filter; label: string; test: (c: CaseSummary) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "decide", label: "To decide", test: (c) => c.state === "AWAITING_ANALYST" },
  { key: "escalated", label: "Stopped", test: (c) => c.state === "ESCALATED_SANCTIONS" || c.state === "BLOCKED_VERIFICATION" },
  { key: "decided", label: "Decided", test: (c) => c.state === "DISPOSITION_RECORDED" || c.state === "QA" },
  { key: "notrun", label: "Not run", test: (c) => c.state === null },
];

export function visibleCases(cases: CaseSummary[], filter: Filter, query: string): CaseSummary[] {
  const f = FILTERS.find((x) => x.key === filter)!;
  const q = query.trim().toLowerCase();
  return cases.filter(
    (c) =>
      f.test(c) &&
      (!q ||
        c.caseId.toLowerCase().includes(q) ||
        c.accountId.toLowerCase().includes(q) ||
        c.classification.toLowerCase().includes(q)),
  );
}

export const [caseFilter, setCaseFilter] = createSignal<Filter>("all");
export const [caseQuery, setCaseQuery] = createSignal("");

export function CaseList(props: {
  cases: CaseSummary[] | undefined;
  loading: boolean;
  selected: string | null;
  onSelect: (caseId: string) => void;
  searchRef?: (el: HTMLInputElement) => void;
}) {
  const all = () => props.cases ?? [];
  const shown = () => visibleCases(all(), caseFilter(), caseQuery());

  return (
    <nav class="sidebar" aria-label="Case queue">
      <div class="sidebar-head">
        <div class="sidebar-title">
          <Icon name="inbox" size={15} />
          <h2>Alert queue</h2>
          <span class="count-pill">{all().length}</span>
        </div>
        <label class="search">
          <Icon name="search" size={14} />
          <input
            ref={props.searchRef}
            type="search"
            placeholder="Search cases, accounts…"
            aria-label="Search cases"
            value={caseQuery()}
            onInput={(e) => setCaseQuery(e.currentTarget.value)}
          />
          <kbd>/</kbd>
        </label>
        <div class="filter-chips" role="group" aria-label="Filter by status">
          <For each={FILTERS}>
            {(f) => {
              const n = () => all().filter(f.test).length;
              return (
                <button
                  type="button"
                  class="chip"
                  classList={{ active: caseFilter() === f.key }}
                  aria-pressed={caseFilter() === f.key}
                  disabled={f.key !== "all" && n() === 0}
                  onClick={() => setCaseFilter(f.key)}
                >
                  {f.label}
                  <span class="chip-count">{n()}</span>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      <div class="sidebar-scroll">
        <Show
          when={!props.loading || props.cases}
          fallback={
            <div class="skeleton-stack">
              <For each={[1, 2, 3, 4, 5]}>{() => <div class="skeleton" style={{ height: "68px" }} />}</For>
            </div>
          }
        >
          <ul class="case-items">
            <For
              each={shown()}
              fallback={
                <li class="case-empty">
                  <Icon name="search" size={16} />
                  No cases match.
                </li>
              }
            >
              {(c) => {
                const meta = () => stateMeta(c.state);
                return (
                  <li>
                    <button
                      type="button"
                      class="case-item"
                      classList={{ selected: c.caseId === props.selected }}
                      aria-current={c.caseId === props.selected ? "true" : undefined}
                      onClick={() => props.onSelect(c.caseId)}
                    >
                      <span class={`case-status tone-${meta().tone}`} title={meta().label}>
                        <Icon name={meta().icon} size={14} />
                      </span>
                      <span class="case-main">
                        <span class="case-row">
                          <strong class="case-id">{c.caseId}</strong>
                          <span class={`status-text tone-${meta().tone}`}>{meta().label}</span>
                        </span>
                        <span class="case-class">{humanize(c.classification)}</span>
                        <span class="case-meta">
                          <span class="mono">{c.accountId}</span>
                          <Show when={c.isLaundering}>
                            <span class="truth-dot" title="IBM ground truth: laundering-labelled account">labelled</span>
                          </Show>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>

      <div class="sidebar-foot">
        <Icon name="keyboard" size={13} />
        <span><kbd>J</kbd><kbd>K</kbd> cases</span>
        <span><kbd>1</kbd>–<kbd>7</kbd> tabs</span>
        <span><kbd>/</kbd> search</span>
      </div>
    </nav>
  );
}
