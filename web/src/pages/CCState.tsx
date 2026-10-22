import { useState } from "preact/hooks";
import { Async } from "../components/Async";
import { Tabs } from "../components/KeyValues";
import { Progress } from "../components/Meter";
import { Panel, Rows } from "../components/Panel";
import { IntraMovementTable } from "../components/MovementTable";
import { JsonView } from "../components/Results";
import { Table } from "../components/Table";
import { formatMB, formatPct, formatTime } from "../format";
import { goalsFromState } from "../goals";
import { useResource } from "../hooks";

type Section = "executor" | "monitor" | "analyzer" | "anomaly";

const tag = (text: string, kind = "") => <span class={`badge ${kind}`}>{text}</span>;
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const brokers = (v: unknown) => (Array.isArray(v) && v.length ? <span class="mono">{v.join(", ")}</span> : <span class="muted">none</span>);
// Each view reads only the fields it knows; anything else CC adds stays reachable in "All fields".
const AllFields = ({ data }: { data: unknown }) => (
  <details>
    <summary>All fields</summary>
    <JsonView data={data} />
  </details>
);

const executorActive = (e: any) => !!e?.state && e.state !== "NO_TASK_IN_PROGRESS";

function Movement(props: { title: string; done?: number; total?: number; running?: number; pending?: number }) {
  const { done = 0, total = 0, running, pending } = props;
  if (!total) return null;
  const parts = [`${done} of ${total} finished`, running !== undefined && `${running} in progress`, pending !== undefined && `${pending} pending`].filter(Boolean);
  return (
    <div class="movement">
      <div>{props.title}</div>
      <Progress label={props.title} value={done} total={total} />
      <div class="mono caption">{parts.join(", ")}</div>
    </div>
  );
}

const INTRA: [string, string][] = [["completed", "Completed"], ["pending", "Pending"], ["inProgress", "In progress"], ["aborting", "Aborting"], ["aborted", "Aborted"], ["dead", "Dead"], ["cancelled", "Cancelled"]];

// One list per state; entries in the pending list carry their own state, as in the legacy Executor view.
function intraLists(e: any): [string, any[]][] {
  const get = (k: string): any[] => (Array.isArray(e[`${k}IntraBrokerPartitionMovement`]) ? e[`${k}IntraBrokerPartitionMovement`] : []);
  const pend = get("pending");
  return INTRA.map(([k, title]) => {
    const rows = k === "pending" ? pend.filter((m) => m?.state === "PENDING") : k === "inProgress" ? [...get(k), ...pend.filter((m) => m?.state === "IN_PROGRESS")] : get(k);
    return [`${title} intra-broker movements`, rows];
  });
}

function Executor({ e }: { e: any }) {
  if (!e) return <p class="muted">No executor data.</p>;
  const task = e.triggeredUserTaskId || e.triggeredSelfHealingTaskId;
  return (
    <div class="stack">
      <Panel title="Progress" aside={tag(executorActive(e) ? String(e.state) : "IDLE", executorActive(e) ? "warn" : "ok")}>
        {executorActive(e) ? (
          <>
            <Movement title="Partition movements" done={num(e.numFinishedPartitionMovements)} total={num(e.numTotalPartitionMovements)} running={num(e.numInProgressPartitionMovements)} pending={num(e.numPendingPartitionMovements)} />
            <Movement title="Leadership movements" done={num(e.numFinishedLeadershipMovements)} total={num(e.numTotalLeadershipMovements)} pending={num(e.numPendingLeadershipMovements)} />
            <Rows
              rows={[
                ["Data to move", num(e.totalDataToMove) !== undefined ? `${formatMB(e.finishedDataMovement ?? 0)} of ${formatMB(e.totalDataToMove)}` : undefined],
                ["Triggered by", task ? <span class="mono">{task}</span> : undefined],
                ["Reason", e.triggeredTaskReason || undefined],
              ]}
            />
          </>
        ) : (
          <p class="muted">No execution in progress.</p>
        )}
      </Panel>
      <Panel title="Recent broker changes">
        <Rows rows={[["Recently demoted brokers", brokers(e.recentlyDemotedBrokers)], ["Recently removed brokers", brokers(e.recentlyRemovedBrokers)]]} />
      </Panel>
      {intraLists(e).map(([title, rows]) => rows.length > 0 && <IntraMovementTable key={title} title={title} movements={rows} />)}
      <AllFields data={e} />
    </div>
  );
}

