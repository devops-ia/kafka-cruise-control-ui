import { useState } from "preact/hooks";
import { formatMB, formatPct, formatRate } from "../format";
import { Host } from "../pages/Load";
import { Tabs } from "./KeyValues";
import { Table, type Column } from "./Table";

const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Value after, stacked under the value before and over a signed percentage change when there is a non-zero previous number. */
function Diff({ before, after, fmt }: { before: unknown; after: unknown; fmt: (v: number) => string }) {
  const a = n(after);
  if (a === undefined) return <>{after === undefined || after === null ? "" : String(after)}</>; // e.g. DEAD
  const b = n(before);
  if (b === undefined || b === 0) return <>{fmt(a)}</>;
  const pct = ((a - b) / b) * 100;
  return (
    <>
      <div>{fmt(b)}</div>
      <div>{fmt(a)}</div>
      <div class={pct > 0 ? "up" : pct < 0 ? "down" : "muted"}>{`${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}</div>
    </>
  );
}

const METRICS: [string, string, (v: number) => string][] = [
  ["Replicas", "Replicas", String],
  ["Leaders", "Leaders", String],
  ["CpuPct", "CPU", formatPct],
  ["DiskMB", "Disk used", formatMB],
  ["LeaderNwInRate", "Leader net in", formatRate],
  ["FollowerNwInRate", "Follower net in", formatRate],
  ["NwOutRate", "Net out", formatRate],
];

const metricCols = (before: (r: any) => any): Column<any>[] =>
  METRICS.map(([key, header, fmt]) => ({
    key,
    header,
    numeric: true,
    value: (r) => n(r.after[key]) ?? "",
    render: (r) => <Diff before={before(r)?.[key]} after={r.after[key]} fmt={fmt} />,
  }));

const list = (v: any): any[] => (Array.isArray(v) ? v : []);

/** Load before and after an optimization, by broker or host, plus one row per disk when brokers carry DiskState. */
export function LoadDiff({ before, after }: { before: any; after: any }) {
  const [view, setView] = useState<"broker" | "host">("broker");
  const old = (items: any, key: string) => new Map(list(items).map((b) => [b?.[key], b]));
  const oldBrokers = old(before?.brokers, "Broker");
  const oldHosts = old(before?.hosts, "Host");
  const brokers = list(after?.brokers).map((after) => ({ after }));
  const hosts = list(after?.hosts).map((after) => ({ after }));
  const disks = list(after?.brokers).flatMap((b) =>
    Object.entries(b?.DiskState ?? {}).map(([dir, after]) => ({ broker: b.Broker, dir, after: after as any, before: (oldBrokers.get(b.Broker)?.DiskState ?? {})[dir] })),
  );
  const diskMetrics: [string, string, (v: number) => string][] = [["NumReplicas", "Replicas", String], ["NumLeaderReplicas", "Leaders", String], ["DiskMB", "Disk used", formatMB], ["DiskPct", "Disk %", formatPct]];
  return (
    <div class="stack">
      <details>
        <summary>Load before and after</summary>
        <Tabs label="Load group by" value={view} onChange={setView} options={[["broker", "By broker"], ["host", "By host"]]} />
        {view === "broker" ? (
          <Table
            caption="Load before and after by broker"
            rows={brokers}
            rowKey={(r) => r.after.Broker}
            filterable={false}
            pageable
            columns={[
              { key: "Broker", header: "Broker", value: (r) => r.after.Broker ?? "", numeric: true },
              { key: "Host", header: "Host", value: (r) => String(r.after.Host ?? ""), render: (r) => <Host name={String(r.after.Host ?? "")} /> },
              { key: "BrokerState", header: "State", value: (r) => String(r.after.BrokerState ?? "") },
              ...metricCols((r) => oldBrokers.get(r.after.Broker)),
            ]}
          />
        ) : (
          <Table
            caption="Load before and after by host"
            rows={hosts}
            rowKey={(r) => r.after.Host}
            filterable={false}
            pageable
            columns={[{ key: "Host", header: "Host", value: (r) => String(r.after.Host ?? ""), render: (r) => <Host name={String(r.after.Host ?? "")} /> }, ...metricCols((r) => oldHosts.get(r.after.Host))]}
          />
        )}
      </details>
      {disks.length > 0 && (
        <details>
          <summary>Load by disk ({disks.length})</summary>
          <Table
            caption="Load by disk"
            rows={disks}
            rowKey={(r) => `${r.broker}-${r.dir}`}
            filterable={false}
            pageable
            columns={[
              { key: "broker", header: "Broker", value: (r) => r.broker ?? "", numeric: true },
              { key: "dir", header: "Log dir", value: (r) => r.dir },
              ...diskMetrics.map(([key, header, fmt]): Column<any> => ({ key, header, numeric: true, value: (r) => r.after[key] ?? "", render: (r) => <Diff before={r.before?.[key]} after={r.after[key]} fmt={fmt} /> })),
            ]}
          />
        </details>
      )}
    </div>
  );
}
