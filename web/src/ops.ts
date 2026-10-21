import type { Params } from "./api";

export type FieldKind = "text" | "number" | "bool" | "goals" | "select" | "logdirs";

export interface Field {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  /** A checked box sends false (for parameters whose Cruise Control default is true). */
  invert?: boolean;
  options?: { value: string; label: string }[];
}

export interface Operation {
  id: string;
  title: string;
  endpoint: string;
  description: string;
  /** Has a dry-run mode: Simulate sends dryrun=true, Execute sends dryrun=false. */
  dryRunnable: boolean;
  /** Ask for confirmation before a real execution. */
  confirm: boolean;
  fixed?: Params;
  /** Sends verbose=true so the result carries the proposals and the load before and after. */
  verbose?: boolean;
  fields: Field[];
}

const goals: Field = { name: "goals", label: "Goals", kind: "goals", help: "Leave empty to use Cruise Control's default goals." };
const tuning: Field[] = [
  { name: "concurrent_partition_movements_per_broker", label: "Concurrent partition movements per broker", kind: "number" },
  { name: "concurrent_leader_movements", label: "Concurrent leader movements", kind: "number" },
  { name: "skip_hard_goal_check", label: "Skip hard goal check", kind: "bool" },
  { name: "excluded_topics", label: "Excluded topics (regex)", kind: "text" },
  { name: "replication_throttle", label: "Replication throttle (bytes/s)", kind: "number" },
  { name: "stop_ongoing_execution", label: "Stop the ongoing execution first", kind: "bool" },
  { name: "reason", label: "Reason", kind: "text" },
];
const capacity: Field = { name: "allow_capacity_estimation", label: "Disallow capacity estimation", kind: "bool", invert: true };
const readyGoals: Field = { name: "use_ready_default_goals", label: "Use ready default goals", kind: "bool" };
const dataFrom: Field = {
  name: "data_from",
  label: "Data from",
  kind: "select",
  options: [
    { value: "", label: "Cruise Control default" },
    { value: "valid_windows", label: "Valid windows" },
    { value: "valid_partitions", label: "Valid partitions" },
  ],
};
const assigner: Field = { name: "kafka_assigner", label: "Kafka assigner mode", kind: "bool" };
const destinations: Field = { name: "destination_broker_ids", label: "Destination broker IDs", kind: "text", help: "Comma separated, for example 1,2" };
const brokers = (help: string): Field => ({ name: "brokerid", label: "Broker IDs", kind: "text", required: true, help });

