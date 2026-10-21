import { useState } from "preact/hooks";
import { Async } from "../components/Async";
import { Tabs } from "../components/KeyValues";
import { Meter } from "../components/Meter";
import { Table, type Column } from "../components/Table";
import { formatMB, formatPct, formatRate } from "../format";
import { useResource } from "../hooks";


const num = (v: unknown) => (typeof v === "number" ? v : 0);

function cols(kind: "broker" | "host"): Column<any>[] {
  const lead: Column<any>[] =
    kind === "broker"
      ? [
          { key: "Broker", header: "Broker", value: (r) => r.Broker, numeric: true },
          { key: "Host", header: "Host", value: (r) => r.Host },
          { key: "Rack", header: "Rack", value: (r) => r.Rack ?? "" },
          { key: "BrokerState", header: "State", value: (r) => r.BrokerState ?? "" },
        ]
      : [
          { key: "Host", header: "Host", value: (r) => r.Host },
          { key: "Rack", header: "Rack", value: (r) => r.Rack ?? "" },
        ];
  return [
    ...lead,
    { key: "CpuPct", header: "CPU", value: (r) => num(r.CpuPct), render: (r) => <Meter value={num(r.CpuPct)} label={`CPU ${r.Host}`} />, numeric: true },
    { key: "DiskPct", header: "Disk %", value: (r) => num(r.DiskPct), render: (r) => <Meter value={num(r.DiskPct)} label={`Disk ${r.Host}`} />, numeric: true },
    { key: "DiskMB", header: "Disk used", value: (r) => num(r.DiskMB), render: (r) => formatMB(num(r.DiskMB)), numeric: true },
    { key: "LeaderNwInRate", header: "Leader net in", value: (r) => num(r.LeaderNwInRate), render: (r) => formatRate(num(r.LeaderNwInRate)), numeric: true },
    { key: "FollowerNwInRate", header: "Follower net in", value: (r) => num(r.FollowerNwInRate), render: (r) => formatRate(num(r.FollowerNwInRate)), numeric: true },
    { key: "NwOutRate", header: "Net out", value: (r) => num(r.NwOutRate), render: (r) => formatRate(num(r.NwOutRate)), numeric: true },
    { key: "Replicas", header: "Replicas", value: (r) => num(r.Replicas), numeric: true },
    { key: "Leaders", header: "Leaders", value: (r) => num(r.Leaders), numeric: true },
  ];
}

const diskRows = (brokers: any[] = []) =>
  brokers.flatMap((b) => Object.entries(b.DiskState ?? {}).map(([dir, s]: [string, any]) => ({ broker: b.Broker, dir, ...s })));

export function Load() {
  const [view, setView] = useState<"broker" | "host">("broker");
  const [disks, setDisks] = useState(false);
  const [estimate, setEstimate] = useState(true);
  const res = useResource("load", { populate_disk_info: disks || undefined, allow_capacity_estimation: estimate ? undefined : false });
  const controls = (
    <form class="inline-form" onSubmit={(e) => e.preventDefault()}>
      <label>
        <input type="checkbox" checked={disks} onChange={(e) => setDisks((e.target as HTMLInputElement).checked)} /> Populate disk info
      </label>
      <label>
        <input type="checkbox" checked={estimate} onChange={(e) => setEstimate((e.target as HTMLInputElement).checked)} /> Allow capacity estimation
      </label>
    </form>
  );
  return (
    <Async title="Load" res={res} controls={controls} empty={(d) => !d.brokers?.length && !d.hosts?.length}>
      {(d) => (
        <div class="stack">
          <Tabs label="Group by" value={view} onChange={setView} options={[["broker", "By broker"], ["host", "By host"]]} />
          {view === "broker" ? (
            <Table caption="Load by broker" columns={cols("broker")} rows={d.brokers ?? []} rowKey={(r) => r.Broker} />
          ) : (
            <Table caption="Load by host" columns={cols("host")} rows={d.hosts ?? []} rowKey={(r) => r.Host} />
          )}
          {diskRows(d.brokers).length > 0 && (
            <Table
              caption="Load by disk"
              rows={diskRows(d.brokers)}
              rowKey={(r) => `${r.broker}-${r.dir}`}
              columns={[
                { key: "broker", header: "Broker", value: (r) => r.broker, numeric: true },
                { key: "dir", header: "Log dir", value: (r) => r.dir },
                { key: "NumReplicas", header: "Replicas", value: (r) => num(r.NumReplicas), numeric: true },
                { key: "NumLeaderReplicas", header: "Leaders", value: (r) => num(r.NumLeaderReplicas), numeric: true },
                { key: "DiskMB", header: "Disk used", value: (r) => num(r.DiskMB), render: (r) => formatMB(num(r.DiskMB)), numeric: true },
                { key: "DiskPct", header: "Disk %", value: (r) => (typeof r.DiskPct === "number" ? r.DiskPct : String(r.DiskPct ?? "")), render: (r) => (typeof r.DiskPct === "number" ? formatPct(r.DiskPct) : String(r.DiskPct ?? "")), numeric: true },
              ]}
            />
          )}
        </div>
      )}
    </Async>
  );
}
