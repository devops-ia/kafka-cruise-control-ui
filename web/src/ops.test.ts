import { buildParams, OPERATIONS, parseEndpointWithParams } from "./ops";

const op = (id: string) => OPERATIONS.find((o) => o.id === id)!;

describe("operation parameters", () => {
  it("applies the throttle on remove_broker", () => {
    const p = buildParams(op("remove_broker"), { brokerid: "3", throttle_removed_broker: true }, false);
    expect(p).toEqual({ brokerid: "3", throttle_removed_broker: true, verbose: true, dryrun: false });
  });
  it("leaves empty fields and unchecked boxes out", () => {
    const p = buildParams(op("rebalance"), { goals: "", skip_hard_goal_check: false, reason: "  " }, true);
    expect(p).toEqual({ verbose: true, dryrun: true });
  });
  it("always sends dryrun explicitly and refuses to guess", () => {
    expect(() => buildParams(op("rebalance"), {})).toThrow();
    expect(buildParams(op("rebalance"), {}, false).dryrun).toBe(false);
  });
  it("has no dryrun on operations that do not support it", () => {
    expect("dryrun" in buildParams(op("pause_sampling"), { reason: "maintenance" })).toBe(false);
  });
  it("maps preferred leader election onto rebalance with its goal", () => {
    const o = op("leader_election");
    expect(o.endpoint).toBe("rebalance");
    expect(buildParams(o, {}, true)).toEqual({ goals: "PreferredLeaderElectionGoal", verbose: true, dryrun: true });
  });
  it("does not offer throttle_removed_broker on add_broker", () => {
    expect(op("add_broker").fields.some((f) => f.name === "throttle_removed_broker")).toBe(false);
  });
  it("reads endpoint and params from a review entry", () => {
    expect(parseEndpointWithParams("REBALANCE?dryrun=false&goals=RackAwareGoal")).toEqual({ endpoint: "rebalance", params: { dryrun: "false", goals: "RackAwareGoal" } });
    expect(parseEndpointWithParams("remove_broker(brokerid=3&review_id=7)").params).toEqual({ brokerid: "3" });
  });

  it("sends the common rebalance options", () => {
    const p = buildParams(op("rebalance"), { destination_broker_ids: "1,2", data_from: "valid_windows", kafka_assigner: true, use_ready_default_goals: true }, true);
    expect(p).toEqual({ destination_broker_ids: "1,2", data_from: "valid_windows", kafka_assigner: true, use_ready_default_goals: true, verbose: true, dryrun: true });
  });
  it("Disallow capacity estimation sends false, and nothing when unchecked", () => {
    expect(buildParams(op("add_broker"), { brokerid: "3", allow_capacity_estimation: true }, true).allow_capacity_estimation).toBe(false);
    expect("allow_capacity_estimation" in buildParams(op("add_broker"), { brokerid: "3", allow_capacity_estimation: false }, true)).toBe(false);
  });
  it("offers each option only where Cruise Control accepts it", () => {
    const has = (id: string, name: string) => op(id).fields.some((f) => f.name === name);
    expect(has("fix_offline_replicas", "kafka_assigner")).toBe(false);
    expect(has("topic_configuration", "kafka_assigner")).toBe(false);
    expect(has("add_broker", "kafka_assigner")).toBe(true);
    expect(has("add_broker", "destination_broker_ids")).toBe(false);
    expect(has("remove_broker", "destination_broker_ids")).toBe(true);
    expect(OPERATIONS.filter((o) => has(o.id, "skip_rack_awareness_check")).map((o) => o.id)).toEqual(["topic_configuration"]);
    for (const n of ["skip_hard_goal_check", "concurrent_partition_movements_per_broker", "concurrent_leader_movements", "replication_throttle"]) expect(has("topic_configuration", n)).toBe(true);
    for (const id of ["rebalance", "add_broker", "remove_broker", "fix_offline_replicas", "topic_configuration"]) {
      for (const n of ["allow_capacity_estimation", "use_ready_default_goals", "data_from"]) expect(has(id, n)).toBe(true);
    }
  });
  it("data_from is a select with the Cruise Control default first", () => {
    const f = op("rebalance").fields.find((x) => x.name === "data_from")!;
    expect(f.kind).toBe("select");
    expect(f.options!.map((o) => o.value)).toEqual(["", "valid_windows", "valid_partitions"]);
  });
  it("demote and admin get the fields the old UI showed", () => {
    const names = (id: string) => op(id).fields.map((f) => f.name);
    expect(names("demote_broker")).toEqual(expect.arrayContaining(["replication_throttle", "allow_capacity_estimation"]));
    expect(names("admin")).toEqual(expect.arrayContaining(["max_partition_movements_in_cluster", "concurrent_intra_broker_partition_movements", "execution_progress_check_interval_ms"]));
  });
  it("no operation has replication_logdir_throttle", () => {
    expect(OPERATIONS.some((o) => o.fields.some((f) => f.name === "replication_logdir_throttle"))).toBe(false);
  });
  it("rebalance_disk calls rebalance with rebalance_disk=true and no goals", () => {
    const o = op("rebalance_disk");
    expect(o.endpoint).toBe("rebalance");
    expect(o.fields.some((f) => f.name === "goals")).toBe(false);
    expect(buildParams(o, {}, true)).toEqual({ rebalance_disk: true, verbose: true, dryrun: true });
  });
});

describe("verbose", () => {
  it("is sent by operations with proposals and by no other", () => {
    const withIt = ["rebalance", "leader_election", "rebalance_disk", "add_broker", "remove_broker", "demote_broker", "fix_offline_replicas", "topic_configuration"];
    for (const o of OPERATIONS) {
      const p = buildParams(o, { brokerid: "1", topic: "t", replication_factor: "2" }, o.dryRunnable ? true : undefined);
      expect("verbose" in p, o.id).toBe(withIt.includes(o.id));
    }
  });

  it("remove_disks sends brokerid_and_logdirs, an explicit dryrun and no verbose", () => {
    const o = OPERATIONS.find((x) => x.id === "remove_disks")!;
    expect(buildParams(o, { brokerid_and_logdirs: "0-/data/b,1-/data/a" }, true)).toEqual({ brokerid_and_logdirs: "0-/data/b,1-/data/a", dryrun: true });
    expect(() => buildParams(o, { brokerid_and_logdirs: "0-/data/b" })).toThrow("dryrun must be explicit");
  });
});
