import { useState } from "preact/hooks";
import { Async } from "../components/Async";
import { Tabs } from "../components/KeyValues";
import { Meter } from "../components/Meter";
import { Table, type Column } from "../components/Table";
import { formatMB, formatRate } from "../format";
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

export function Load() {
  const [view, setView] = useState<"broker" | "host">("broker");
  const res = useResource("load");
  return (
    <Async title="Load" res={res} empty={(d) => !d.brokers?.length && !d.hosts?.length}>
      {(d) => (
        <div class="stack">
          <Tabs label="Group by" value={view} onChange={setView} options={[["broker", "By broker"], ["host", "By host"]]} />
          {view === "broker" ? (
            <Table caption="Load by broker" columns={cols("broker")} rows={d.brokers ?? []} rowKey={(r) => r.Broker} />
          ) : (
            <Table caption="Load by host" columns={cols("host")} rows={d.hosts ?? []} rowKey={(r) => r.Host} />
          )}
        </div>
      )}
    </Async>
  );
}
