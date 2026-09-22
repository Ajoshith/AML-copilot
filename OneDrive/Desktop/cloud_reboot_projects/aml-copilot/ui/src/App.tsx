import { createSignal, Show, createResource } from "solid-js";
import { CaseList } from "./components/CaseList";
import { CaseWorkbench } from "./components/CaseWorkbench";
import { role, setRole, analystId, setAnalystId } from "./lib/identity";
import { fetchCases, refreshToken } from "./lib/caseListStore";
import "./App.css";

function App() {
  const [selected, setSelected] = createSignal<string | null>(null);
  const [cases] = createResource(refreshToken, fetchCases);

  const selectedAccountId = () => cases()?.find((c) => c.caseId === selected())?.accountId ?? "";

  return (
    <div class="app">
      <header class="topbar">
        <div class="topbar-brand">
          <div class="mark">🛡️</div>
          <div>
            <h1>AML Investigation Co-Pilot</h1>
            <div class="subtitle">Evidence-grounded alert investigation</div>
          </div>
        </div>
        <div class="identity-controls">
          <label>
            Role
            <select value={role()} onInput={(e) => setRole(e.currentTarget.value as never)}>
              <option value="analyst">analyst</option>
              <option value="sanctions">sanctions</option>
              <option value="readonly">readonly</option>
            </select>
          </label>
          <label>
            Analyst ID
            <input value={analystId()} onInput={(e) => setAnalystId(e.currentTarget.value)} />
          </label>
        </div>
      </header>

      <div class="body">
        <CaseList cases={cases()} loading={cases.loading} selected={selected()} onSelect={setSelected} />
        <main class="main-panel">
          <Show
            when={selected()}
            fallback={
              <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <p>Select a case from the left to begin the investigation.</p>
              </div>
            }
          >
            <CaseWorkbench caseId={selected()!} accountId={selectedAccountId()} />
          </Show>
        </main>
      </div>
    </div>
  );
}

export default App;
