import { useState } from "preact/hooks";
import { Async } from "../components/Async";
import { Table } from "../components/Table";
import { formatMB, formatPct, formatRate } from "../format";
import { useResource } from "../hooks";


export function PartitionLoad() {
  const [resource, setResource] = useState("disk");
  const [entries, setEntries] = useState(100);
  const [draft, setDraft] = useState("");
  const [topic, setTopic] = useState("");
  const res = useResource("partition_load", { resource, entries, topic: topic || undefined });
  const commit = () => setTopic(draft.trim());
  const controls = (
    <form class="inline-form" onSubmit={(e) => e.preventDefault()}>
      <label>
        Sort by
        <select value={resource} onChange={(e) => setResource((e.target as HTMLSelectElement).value)}>
          {["cpu", "networkInbound", "networkOutbound", "disk"].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        Rows
        <input type="number" min={1} max={5000} value={entries} onChange={(e) => setEntries(Math.max(1, Number((e.target as HTMLInputElement).value) || 100))} />
      </label>
      <label>
        Topic (regex)
        <input type="text" value={draft} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && commit()} onBlur={commit} />
      </label>
    </form>
  );
  return (
    <Async title="Partition load" res={res} controls={controls} empty={(d) => !d.records?.length}>
      {(d) => (
        <div class="stack">
          <Table
            caption="Partition load"
            rows={d.records}
            rowKey={(r, i) => `${r.topic}-${r.partition}-${i}`}
            columns={[
              { key: "topic", header: "Topic", value: (r: any) => r.topic },
              { key: "partition", header: "Partition", value: (r: any) => r.partition, numeric: true },
              { key: "leader", header: "Leader", value: (r: any) => r.leader, numeric: true },
              { key: "followers", header: "Followers", value: (r: any) => (r.followers ?? []).join(", ") },
              { key: "cpu", header: "CPU", value: (r: any) => r.cpu, render: (r: any) => formatPct(r.cpu), numeric: true },
              { key: "in", header: "Net in", value: (r: any) => r.networkInbound, render: (r: any) => formatRate(r.networkInbound), numeric: true },
              { key: "out", header: "Net out", value: (r: any) => r.networkOutbound, render: (r: any) => formatRate(r.networkOutbound), numeric: true },
              { key: "disk", header: "Disk", value: (r: any) => r.disk, render: (r: any) => formatMB(r.disk), numeric: true },
            ]}
          />
        </div>
      )}
    </Async>
  );
}
