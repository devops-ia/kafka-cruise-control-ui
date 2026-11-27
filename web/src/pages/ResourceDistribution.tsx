import { useState } from "preact/hooks";
import { Async } from "../components/Async";
import { Tabs } from "../components/KeyValues";
import { Table } from "../components/Table";
import { useResource } from "../hooks";

type Metric = "Leaders" | "Replicas" | "Leader CPU";
const METRICS: [Metric, string][] = [["Leaders", "Leaders"], ["Replicas", "Replicas"], ["Leader CPU", "Leader CPU"]];

// CC does not say when it truncates, so one extra record is requested: receiving it proves there were more.
const LIMIT = 5000;

interface Row {
  topic: string;
  cells: Map<number, number>;
  total: number;
}

/** One row per topic with the metric per broker id, largest total first. */
function matrix(records: any[], metric: Metric): Row[] {
  const rows = new Map<string, Row>();
  for (const r of records) {
    const row: Row = rows.get(r.topic) ?? { topic: r.topic, cells: new Map(), total: 0 };
    rows.set(r.topic, row);
    // CC computes a record's cpu from the leader's load only.
    const amount = metric === "Leader CPU" ? r.cpu : 1;
    for (const id of metric === "Replicas" ? [r.leader, ...(r.followers ?? [])] : [r.leader]) {
      row.cells.set(id, (row.cells.get(id) ?? 0) + amount);
      row.total += amount;
    }
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.topic.localeCompare(b.topic));
}

function format(v: number, metric: Metric): string {
  if (metric !== "Leader CPU") return String(v);
  const n = Math.round(v * 1000) / 1000;
  return v > 0 && n === 0 ? "<0.001%" : `${n}%`;
}

export function ResourceDistribution() {
  const [metric, setMetric] = useState<Metric>("Leaders");
  const [draft, setDraft] = useState("");
  const [topic, setTopic] = useState("");
  const load = useResource("partition_load", { resource: "cpu", entries: LIMIT + 1, topic: topic || undefined });
  // Only for the columns: a broker without partitions in the records still needs one.
  const state = useResource("kafka_cluster_state");
  const commit = () => setTopic(draft.trim());
  const reload = () => {
    load.reload();
    state.reload();
  };
  const controls = (
    <form class="inline-form" onSubmit={(e) => e.preventDefault()}>
      <label>
        Topic (regex)
        <input type="text" value={draft} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && commit()} onBlur={commit} />
      </label>
    </form>
  );
  return (
    <Async title="Resource distribution" res={{ ...load, reload }} controls={controls} empty={(d) => !d.records?.length}>
      {(d) => {
        const records: any[] = d.records.slice(0, LIMIT);
        const rows = matrix(records, metric);
        // A failed refresh keeps the old data; drop it so a departed broker is not drawn as an empty one.
        const listed = Object.keys((!state.error && state.data?.KafkaBrokerState?.ReplicaCountByBrokerId) || {}).map(Number);
        const brokers = [...new Set([...listed, ...records.flatMap((r) => [r.leader, ...(r.followers ?? [])])])].sort((a, b) => a - b);
        // One maximum for the whole matrix, over every page, so topics compare with each other.
        const max = rows.reduce((m, row) => Math.max(m, ...row.cells.values()), 0);
        const title = metric === "Leader CPU" ? "Leader CPU (excludes followers)" : metric;
        return (
          <div class="stack">
            <Tabs label="Metric" value={metric} onChange={setMetric} options={METRICS} />
            {d.records.length > LIMIT && (
              <p class="banner">
                Partial result: only the {LIMIT} partitions with the highest leader CPU are included. Values may be low and topics may be missing. Narrow the list with Topic (regex).
              </p>
            )}
            {state.error && <p class="banner">Broker list unavailable: brokers without partitions in these records are not shown.</p>}
            <div class="muted">
              <div>Based on {records.length} partition records</div>
              <div>Offline partitions are not included, and the Cruise Control load model may not cover every partition, so counts can differ from Cluster state.</div>
            </div>
            {metric === "Leader CPU" && <p class="banner">Leader CPU only: excludes follower CPU. This is not the total CPU of a broker or topic.</p>}
            <Table
              caption={`${title} by topic and broker`}
              rows={rows}
              rowKey={(r) => r.topic}
              pageable
              columns={[
                { key: "topic", header: "Topic", value: (r: Row) => r.topic },
                ...brokers.map((id) => ({
                  key: `broker-${id}`,
                  header: `Broker ${id}`,
                  value: (r: Row) => r.cells.get(id) ?? 0,
                  // A class per level, not a style attribute: the CSP is style-src 'self'.
                  render: (r: Row) => {
                    const v = r.cells.get(id) ?? 0;
                    return <span class={`heat heat-${v > 0 ? Math.ceil((4 * v) / max) : 0}`}>{format(v, metric)}</span>;
                  },
                  numeric: true,
                })),
              ]}
            />
          </div>
        );
      }}
    </Async>
  );
}