export const OPERATIONS: Operation[] = [
  { id: "rebalance", title: "Rebalance", endpoint: "rebalance", description: "Move replicas and leaders to balance the cluster.", dryRunnable: true, confirm: true, verbose: true, fields: [goals, ...tuning, capacity, readyGoals, dataFrom, assigner, destinations] },
  {
    id: "leader_election",
    title: "Preferred leader election",
    endpoint: "rebalance",
    description: "Move leadership back to the preferred replicas without moving data.",
    dryRunnable: true,
    confirm: true,
    verbose: true,
    fixed: { goals: "PreferredLeaderElectionGoal" },
    fields: [tuning[1], tuning[3], tuning[6]],
  },
  {
    id: "rebalance_disk",
    title: "Rebalance disks",
    endpoint: "rebalance",
    description: "Move replicas between the disks of each broker, not between brokers.",
    dryRunnable: true,
    confirm: true,
    verbose: true,
    fixed: { rebalance_disk: true },
    fields: [tuning[6]],
  },
  {
    id: "add_broker",
    title: "Add broker",
    endpoint: "add_broker",
    description: "Move load onto newly added brokers.",
    dryRunnable: true,
    confirm: true,
    verbose: true,
    fields: [brokers("Comma separated, for example 3,4"), { name: "throttle_added_broker", label: "Throttle added broker", kind: "bool" }, goals, ...tuning, capacity, readyGoals, dataFrom, assigner],
  },
  {
    id: "remove_broker",
    title: "Remove broker",
    endpoint: "remove_broker",
    description: "Move everything off the brokers so they can be shut down.",
    dryRunnable: true,
    confirm: true,
    verbose: true,
    fields: [brokers("Comma separated, for example 3"), { name: "throttle_removed_broker", label: "Throttle removed broker", kind: "bool" }, goals, ...tuning, capacity, readyGoals, dataFrom, assigner, destinations],
  },
  {
    id: "demote_broker",
    title: "Demote broker",
    endpoint: "demote_broker",
    description: "Move leadership away from the brokers.",
    dryRunnable: true,
    confirm: true,
    verbose: true,
    fields: [
      brokers("Comma separated, for example 3"),
      { name: "skip_urp_demotion", label: "Skip under-replicated partitions", kind: "bool" },
      { name: "exclude_follower_demotion", label: "Exclude follower demotion", kind: "bool" },
      tuning[1],
      tuning[4],
      capacity,
      tuning[6],
    ],
  },
  { id: "fix_offline_replicas", title: "Fix offline replicas", endpoint: "fix_offline_replicas", description: "Move replicas off dead disks and brokers.", dryRunnable: true, confirm: true, verbose: true, fields: [goals, ...tuning, capacity, readyGoals, dataFrom] },
  {
    id: "topic_configuration",
    title: "Topic replication factor",
    endpoint: "topic_configuration",
    description: "Change the replication factor of topics.",
    dryRunnable: true,
    confirm: true,
    verbose: true,
    fields: [
      { name: "topic", label: "Topic (regex)", kind: "text", required: true },
      { name: "replication_factor", label: "Replication factor", kind: "number", required: true },
      goals,
      tuning[0],
      tuning[1],
      tuning[2],
      tuning[4],
      capacity,
      readyGoals,
      dataFrom,
      { name: "skip_rack_awareness_check", label: "Skip rack awareness check", kind: "bool" },
      tuning[6],
    ],
  },
  {
    id: "remove_disks",
    title: "Remove disks",
    endpoint: "remove_disks",
    description: "Move replicas off the chosen log dirs so the disks can be removed.",
    dryRunnable: true,
    confirm: true,
    fields: [{ name: "brokerid_and_logdirs", label: "Log dirs to empty", kind: "logdirs", required: true }, tuning[5], tuning[6]],
  },
  {
    id: "admin",
    title: "Self-healing and concurrency",
    endpoint: "admin",
    description: "Enable or disable self-healing and change execution concurrency.",
    dryRunnable: false,
    confirm: false,
    fields: [
      { name: "enable_self_healing_for", label: "Enable self-healing for", kind: "text", help: "Anomaly types, for example BROKER_FAILURE,GOAL_VIOLATION" },
      { name: "disable_self_healing_for", label: "Disable self-healing for", kind: "text" },
      { name: "concurrent_partition_movements_per_broker", label: "Concurrent partition movements per broker", kind: "number" },
      { name: "concurrent_leader_movements", label: "Concurrent leader movements", kind: "number" },
      { name: "max_partition_movements_in_cluster", label: "Max partition movements in cluster", kind: "number" },
      { name: "concurrent_intra_broker_partition_movements", label: "Concurrent intra-broker partition movements", kind: "number" },
      { name: "execution_progress_check_interval_ms", label: "Execution progress check interval (ms)", kind: "number" },
      { name: "reason", label: "Reason", kind: "text" },
    ],
  },
  { id: "pause_sampling", title: "Pause sampling", endpoint: "pause_sampling", description: "Stop collecting load metrics.", dryRunnable: false, confirm: false, fields: [{ name: "reason", label: "Reason", kind: "text" }] },
  { id: "resume_sampling", title: "Resume sampling", endpoint: "resume_sampling", description: "Start collecting load metrics again.", dryRunnable: false, confirm: false, fields: [{ name: "reason", label: "Reason", kind: "text" }] },
  {
    id: "stop_execution",
    title: "Stop execution",
    endpoint: "stop_proposal_execution",
    description: "Stop the proposal that is executing now.",
    dryRunnable: false,
    confirm: false,
    fields: [{ name: "force_stop", label: "Force stop", kind: "bool" }],
  },
];

export type Values = Record<string, string | boolean>;

/** Query parameters for a form. Empty fields are left out; dryrun is always explicit for operations that have it. */
export function buildParams(op: Operation, values: Values, dryrun?: boolean): Params {
  const p: Params = { ...op.fixed };
  if (op.verbose) p.verbose = true;
  for (const f of op.fields) {
    const v = values[f.name];
    if (f.kind === "bool") {
      if (v === true) p[f.name] = !f.invert;
    } else if (typeof v === "string" && v.trim() !== "") {
      p[f.name] = v.trim();
    }
  }
  if (op.dryRunnable) {
    if (dryrun === undefined) throw new Error("dryrun must be explicit");
    p.dryrun = dryrun;
  }
  return p;
}

/** Splits "REBALANCE?dryrun=false&goals=X" or "rebalance(dryrun=false)" style review entries into endpoint and params. */
export function parseEndpointWithParams(s: string): { endpoint: string; params: Params } {
  const m = /^\s*\/?([A-Za-z_]+)\s*[?(]?(.*?)\)?\s*$/.exec(s) ?? [];
  const params: Params = {};
  new URLSearchParams(m[2] ?? "").forEach((v, k) => {
    if (k !== "review_id" && k !== "json") params[k] = v;
  });
  return { endpoint: (m[1] ?? "").toLowerCase(), params };
}
