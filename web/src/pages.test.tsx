import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { ccState, clusterState, load, optimization, userTasks } from "./fixtures";
import { goalsFromState } from "./goals";
import { CCState } from "./pages/CCState";
import { ConfigInsights } from "./pages/ConfigInsights";
import { ClusterState } from "./pages/ClusterState";
import { Load } from "./pages/Load";
import { Proposals } from "./pages/Proposals";
import { Summary } from "./pages/Summary";
import { UserTasks } from "./pages/UserTasks";
import { clusters } from "./clusters";
import { session } from "./session";
import { setCluster } from "./store";
import { mockFetch, proxyPath } from "./testutil";

beforeEach(() => {
  localStorage.clear();
  setCluster("a");
  session.set({ authenticated: true, mode: "local", user: "ana", role: "viewer" });
  clusters.set([{ name: "a", group: "prod" }, { name: "b" }]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const serve = (routes: Record<string, unknown>) =>
  mockFetch((c) => {
    for (const [ep, body] of Object.entries(routes)) {
      if (c.path.endsWith(`/proxy/${ep}`)) return { body };
    }
  });

describe("read pages", () => {
  it("Load shows one row per broker with CPU, disk, network and replicas, and switches to hosts", async () => {
    const calls = serve({ load });
    render(<Load />);
    const row = await screen.findByRole("row", { name: /kafka-1/ });
    expect(calls[0].path).toBe(proxyPath("a", "load"));
    expect(calls[0].query.get("json")).toBeNull(); // the server adds json=true
    expect(within(row).getByText("5 GiB")).toBeTruthy(); // 5120 MB of disk
    expect(within(row).getByText("400 KiB/s")).toBeTruthy(); // outbound rate
    expect(within(row).getByText("75%")).toBeTruthy(); // CPU
    expect(within(row).getByText("91%")).toBeTruthy(); // disk %
    expect(within(row).getByText("80")).toBeTruthy(); // replicas
    expect(screen.getAllByRole("row", { name: /kafka-/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "By host" }));
    expect(screen.getByRole("region", { name: "Load by host" })).toBeTruthy();
  });

  it("Cluster state is one partition health table with the broker role as a tag", async () => {
    serve({ kafka_cluster_state: clusterState });
    render(<ClusterState />);
    const urp = await screen.findByRole("row", { name: /Under-replicated partitions 1 DEGRADED/ });
    expect(urp).toBeTruthy();
    expect(screen.getByText("orders")).toBeTruthy(); // the partition is listed under its row
    expect(screen.getByRole("row", { name: /Offline partitions 0 OK/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /^0 CONTROLLER/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Under-replicated partitions/ })).toBeNull();
  });

  it("Cluster state with four empty categories shows four OK rows and no lists", async () => {
    serve({ kafka_cluster_state: { ...clusterState, KafkaPartitionState: { offline: [], urp: [], "with-offline-replicas": [], "under-min-isr": [], other: [] } } });
    render(<ClusterState />);
    await screen.findByText("all clear");
    const health = screen.getByRole("region", { name: "Partition health" });
    expect(within(health).getAllByText("OK")).toHaveLength(4);
    expect(within(health).queryByText("DEGRADED")).toBeNull();
    expect(health.querySelector(".nested")).toBeNull();
  });

  it("Cluster state lists both under-replicated partitions in the alert row", async () => {
    const urp = [3, 4].map((partition) => ({ topic: "orders", partition, leader: 0, replicas: [0, 1], "in-sync": [0], "out-of-sync": [1] }));
    serve({ kafka_cluster_state: { ...clusterState, KafkaPartitionState: { ...clusterState.KafkaPartitionState, urp } } });
    render(<ClusterState />);
    await screen.findByText("2 issues");
    expect(screen.getByRole("row", { name: /Under-replicated partitions 2 DEGRADED/ })).toBeTruthy();
    expect(screen.getAllByText("orders")).toHaveLength(2);
  });

  it("Summary shows every cluster and marks an unreachable one without breaking the others", async () => {
    mockFetch((c) => {
      if (c.path.startsWith("/api/clusters/b/")) return { status: 502, body: { error: "cluster unavailable" } };
      return { body: c.path.endsWith("kafka_cluster_state") ? clusterState : ccState };
    });
    render(<Summary />);
    expect(await screen.findByText("unreachable")).toBeTruthy();
    expect(await screen.findByText("1 partitions at risk")).toBeTruthy();
    expect(screen.getByRole("button", { name: "a" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "b" })).toBeTruthy();
  });

  it("User tasks lists tasks", async () => {
    serve({ user_tasks: userTasks });
    render(<UserTasks />);
    expect(await screen.findByText("t-2")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("Proposals renders the optimization summary", async () => {
    serve({ proposals: optimization });
    render(<Proposals />);
    expect(await screen.findByText("Replica movements")).toBeTruthy();
    expect(screen.getByText("2 GiB")).toBeTruthy();
    expect(screen.getByText("VIOLATED")).toBeTruthy();
  });
});

describe("error and empty states", () => {
  it("shows an error with retry for a 502 and recovers", async () => {
    let n = 0;
    mockFetch(() => (++n === 1 ? { status: 502, body: { error: "cluster unavailable" } } : { body: load }));
    render(<Load />);
    expect(await screen.findByText("cluster unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("row", { name: /kafka-0/ })).toBeTruthy();
  });

  it("explains a 403 instead of offering retry", async () => {
    mockFetch(() => ({ status: 403, body: { error: "your role does not allow this operation" } }));
    render(<Load />);
    expect(await screen.findByText(/do not have permission/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows an empty state", async () => {
    serve({ user_tasks: { userTasks: [] } });
    render(<UserTasks />);
    expect(await screen.findByText("Nothing to show.")).toBeTruthy();
  });
});

describe("Config insights", () => {
  const permissions = (status: number, body: unknown) => mockFetch((c) => (c.path.endsWith("/proxy/permissions") ? { status, body } : undefined));

  it("shows a neutral note when the cluster has security disabled", async () => {
    permissions(400, { errorMessage: "Unable to retrieve privilege information for an unsecure connection." });
    render(<ConfigInsights />);
    expect(await screen.findByText(/Security is disabled on this cluster/)).toBeTruthy();
    expect(screen.queryByText(/Unable to retrieve/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([[502, "cluster unavailable"], [400, "bad request somewhere else"]])("a %i is an error with retry", async (status, msg) => {
    permissions(status, { error: msg });
    render(<ConfigInsights />);
    expect(await screen.findByText(msg)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/Security is disabled/)).toBeNull();
  });

  it("shows the roles on a 200", async () => {
    permissions(200, { version: 1, role: "ADMIN" });
    render(<ConfigInsights />);
    expect(await screen.findByText("ADMIN")).toBeTruthy();
  });
});

describe("CC state and goals", () => {
  it("reads goals from the analyzer state, grouped, including goals the old UI did not know", () => {
    const g = goalsFromState(ccState);
    expect(g.hard).toEqual(["DiskCapacityGoal", "RackAwareGoal"]);
    expect(g.soft).toEqual(["MyCustomGoal", "ReplicaDistributionGoal"]);
    expect(goalsFromState({})).toEqual({ hard: [], soft: [] });
  });

  const open = async (state: unknown, tab?: string) => {
    serve({ state });
    render(<CCState />);
    await screen.findByText("Executor", { selector: "dt" });
    if (tab) fireEvent.click(screen.getByRole("button", { name: tab }));
  };
  const bar = (name: string) => screen.getByRole("progressbar", { name }) as HTMLProgressElement;
  const running = { ...ccState, ExecutorState: { state: "INTER_BROKER_REPLICA_MOVEMENT_TASK_IN_PROGRESS", numTotalPartitionMovements: 10, numFinishedPartitionMovements: 3, numInProgressPartitionMovements: 2, numPendingPartitionMovements: 5, triggeredUserTaskId: "u-1", recentlyDemotedBrokers: [4] } };

  it("Executor in progress shows the movement bar at 30 % with a caption", async () => {
    await open(running);
    expect(bar("Partition movements").value).toBe(30);
    expect(screen.getByText("3 of 10 finished, 2 in progress, 5 pending")).toBeTruthy();
    expect(screen.getByText("u-1")).toBeTruthy();
  });

  it("Executor idle has no bar", async () => {
    await open(ccState);
    expect(screen.getByText("No execution in progress.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("Analyzer says READY or NOT READY in text, including goals the old UI did not know", async () => {
    await open(ccState, "Analyzer");
    expect(screen.getByText("MyCustomGoal").nextSibling?.textContent).toBe("READY");
    expect(screen.getByText("ReplicaDistributionGoal").nextSibling?.textContent).toBe("NOT READY");
    expect(screen.getByText("1 / 2 ready")).toBeTruthy(); // soft goals
    expect(screen.queryByText(/No proposal can be computed/)).toBeNull();
  });

  it("Analyzer warns when no proposal is ready", async () => {
    await open({ ...ccState, AnalyzerState: { ...ccState.AnalyzerState, isProposalReady: false } }, "Analyzer");
    expect(screen.getByText(/No proposal can be computed/)).toBeTruthy();
    expect(screen.getAllByText("PROPOSAL NOT READY").length).toBeGreaterThan(0);
  });

  it("Monitor shows its state and coverage", async () => {
    await open({ ...ccState, MonitorState: { state: "RUNNING", numValidPartitions: 98, numTotalPartitions: 100, monitoringCoveragePct: 98 } }, "Monitor");
    expect(screen.getByText("98 of 100")).toBeTruthy();
    expect(bar("Monitor window coverage").value).toBe(98);
  });

  it("Anomaly detector lists recent anomalies by type, and shows an empty state", async () => {
    await open({ ...ccState, AnomalyDetectorState: { selfHealingEnabled: ["BROKER_FAILURE"], balancednessScore: 97.5, recentBrokerFailures: [{ anomalyId: "a-1", status: "FIX_STARTED", detectionMs: 1760000000000 }] } }, "Anomaly detector");
    expect(screen.getByRole("row", { name: /Broker failure a-1 FIX_STARTED/ })).toBeTruthy();
    cleanup();
    await open(ccState, "Anomaly detector");
    expect(screen.getByText("No recent anomalies.")).toBeTruthy();
  });

  it("an unknown field or a missing section does not break the page", async () => {
    await open({ version: 1, SomethingNew: { x: 1 }, ExecutorState: { state: "NO_TASK_IN_PROGRESS", brandNewField: 7 } });
    expect(screen.getByText("No execution in progress.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Monitor" }));
    expect(screen.getByText("No monitor data.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Anomaly detector" }));
    expect(screen.getByText("No anomaly detector data.")).toBeTruthy();
  });
});

describe("refresh", () => {
  it("repeats the request on the chosen interval and keeps the preference", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const calls = serve({ user_tasks: userTasks });
      render(<UserTasks />);
      await screen.findByText("t-2");
      fireEvent.change(screen.getByLabelText(/Auto-refresh/), { target: { value: "30" } });
      expect(localStorage.getItem("ccui.refresh")).toBe("30");
      const before = calls.length;
      await vi.advanceTimersByTimeAsync(30500);
      await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    } finally {
      vi.useRealTimers();
      localStorage.setItem("ccui.refresh", "0");
    }
  });
});