function Monitor({ m }: { m: any }) {
  if (!m) return <p class="muted">No monitor data.</p>;
  const cov = num(m.monitoringCoveragePct);
  return (
    <div class="stack">
      <Panel title="Load monitor" aside={tag(String(m.state ?? "UNKNOWN"))}>
        <Rows
          rows={[
            ["Trained", m.trained === undefined ? undefined : String(m.trained)],
            ["Training", num(m.trainingPct) !== undefined ? formatPct(m.trainingPct) : undefined],
            ["Monitored windows", m.numMonitoredWindows],
            ["Valid partitions", m.numValidPartitions !== undefined ? `${m.numValidPartitions} of ${m.numTotalPartitions ?? "?"}` : undefined],
            ["Flawed partitions", m.numFlawedPartitions],
            ["Coverage", cov !== undefined ? <><Progress label="Monitor window coverage" value={cov} total={100} /> <span class="mono">{formatPct(cov)}</span></> : undefined],
            ["Loading progress", m.state === "LOADING" && num(m.loadingProgressPct) !== undefined ? <><Progress label="Loading progress" value={m.loadingProgressPct} total={100} /> <span class="mono">{formatPct(m.loadingProgressPct)}</span></> : undefined],
            ["Last pause or resume", m.reasonOfLatestPauseOrResume || undefined],
          ]}
        />
      </Panel>
      <AllFields data={m} />
    </div>
  );
}

