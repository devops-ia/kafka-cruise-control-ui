import { Async } from "../components/Async";
import { Table } from "../components/Table";
import { useResource } from "../hooks";


const GROUPS: [string, string][] = [
  ["offline", "Offline partitions"],
  ["with-offline-replicas", "Partitions with offline replicas"],
  ["urp", "Under-replicated partitions"],
  ["under-min-isr", "Under min ISR"],
  ["other", "Other"], // shown only when CC reports something in it
];

/** One table for all partition categories; a category with partitions is flagged and lists them right under its row. */
function Health({ parts }: { parts: Record<string, any[]> }) {
  const cats = GROUPS.map(([key, title]) => ({ key, title, rows: parts[key] ?? [] })).filter((c) => c.key !== "other" || c.rows.length);
  const issues = cats.reduce((n, c) => n + c.rows.length, 0);
  return (
    <div class="panel" role="region" aria-label="Partition health">
      <div class="panel-head">
        <h2>Partition health</h2>
        <span class={`badge ${issues ? "bad" : "ok"}`}>{issues ? `${issues} issues` : "all clear"}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col" class="num">Partitions</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {cats.flatMap((c) => [
            <tr key={c.key}>
              <td>{c.title}</td>
              <td class="num">{c.rows.length}</td>
              <td>
                <span class={`badge ${c.rows.length ? "bad" : "ok"}`}>{c.rows.length ? "DEGRADED" : "OK"}</span>
              </td>
            </tr>,
            c.rows.length > 0 && (
              <tr key={`${c.key}-list`} class="nested">
                <td colSpan={3}>
                  <table aria-label={`${c.title}, partitions`}>
                    <thead>
                      <tr>
                        <th scope="col">Topic / partition</th>
                        <th scope="col">Leader</th>
                        <th scope="col">In sync</th>
                        <th scope="col">Out of sync</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.rows.map((r, i) => (
                        <tr key={`${r.topic}-${r.partition}-${i}`}>
                          <td class="mono">
                            <span>{r.topic}</span> / {r.partition}
                          </td>
                          <td class="mono">{r.leader}</td>
                          <td class="mono">{(r["in-sync"] ?? []).join(", ")}</td>
                          <td class="mono">{(r["out-of-sync"] ?? []).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            ),
          ])}
        </tbody>
      </table>
    </div>
  );
}

export function brokerRows(state: any) {
  const b = state?.KafkaBrokerState ?? {};
  const ids = Object.keys(b.ReplicaCountByBrokerId ?? b.LeaderCountByBrokerId ?? {});
  return ids.map((id) => ({
    id: Number(id),
    leaders: b.LeaderCountByBrokerId?.[id] ?? 0,
    replicas: b.ReplicaCountByBrokerId?.[id] ?? 0,
    outOfSync: b.OutOfSyncCountByBrokerId?.[id] ?? 0,
    offline: b.OfflineReplicaCountByBrokerId?.[id] ?? 0,
    controller: !!b.IsController?.[id],
    offlineDirs: (b.OfflineLogDirsByBrokerId?.[id] ?? []).length,
  }));
}

export function ClusterState() {
  const res = useResource("kafka_cluster_state", { verbose: true });
  return (
    <Async title="Cluster state" res={res}>
      {(d) => {
        const summary = d.KafkaBrokerState?.Summary;
        const parts = d.KafkaPartitionState ?? {};
        return (
          <div class="stack">
            {summary && (
              <dl class="stats">
                {Object.entries(summary).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{typeof v === "number" ? Math.round(v * 100) / 100 : String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Health parts={parts} />
            <h2>Brokers</h2>
            <Table
              caption="Brokers"
              rows={brokerRows(d)}
              rowKey={(r) => r.id}
              columns={[
                { key: "id", header: "Broker", value: (r) => r.id, numeric: true },
                { key: "controller", header: "Role", value: (r) => (r.controller ? "CONTROLLER" : ""), render: (r) => (r.controller ? <span class="badge">CONTROLLER</span> : "") },
                { key: "leaders", header: "Leaders", value: (r) => r.leaders, numeric: true },
                { key: "replicas", header: "Replicas", value: (r) => r.replicas, numeric: true },
                { key: "oos", header: "Out of sync", value: (r) => r.outOfSync, numeric: true },
                { key: "off", header: "Offline replicas", value: (r) => r.offline, numeric: true },
                { key: "dirs", header: "Offline dirs", value: (r) => r.offlineDirs, numeric: true },
              ]}
            />
          </div>
        );
      }}
    </Async>
  );
}
