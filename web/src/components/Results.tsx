import { formatMB } from "../format";
import { LoadDiff } from "./LoadDiff";
import { MovementTable } from "./MovementTable";
import { Table } from "./Table";


/** Renders a CC optimization result (proposals, rebalance dry-run); anything else falls back to JSON. */
export function OptimizationView({ data }: { data: any }) {
  const s = data?.summary;
  if (!s) return <JsonView data={data} />;
  const stats: [string, string | number][] = [
    ["Replica movements", s.numReplicaMovements],
    ["Data to move", s.dataToMoveMB !== undefined ? formatMB(s.dataToMoveMB) : "-"],
    ["Leader movements", s.numLeaderMovements],
    ["Intra-broker movements", s.numIntraBrokerReplicaMovements],
    ["Balancedness before", s.onDemandBalancednessScoreBefore !== undefined ? Number(s.onDemandBalancednessScoreBefore).toFixed(1) : "-"],
    ["Balancedness after", s.onDemandBalancednessScoreAfter !== undefined ? Number(s.onDemandBalancednessScoreAfter).toFixed(1) : "-"],
  ];
  const goals: { goal: string; status: string }[] = data.goalSummary ?? [];
  const [before, after] = [s.onDemandBalancednessScoreBefore, s.onDemandBalancednessScoreAfter];
  const changed =
    ["numReplicaMovements", "numIntraBrokerReplicaMovements", "numLeaderMovements", "dataToMoveMB"].some((k) => (s[k] ?? 0) > 0) ||
    (before !== undefined && after !== undefined && Number(before).toFixed(1) !== Number(after).toFixed(1));
  return (
    <div class="stack">
      <div class={goals.length > 0 ? "two-col" : undefined}>
        <dl class="stats">
          {stats.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v ?? "-"}</dd>
            </div>
          ))}
        </dl>
        {goals.length > 0 && (
          <Table
            caption="Goal results"
            rows={goals}
            filterable={false}
            columns={[
              { key: "goal", header: "Goal", value: (g) => g.goal },
              { key: "status", header: "Status", value: (g) => g.status, render: (g) => <span class={`badge ${g.status === "VIOLATED" ? "bad" : "ok"}`}>{g.status}</span> },
            ]}
          />
        )}
      </div>
      {data.loadBeforeOptimization && data.loadAfterOptimization && <LoadDiff before={data.loadBeforeOptimization} after={data.loadAfterOptimization} open={changed} />}
      {Array.isArray(data.proposals) && data.proposals.length > 0 && (
        <details open={changed}>
          <summary>Proposed partition movements ({data.proposals.length})</summary>
          <MovementTable title="Proposed partition movements" movements={data.proposals} />
        </details>
      )}
    </div>
  );
}

export function JsonView({ data }: { data: unknown }) {
  return <pre class="json" tabIndex={0}>{typeof data === "string" ? data : JSON.stringify(data, null, 2)}</pre>;
}
