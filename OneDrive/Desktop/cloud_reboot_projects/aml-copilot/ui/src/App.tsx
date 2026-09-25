import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { CaseList, caseFilter, caseQuery, visibleCases } from "./components/CaseList";
import { CaseWorkbench } from "./components/CaseWorkbench";
import { Icon } from "./components/Icon";
import { role, setRole, analystId, setAnalystId } from "./lib/identity";
import { fetchCases, refreshToken } from "./lib/caseListStore";
import { theme, toggleTheme } from "./lib/theme";
import { toasts, dismissToast } from "./lib/toast";
import "./App.css";

const ROLES = [
  { value: "analyst", label: "Analyst", hint: "Sees case content and can record decisions" },
  { value: "sanctions", label: "Sanctions", hint: "Sees case content, cannot decide AML cases" },
  { value: "readonly", label: "Read-only", hint: "Not SAR-scoped — case content withheld" },
] as const;

function App() {
  const [selected, setSelected] = createSignal<string | null>(null);
  const [cases] = createResource(refreshToken, fetchCases);
  let searchEl: HTMLInputElement | undefined;

  const selectedSummary = () => cases()?.find((c) => c.caseId === selected());

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest("input, textarea, select")) {
        if (e.key === "Escape") (t as HTMLElement).blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchEl?.focus();
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      const list = visibleCases(cases() ?? [], caseFilter(), caseQuery());
      if (!list.length) return;
      const i = list.findIndex((c) => c.caseId === selected());
      const next = e.key === "j" ? Math.min(list.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      setSelected(list[next]!.caseId);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const counts = () => {
    const list = cases() ?? [];
    return {
      decide: list.filter((c) => c.state === "AWAITING_ANALYST").length,
      notRun: list.filter((c) => c.state === null).length,
    };
  };

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark"><Icon name="shield" size={17} /></span>
          <div class="brand-text">
            <span class="brand-name">AML Co-Pilot</span>
            <span class="brand-sub">Investigation workbench</span>
          </div>
        </div>

        <div class="topbar-status">
          <Show when={cases()}>
            <span class="status-chip">
              <span class="dot dot-warning" /> {counts().decide} awaiting decision
            </span>
            <span class="status-chip">
              <span class="dot dot-neutral" /> {counts().notRun} not run
            </span>
          </Show>
        </div>

        <div class="topbar-controls">
          <div class="segmented" role="radiogroup" aria-label="Acting role (prototype identity stub)">
            <For each={ROLES}>
              {(r) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={role() === r.value}
                  class="segment"
                  classList={{ active: role() === r.value }}
                  title={r.hint}
                  onClick={() => setRole(r.value)}
                >
                  {r.label}
                </button>
              )}
            </For>
          </div>
          <label class="analyst-field" title="Analyst identity sent as X-Analyst-Id (prototype stand-in for SSO)">
            <span class="avatar">{(analystId()[0] ?? "?").toUpperCase()}</span>
            <input
              value={analystId()}
              aria-label="Analyst ID"
              spellcheck={false}
              onInput={(e) => setAnalystId(e.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            class="icon-btn"
            aria-label={`Switch to ${theme() === "dark" ? "light" : "dark"} theme`}
            title="Toggle theme"
            onClick={toggleTheme}
          >
            <Icon name={theme() === "dark" ? "sun" : "moon"} size={16} />
          </button>
        </div>
      </header>

      <div class="layout">
        <CaseList
          cases={cases()}
          loading={cases.loading}
          selected={selected()}
          onSelect={setSelected}
          searchRef={(el) => (searchEl = el)}
        />
        <main class="main">
          <Show
            when={selectedSummary()}
            fallback={
              <div class="welcome">
                <span class="welcome-icon"><Icon name="shield" size={30} /></span>
                <h1>Evidence-grounded alert investigation</h1>
                <p>
                  Pick a case from the queue. Agents gather and explain the evidence; deterministic code computes every
                  number; an independent verifier checks every material fact; and only you can make the call.
                </p>
                <ul class="welcome-points">
                  <li><Icon name="database" size={15} /> Every claim links to the real record behind it</li>
                  <li><Icon name="verify" size={15} /> Unverifiable packets are withheld, never shown</li>
                  <li><Icon name="decision" size={15} /> The SAR decision is human-only, by construction</li>
                </ul>
                <p class="muted small">
                  Press <kbd>J</kbd> to open the first case.
                </p>
              </div>
            }
          >
            {(s) => <CaseWorkbench summary={s()} />}
          </Show>
        </main>
      </div>

      <div class="toasts" role="status" aria-live="polite">
        <For each={toasts()}>
          {(t) => (
            <div class={`toast tone-${t.tone}`}>
              <Icon name={t.tone === "success" ? "check-circle" : t.tone === "danger" ? "x-circle" : "info"} size={16} />
              <div class="toast-body">
                <strong>{t.title}</strong>
                <Show when={t.body}><span>{t.body}</span></Show>
              </div>
              <button type="button" class="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export default App;
