import { useState } from "preact/hooks";
import { useClusters } from "../clusters";
import { useResource } from "../hooks";
import { navigate } from "../router";
import { setCluster } from "../store";
import { RefreshBar } from "../components/Async";


function Row({ name, group }: { name: string; group?: string }) {
  const kcs = useResource("kafka_cluster_state", {}, name);
  const st = useResource("state", { substates: "EXECUTOR" }, name);
  const s = kcs.data?.KafkaBrokerState?.Summary ?? {};
  const parts = kcs.data?.KafkaPartitionState ?? {};
  const bad = (parts.offline?.length ?? 0) + (parts.urp?.length ?? 0) + (parts["with-offline-replicas"]?.length ?? 0);
  const failed = kcs.error && !kcs.data;
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
      <td class="muted">{failed ? kcs.error?.message : ""}</td>
    </tr>
  );
}

export function Summary() {
  const clusters = useClusters();
  const [tick, setTick] = useState(0); // new key remounts the rows, which reloads them
  return (
    <section aria-labelledby="page-title">
      <div class="page-head">
        <h1 id="page-title">Summary</h1>
        <RefreshBar onReload={() => setTick(tick + 1)} />
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
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <Row key={`${c.name}-${tick}`} name={c.name} group={c.group} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
