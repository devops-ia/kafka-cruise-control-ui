import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { ccState, clusterState, load, optimization, userTasks } from "./fixtures";
import { goalsFromState } from "./goals";
import { CCState } from "./pages/CCState";
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

  it("Cluster state lists brokers and flags under-replicated partitions", async () => {
    serve({ kafka_cluster_state: clusterState });
    render(<ClusterState />);
    expect(await screen.findByRole("heading", { name: /Under-replicated partitions/ })).toBeTruthy();
    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.getByRole("row", { name: /^0 yes/ })).toBeTruthy();
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

describe("CC state and goals", () => {
  it("reads goals from the analyzer state, grouped, including goals the old UI did not know", () => {
    const g = goalsFromState(ccState);
    expect(g.hard).toEqual(["DiskCapacityGoal", "RackAwareGoal"]);
    expect(g.soft).toEqual(["MyCustomGoal", "ReplicaDistributionGoal"]);
    expect(goalsFromState({})).toEqual({ hard: [], soft: [] });
  });

  it("shows the four state sections and the unknown goal as not hard-coded", async () => {
    serve({ state: ccState });
    render(<CCState />);
    expect(await screen.findByText("NO_TASK_IN_PROGRESS")).toBeTruthy(); // executor
    fireEvent.click(screen.getByRole("button", { name: "Monitor" }));
    expect(screen.getByText("RUNNING")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Analyzer" }));
    expect(screen.getByText("MyCustomGoal: ready")).toBeTruthy();
    expect(screen.getByText("ReplicaDistributionGoal: not ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Anomaly detector" }));
    expect(screen.getByText("balancednessScore")).toBeTruthy();
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
