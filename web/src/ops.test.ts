import { buildParams, OPERATIONS, parseEndpointWithParams } from "./ops";

const op = (id: string) => OPERATIONS.find((o) => o.id === id)!;

describe("operation parameters", () => {
  it("applies the throttle on remove_broker", () => {
    const p = buildParams(op("remove_broker"), { brokerid: "3", throttle_removed_broker: true }, false);
    expect(p).toEqual({ brokerid: "3", throttle_removed_broker: true, dryrun: false });
  });
  it("leaves empty fields and unchecked boxes out", () => {
    const p = buildParams(op("rebalance"), { goals: "", skip_hard_goal_check: false, reason: "  " }, true);
    expect(p).toEqual({ dryrun: true });
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
    expect(buildParams(o, {}, true)).toEqual({ goals: "PreferredLeaderElectionGoal", dryrun: true });
  });
  it("does not offer throttle_removed_broker on add_broker", () => {
    expect(op("add_broker").fields.some((f) => f.name === "throttle_removed_broker")).toBe(false);
  });
  it("reads endpoint and params from a review entry", () => {
    expect(parseEndpointWithParams("REBALANCE?dryrun=false&goals=RackAwareGoal")).toEqual({ endpoint: "rebalance", params: { dryrun: "false", goals: "RackAwareGoal" } });
    expect(parseEndpointWithParams("remove_broker(brokerid=3&review_id=7)").params).toEqual({ brokerid: "3" });
  });
});
