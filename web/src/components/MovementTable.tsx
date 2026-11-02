import { useState } from "preact/hooks";
import { ResultDialog } from "./Dialog";
import { JsonView } from "./Results";
import { Table } from "./Table";

const list = (v: unknown): number[] => (Array.isArray(v) ? v : []);
const tpOf = (m: any) => m?.proposal?.topicPartition ?? m?.topicPartition ?? {};

// Replicas that left or joined the set are named in text for screen readers, not only coloured.
const replicas = (ids: number[], others: number[], mark: "removed" | "added") =>
  ids.map((r, i) => (
    <span key={i}>
      {i > 0 && ", "}
      {others.includes(r) ? (
        r
      ) : (
        <span class={`badge ${mark === "added" ? "ok" : "bad"}`}>
          {r}
          <span class="sr-only"> {mark}</span>
        </span>
      )}
    </span>
  ));

const reassignment = (rows: { topic: string; partition: unknown; next: number[] }[]) =>
  JSON.stringify({ version: 1, partitions: rows.map((r) => ({ topic: r.topic, partition: r.partition, replicas: r.next })) }, null, 2);

/** Opens the reassignment file for `kafka-reassign-partitions.sh --reassignment-json-file`. */
function ReassignmentButton({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = "reassignment.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Create reassignment.json
      </button>
      {open && (
        <ResultDialog title="reassignment.json" onClose={() => setOpen(false)}>
          <div class="actions">
            <button type="button" onClick={() => navigator.clipboard?.writeText(text)}>
              Copy
            </button>
            <button type="button" onClick={download}>
              Download
            </button>
          </div>
          <JsonView data={text} />
        </ResultDialog>
      )}
    </>
  );
}

/** Inter-broker movements: CC `proposals` entries, `{topicPartition, oldReplicas, newReplicas}`. */
export function MovementTable({ title, movements }: { title: string; movements: any[] }) {
  const rows = movements.map((m) => ({ topic: String(tpOf(m).topic ?? ""), partition: tpOf(m).partition, old: list(m?.oldReplicas), next: list(m?.newReplicas) }));
  return (
    <Table
      caption={`${title} (${rows.length})`}
      rows={rows}
      pageable
      toolbar={(shown) => <ReassignmentButton text={reassignment(shown)} />}
      columns={[
        { key: "topic", header: "Topic", value: (r) => r.topic },
        { key: "partition", header: "Partition", value: (r) => r.partition ?? "", numeric: true },
        { key: "old", header: "Old replicas", value: (r) => r.old.join(", "), render: (r) => replicas(r.old, r.next, "removed") },
        { key: "next", header: "New replicas", value: (r) => r.next.join(", "), render: (r) => replicas(r.next, r.old, "added") },
      ]}
    />
  );
}

/** Intra-broker movements (Executor lists): `{brokerId, proposal: {topicPartition}}`. */
export function IntraMovementTable({ title, movements }: { title: string; movements: any[] }) {
  const rows = movements.map((m) => ({ topic: String(tpOf(m).topic ?? ""), partition: tpOf(m).partition, broker: m?.brokerId }));
  return (
    <Table
      caption={`${title} (${rows.length})`}
      rows={rows}
      filterable={false}
      columns={[
        { key: "topic", header: "Topic", value: (r) => r.topic },
        { key: "partition", header: "Partition", value: (r) => r.partition ?? "", numeric: true },
        { key: "broker", header: "Broker", value: (r) => r.broker ?? "", numeric: true },
      ]}
    />
  );
}
