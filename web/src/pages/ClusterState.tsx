import { Async } from "../components/Async";
import { Table } from "../components/Table";
import { useResource } from "../hooks";


const GROUPS: [string, string][] = [
  ["offline", "Offline partitions"],
  ["with-offline-replicas", "Partitions with offline replicas"],
  ["urp", "Under-replicated partitions"],
  ["under-min-isr", "Under min ISR"],
  ["other", "Other"],
];

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
            <h2>Brokers</h2>
            <Table
              caption="Brokers"
              rows={brokerRows(d)}
              rowKey={(r) => r.id}
              columns={[
                { key: "id", header: "Broker", value: (r) => r.id, numeric: true },
                { key: "controller", header: "Controller", value: (r) => (r.controller ? "yes" : "") },
                { key: "leaders", header: "Leaders", value: (r) => r.leaders, numeric: true },
                { key: "replicas", header: "Replicas", value: (r) => r.replicas, numeric: true },
                { key: "oos", header: "Out of sync", value: (r) => r.outOfSync, numeric: true },
                { key: "off", header: "Offline replicas", value: (r) => r.offline, numeric: true },
                { key: "dirs", header: "Offline log dirs", value: (r) => r.offlineDirs, numeric: true },
              ]}
            />
            {GROUPS.map(([key, title]) => {
              const rows: any[] = parts[key] ?? [];
              return (
                <div key={key} class="stack">
                  <h2>
                    {title} <span class={`badge ${rows.length ? "bad" : "ok"}`}>{rows.length}</span>
                  </h2>
                  {rows.length > 0 && (
                    <Table
                      caption={title}
                      rows={rows}
                      rowKey={(r, i) => `${r.topic}-${r.partition}-${i}`}
                      columns={[
                        { key: "topic", header: "Topic", value: (r: any) => r.topic },
                        { key: "partition", header: "Partition", value: (r: any) => r.partition, numeric: true },
                        { key: "leader", header: "Leader", value: (r: any) => r.leader, numeric: true },
                        { key: "replicas", header: "Replicas", value: (r: any) => (r.replicas ?? []).join(", ") },
                        { key: "isr", header: "In sync", value: (r: any) => (r["in-sync"] ?? []).join(", ") },
                        { key: "oos", header: "Out of sync", value: (r: any) => (r["out-of-sync"] ?? []).join(", ") },
                      ]}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      }}
    </Async>
  );
}
