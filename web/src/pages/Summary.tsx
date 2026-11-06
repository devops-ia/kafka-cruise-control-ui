import { useCallback, useEffect, useState } from "preact/hooks";
import { useClusters } from "../clusters";
import { useResource } from "../hooks";
import { navigate } from "../router";
import { setCluster } from "../store";
import { RefreshBar } from "../components/Async";


function Row({ name, group, onlyProposal, outOfGroup, report }: { name: string; group?: string; onlyProposal: boolean; outOfGroup: boolean; report: (name: string, isProposal: boolean) => void }) {
  const kcs = useResource("kafka_cluster_state", {}, name);
  const st = useResource("state", { substates: "EXECUTOR,ANALYZER" }, name);
  const s = kcs.data?.KafkaBrokerState?.Summary ?? {};
  const parts = kcs.data?.KafkaPartitionState ?? {};
  const bad = (parts.offline?.length ?? 0) + (parts.urp?.length ?? 0) + (parts["with-offline-replicas"]?.length ?? 0);
  const ready = st.data?.AnalyzerState?.isProposalReady;
  const failed = kcs.error && !kcs.data;
  // An empty name makes useResource skip the call, so only a ready cluster costs a proposals request.
  const p = useResource("proposals", {}, ready ? name : "");
  const sm = p.data?.summary;
  const moves = (sm?.numReplicaMovements ?? 0) + (sm?.numLeaderMovements ?? 0) + (sm?.numIntraBrokerReplicaMovements ?? 0) > 0;
  const isProposal = !!(ready && sm && moves);
  useEffect(() => report(name, isProposal), [name, isProposal]);
  if (outOfGroup || (onlyProposal && !isProposal)) return null;
  let proposal;
  if (ready == null) proposal = st.error ? "-" : "...";
  else if (!ready) proposal = <span class="badge bad">not ready</span>;
  else if (!sm) proposal = <span class={p.error ? undefined : "muted"}>{p.error ? "-" : "..."}</span>;
  else if (!moves) proposal = <span class="badge muted-state">no changes</span>;
  else
    proposal = (
      <button
        type="button"
        class="badge ok"
        onClick={() => {
          setCluster(name);
          navigate("/proposals");
        }}
      >
        proposal
      </button>
    );
  return (
    <tr>
      <th scope="row">
        <button
          type="button"
          class="link"
          onClick={() => {
            setCluster(name);
            navigate("/state");
          }}
        >
          {name}
        </button>
      </th>
      <td>{group ?? ""}</td>
      <td>
        {failed ? <span class="badge bad">unreachable</span> : kcs.data ? <span class={`badge ${bad ? "bad" : "ok"}`}>{bad ? `${bad} partitions at risk` : "healthy"}</span> : <span class="muted">...</span>}
      </td>
      <td class="num">{s.Brokers ?? "-"}</td>
      <td class="num">{s.Topics ?? "-"}</td>
      <td class="num">{s.Replicas ?? "-"}</td>
      <td class="num">{s.Leaders ?? "-"}</td>
      <td>{st.data?.ExecutorState?.state ?? (st.error ? "-" : "...")}</td>
      <td>{proposal}</td>
      <td class="muted">{failed ? kcs.error?.message : ""}</td>
    </tr>
  );
}

export function Summary() {
  const clusters = useClusters();
  const [tick, setTick] = useState(0); // new key remounts the rows, which reloads them
  const [group, setGroup] = useState("");
  const [onlyProposal, setOnlyProposal] = useState(false);
  // Rows that hide themselves stay mounted (no new requests), so they tell us which ones hold a proposal.
  const [proposals, setProposals] = useState<Record<string, boolean>>({});
  const report = useCallback((n: string, v: boolean) => setProposals((m) => (m[n] === v ? m : { ...m, [n]: v })), []);
  const groups = [...new Set(clusters.map((c) => c.group).filter(Boolean))].sort();
  const shown = clusters.filter((c) => (!group || c.group === group) && (!onlyProposal || proposals[c.name]));
  return (
    <section aria-labelledby="page-title">
      <div class="page-head">
        <h1 id="page-title">Summary</h1>
        <RefreshBar onReload={() => setTick(tick + 1)} />
      </div>
      <div class="filters">
        <label>
          Group{" "}
          <select value={group} onChange={(e) => setGroup(e.currentTarget.value)}>
            <option value="">All</option>
            {groups.map((g) => (
              <option value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label>
          Proposal{" "}
          <select value={onlyProposal ? "proposal" : ""} onChange={(e) => setOnlyProposal(e.currentTarget.value === "proposal")}>
            <option value="">All</option>
            <option value="proposal">proposal</option>
          </select>
        </label>
      </div>
      <div class="table-wrap">
        <table>
          <caption class="sr-only">All clusters</caption>
          <thead>
            <tr>
              <th scope="col">Cluster</th>
              <th scope="col">Group</th>
              <th scope="col">Health</th>
              <th scope="col" class="num">Brokers</th>
              <th scope="col" class="num">Topics</th>
              <th scope="col" class="num">Replicas</th>
              <th scope="col" class="num">Leaders</th>
              <th scope="col">Executor</th>
              <th scope="col">Proposal</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <Row key={`${c.name}-${tick}`} name={c.name} group={c.group} onlyProposal={onlyProposal} outOfGroup={!!group && c.group !== group} report={report} />
            ))}
          </tbody>
        </table>
        {clusters.length > 0 && !shown.length && <p class="muted">No clusters match the filters</p>}
      </div>
    </section>
  );
}
