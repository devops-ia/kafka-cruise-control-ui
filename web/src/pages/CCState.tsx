import { useState } from "preact/hooks";
import { Async } from "../components/Async";
import { KeyValues, Tabs } from "../components/KeyValues";
import { goalsFromState } from "../goals";
import { useResource } from "../hooks";


type Section = "executor" | "monitor" | "analyzer" | "anomaly";

function Analyzer({ state }: { state: any }) {
  const a = state?.AnalyzerState ?? {};
  const goals = goalsFromState(state);
  const ready = new Set<string>(a.readyGoals ?? (a.goalReadiness ?? []).filter((g: any) => g.status === "ready").map((g: any) => g.name));
  const list = (title: string, names: string[]) => (
    <div class="stack">
      <h2>{title}</h2>
      {names.length === 0 ? (
        <p class="muted">None reported.</p>
      ) : (
        <ul class="chips">
          {names.map((n) => (
            <li key={n} class={`badge ${ready.has(n) ? "ok" : "bad"}`}>
              {n}: {ready.has(n) ? "ready" : "not ready"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div class="stack">
      <p>
        Proposal ready: <span class={`badge ${a.isProposalReady ? "ok" : "bad"}`}>{String(!!a.isProposalReady)}</span>
      </p>
      {list("Hard goals", goals.hard)}
      {list("Soft goals", goals.soft)}
    </div>
  );
}

export function CCState() {
  const [section, setSection] = useState<Section>("executor");
  const res = useResource("state", { verbose: true });
  return (
    <Async title="Cruise Control state" res={res}>
      {(d) => (
        <div class="stack">
          <Tabs
            label="State section"
            value={section}
            onChange={setSection}
            options={[["executor", "Executor"], ["monitor", "Monitor"], ["analyzer", "Analyzer"], ["anomaly", "Anomaly detector"]]}
          />
          {section === "executor" && <KeyValues obj={d.ExecutorState} />}
          {section === "monitor" && <KeyValues obj={d.MonitorState} />}
          {section === "analyzer" && <Analyzer state={d} />}
          {section === "anomaly" && <KeyValues obj={d.AnomalyDetectorState} />}
        </div>
      )}
    </Async>
  );
}