function Analyzer({ state }: { state: any }) {
  const a = state?.AnalyzerState ?? {};
  const m = state?.MonitorState ?? {};
  const goals = goalsFromState(state);
  const ready = new Set<string>(a.readyGoals ?? (a.goalReadiness ?? []).filter((g: any) => g.status === "ready").map((g: any) => g.name));
  const list = (title: string, names: string[]) => (
    <Panel title={title} aside={<span class="mono muted">{names.filter((n) => ready.has(n)).length} / {names.length} ready</span>}>
      {names.length === 0 ? (
        <p class="muted">None reported.</p>
      ) : (
        <ul class="goal-list">
          {names.map((n) => (
            <li key={n}>
              <span class="mono">{n}</span>
              {tag(ready.has(n) ? "READY" : "NOT READY", ready.has(n) ? "ok" : "warn")}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
  const cov = num(m.monitoringCoveragePct);
  return (
    <div class="stack">
      {!a.isProposalReady && (
        <p class="banner" role="note">
          No proposal can be computed yet. Cruise Control needs more monitored windows or ready goals.
        </p>
      )}
      <div class="two-col">
        {list("Hard goals", goals.hard)}
        {list("Soft goals", goals.soft)}
      </div>
      <Panel title="Monitor window coverage">
        <Rows
          rows={[
            ["Monitored windows", m.numMonitoredWindows],
            ["Valid partitions", m.numValidPartitions !== undefined ? `${m.numValidPartitions} of ${m.numTotalPartitions ?? "?"}` : undefined],
            ["Coverage", cov !== undefined ? <><Progress label="Monitor window coverage" value={cov} total={100} /> <span class="mono">{formatPct(cov)}</span></> : undefined],
          ]}
        />
      </Panel>
    </div>
  );
}

const ANOMALIES: [string, string][] = [
  ["recentGoalViolations", "Goal violation"],
  ["recentBrokerFailures", "Broker failure"],
  ["recentMetricAnomalies", "Metric anomaly"],
  ["recentDiskFailures", "Disk failure"],
  ["recentTopicAnomalies", "Topic anomaly"],
  ["recentMaintenanceEvents", "Maintenance event"],
];

function Anomalies({ d }: { d: any }) {
  if (!d) return <p class="muted">No anomaly detector data.</p>;
  const rows = ANOMALIES.flatMap(([key, type]) => (Array.isArray(d[key]) ? d[key] : []).map((a: any) => ({ type, id: String(a.anomalyId ?? ""), status: String(a.status ?? ""), at: num(a.detectionMs) })));
  const ratio = (n: string) => (num(d.selfHealingEnabledRatio?.[n]) !== undefined ? ` ${formatPct(d.selfHealingEnabledRatio[n] * 100)}` : "");
  const names = (v: unknown) => (Array.isArray(v) && v.length ? v.map((n) => <span key={n}>{tag(String(n), "")}{ratio(n)} </span>) : <span class="muted">none</span>);
  const mt = d.metrics ?? {};
  return (
    <div class="stack">
      <Panel title="Self-healing">
        <Rows rows={[["Enabled for", names(d.selfHealingEnabled)], ["Disabled for", names(d.selfHealingDisabled)], ["Ongoing self-healing", d.ongoingSelfHealingAnomaly || undefined],
          ["Mean time to start fix", num(mt.meanTimeToStartFixMs) !== undefined ? `${Math.round(mt.meanTimeToStartFixMs / 6000) / 10} minutes` : undefined],
          ["Self-healing started", num(mt.numSelfHealingStarted)],
          ["Self-healing failed to start", num(mt.numSelfHealingFailedToStart)]]} />
      </Panel>
      {rows.length === 0 ? (
        <Panel title="Recent anomalies">
          <p class="muted">No recent anomalies.</p>
        </Panel>
      ) : (
        <Table
          caption="Recent anomalies"
          rows={rows}
          filterable={false}
          columns={[
            { key: "type", header: "Type", value: (r) => r.type },
            { key: "id", header: "Anomaly id", value: (r) => r.id, render: (r) => <span class="mono">{r.id}</span> },
            { key: "status", header: "Status", value: (r) => r.status, render: (r) => tag(r.status) },
            { key: "at", header: "Detected", value: (r) => r.at ?? 0, render: (r) => (r.at ? formatTime(r.at) : "") },
          ]}
        />
      )}
      <AllFields data={d} />
    </div>
  );
}

export function CCState() {
  const [section, setSection] = useState<Section>("executor");
  const res = useResource("state", { verbose: true });
  return (
    <Async title="Cruise Control state" res={res}>
      {(d) => {
        const ready = !!d.AnalyzerState?.isProposalReady;
        const bal = num(d.AnomalyDetectorState?.balancednessScore);
        return (
          <div class="stack">
            <dl class="stats">
              <div>
                <dt>Executor</dt>
                <dd>{tag(executorActive(d.ExecutorState) ? String(d.ExecutorState.state) : "IDLE", executorActive(d.ExecutorState) ? "warn" : "ok")}</dd>
              </div>
              <div>
                <dt>Monitor</dt>
                <dd>{tag(String(d.MonitorState?.state ?? "UNKNOWN"))}</dd>
              </div>
              <div>
                <dt>Analyzer</dt>
                <dd>{tag(ready ? "PROPOSAL READY" : "PROPOSAL NOT READY", ready ? "ok" : "warn")}</dd>
              </div>
              <div>
                <dt>Balancedness</dt>
                <dd class="mono">{bal !== undefined ? Math.round(bal * 10) / 10 : "-"}</dd>
              </div>
            </dl>
            <Tabs
              label="State section"
              value={section}
              onChange={setSection}
              options={[["executor", "Executor"], ["monitor", "Monitor"], ["analyzer", "Analyzer"], ["anomaly", "Anomaly detector"]]}
            />
            {section === "executor" && <Executor e={d.ExecutorState} />}
            {section === "monitor" && <Monitor m={d.MonitorState} />}
            {section === "analyzer" && <Analyzer state={d} />}
            {section === "anomaly" && <Anomalies d={d.AnomalyDetectorState} />}
          </div>
        );
      }}
    </Async>
  );
}
