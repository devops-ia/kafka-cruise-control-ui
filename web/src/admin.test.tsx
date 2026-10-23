import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import type { Role } from "./api";
import { ccState, clusterState, optimization } from "./fixtures";
import { Admin } from "./pages/Admin";
import { session } from "./session";
import { act } from "@testing-library/preact";
import { setCluster } from "./store";
import { tasks } from "./tasks";
import { mockFetch, proxyPath } from "./testutil";

function setup(role: Role = "admin", cluster = "prod-b", kcs: object = clusterState) {
  localStorage.clear();
  tasks.set([]);
  setCluster(cluster);
  session.set({ authenticated: true, mode: "local", user: "ana", role, csrfToken: "tok" });
  return mockFetch((c) => {
    if (c.method === "POST") return { body: optimization };
    if (c.path.endsWith("/state")) return { body: ccState };
    if (c.path.endsWith("/kafka_cluster_state")) return { body: kcs };
  });
}
const posts = (calls: ReturnType<typeof mockFetch>) => calls.filter((c) => c.method === "POST");
const pick = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Admin", () => {
  it("Simulate sends dryrun=true", async () => {
    const calls = setup();
    render(<Admin />);
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "rebalance"));
    expect(posts(calls)[0].query.get("dryrun")).toBe("true");
    expect(posts(calls)[0].headers.get("X-CSRF-Token")).toBeDefined();
  });

  it("asks for confirmation naming the cluster, and Cancel sends nothing", () => {
    const calls = setup();
    render(<Admin />);
    pick("Execute");
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("prod-b");
    expect(dialog.textContent).toContain("Rebalance");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts(calls)).toHaveLength(0);
  });

  it("Escape closes the dialog without a request", () => {
    const calls = setup();
    render(<Admin />);
    pick("Execute");
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts(calls)).toHaveLength(0);
  });

  it("confirming sends dryrun=false", async () => {
    const calls = setup();
    render(<Admin />);
    pick("Execute");
    pick("Execute on prod-b");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].query.get("dryrun")).toBe("false");
  });

  it("remove broker sends brokerid and throttle_removed_broker, and names the broker in the dialog", async () => {
    const calls = setup();
    render(<Admin />);
    tab("Remove broker");
    fireEvent.input(screen.getByLabelText(/Broker IDs/), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("Throttle removed broker"));
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    const q = posts(calls)[0].query;
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "remove_broker"));
    expect([q.get("brokerid"), q.get("throttle_removed_broker"), q.get("dryrun")]).toEqual(["3", "true", "true"]);
    pick("Execute");
    expect(screen.getByRole("alertdialog").textContent).toContain("3");
  });

  it("remove disks sends the chosen log dirs with dryrun=true and names them in the dialog", async () => {
    const calls = setup();
    render(<Admin />);
    tab("Remove disks");
    fireEvent.click(await screen.findByLabelText("Broker 0 /data/b"));
    fireEvent.click(screen.getByLabelText("Broker 1 /data/a"));
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    const q = posts(calls)[0].query;
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "remove_disks"));
    expect([q.get("brokerid_and_logdirs"), q.get("dryrun"), q.has("verbose")]).toEqual(["0-/data/b,1-/data/a", "true", false]);
    pick("Execute");
    const dialog = screen.getByRole("alertdialog").textContent!;
    expect(dialog).toContain("prod-b");
    expect(dialog).toContain("0-/data/b,1-/data/a");
  });

  it("a log dir path with a comma is disabled with a note and never sent", async () => {
    const withComma = { ...clusterState, KafkaBrokerState: { ...clusterState.KafkaBrokerState, OnlineLogDirsByBrokerId: { 0: ["/data/a,b", "/data/c"] } } };
    const calls = setup("admin", "prod-b", withComma);
    render(<Admin />);
    tab("Remove disks");
    const box = (await screen.findByLabelText("Broker 0 /data/a,b")) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/path contains a comma, cannot be selected/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Broker 0 /data/c"));
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].query.get("brokerid_and_logdirs")).toBe("0-/data/c");
  });

  it("a log dir selection made on one cluster does not survive switching cluster", async () => {
    const calls = setup();
    render(<Admin />);
    tab("Remove disks");
    fireEvent.click(await screen.findByLabelText("Broker 0 /data/b"));
    act(() => setCluster("prod-c"));
    const box = (await screen.findByLabelText("Broker 0 /data/b")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    pick("Simulate");
    expect(posts(calls)).toHaveLength(0);
  });

  it("remove disks lists many log dirs in a filterable, paged table and keeps the selection across pages", async () => {
    const many = { 0: Array.from({ length: 8 }, (_, i) => `/data/d${i}`), 1: Array.from({ length: 8 }, (_, i) => `/data/d${i}`) };
    const calls = setup("admin", "prod-b", { ...clusterState, KafkaBrokerState: { ...clusterState.KafkaBrokerState, OnlineLogDirsByBrokerId: many } });
    render(<Admin />);
    tab("Remove disks");
    const t = within(await screen.findByRole("region", { name: "Log dirs" }));
    expect(t.getAllByRole("checkbox")).toHaveLength(10);
    expect(t.getByText("Page 1 of 2")).toBeTruthy();
    fireEvent.click(t.getByLabelText("Broker 0 /data/d0"));
    fireEvent.click(t.getByRole("button", { name: "Next" }));
    fireEvent.click(t.getByLabelText("Broker 1 /data/d7"));
    expect(screen.getByText("2 of 16 log dirs selected")).toBeTruthy();
    fireEvent.click(t.getByRole("button", { name: "Filter" }));
    fireEvent.input(t.getByLabelText("Filter Log dir"), { target: { value: "d3" } });
    expect(t.getAllByRole("checkbox")).toHaveLength(2);
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].query.get("brokerid_and_logdirs")).toBe("0-/data/d0,1-/data/d7");
  });

  it("remove disks without a selection sends nothing and says so", async () => {
    const calls = setup();
    render(<Admin />);
    tab("Remove disks");
    await screen.findByLabelText("Broker 0 /data/b");
    pick("Simulate");
    expect(screen.getByRole("alert").textContent).toContain("at least one log dir");
    pick("Execute");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts(calls)).toHaveLength(0);
  });

  it("remove disks explains a cluster that reports no log dirs and sends nothing", async () => {
    const { OnlineLogDirsByBrokerId: _, ...rest } = clusterState.KafkaBrokerState;
    const calls = setup("admin", "prod-b", { ...clusterState, KafkaBrokerState: rest });
    render(<Admin />);
    tab("Remove disks");
    expect((await screen.findByText(/does not report any log dirs/)).textContent).toBeTruthy();
    pick("Simulate");
    expect(posts(calls)).toHaveLength(0);
  });

  it("does not send an unfilled required field", () => {
    const calls = setup();
    render(<Admin />);
    tab("Remove broker");
    pick("Simulate");
    expect(posts(calls)).toHaveLength(0);
  });

  it("offers goals read from the cluster and sends the chosen one", async () => {
    const calls = setup();
    render(<Admin />);
    fireEvent.click(await screen.findByLabelText("MyCustomGoal"));
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].query.get("goals")).toBe("MyCustomGoal");
  });

  it("operations without a dry-run send no dryrun parameter", async () => {
    const calls = setup();
    render(<Admin />);
    tab("Pause sampling");
    pick("Apply");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "pause_sampling"));
    expect(posts(calls)[0].query.has("dryrun")).toBe(false);
  });

  it("Rebalance disks simulates and asks for confirmation before executing", async () => {
    const calls = setup();
    render(<Admin />);
    tab("Rebalance disks");
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "rebalance"));
    expect([posts(calls)[0].query.get("rebalance_disk"), posts(calls)[0].query.get("dryrun")]).toEqual(["true", "true"]);
    pick("Execute");
    expect(screen.getByRole("alertdialog").textContent).toContain("prod-b");
    expect(posts(calls)).toHaveLength(1);
    pick("Execute on prod-b");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(2));
    expect(posts(calls)[1].query.get("dryrun")).toBe("false");
  });

  it("data_from is a labelled select that is sent when chosen", async () => {
    const calls = setup();
    render(<Admin />);
    fireEvent.change(screen.getByLabelText("Data from"), { target: { value: "valid_partitions" } });
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].query.get("data_from")).toBe("valid_partitions");
  });

  it("is a vertical tab list wired to one labelled tabpanel", () => {
    setup();
    render(<Admin />);
    const list = screen.getByRole("tablist");
    expect(list.getAttribute("aria-label")).toBeTruthy();
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(tabs.map((t) => t.tabIndex)).toEqual(tabs.map((_, i) => (i === 0 ? 0 : -1))); // roving tabindex
    const panel = screen.getByRole("tabpanel");
    expect(tabs[0].getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0].id);
    expect(panel.textContent).toContain("Move replicas and leaders");
    tab("Remove broker");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Remove broker" }).id);
  });

  it("moves between tabs with ArrowUp and ArrowDown, wrapping at the ends", () => {
    setup();
    render(<Admin />);
    const all = screen.getAllByRole("tab").map((t) => t.textContent);
    const sel = () => screen.getByRole("tab", { selected: true });
    fireEvent.keyDown(sel(), { key: "ArrowDown" });
    expect(sel().textContent).toBe(all[1]);
    fireEvent.keyDown(sel(), { key: "ArrowUp" });
    fireEvent.keyDown(sel(), { key: "ArrowUp" });
    expect(sel().textContent).toBe(all[all.length - 1]);
    expect(document.activeElement).toBe(sel());
  });

  it("moves between tabs with ArrowLeft, ArrowRight, Home and End, wrapping at the ends", () => {
    setup();
    render(<Admin />);
    const names = () => screen.getAllByRole("tab").map((t) => t.textContent);
    const all = names();
    const sel = () => screen.getByRole("tab", { selected: true });
    const key = (k: string) => fireEvent.keyDown(sel(), { key: k });
    key("ArrowRight");
    expect(sel().textContent).toBe(all[1]);
    expect(document.activeElement).toBe(sel());
    key("ArrowLeft");
    key("ArrowLeft");
    expect(sel().textContent).toBe(all[all.length - 1]);
    key("ArrowRight");
    expect(sel().textContent).toBe(all[0]);
    key("End");
    expect(sel().textContent).toBe(all[all.length - 1]);
    key("Home");
    expect(sel().textContent).toBe(all[0]);
  });

  it("groups the tabs under hidden titles in one flat tab order", () => {
    setup();
    render(<Admin />);
    const labels = [...document.querySelectorAll(".op-group-label")];
    expect(labels.map((l) => l.textContent)).toEqual(["Rebalance", "Disks", "Brokers", "Replicas", "Sampling", "Executions"]);
    expect(labels.every((l) => l.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Rebalance",
      "Preferred leader election",
      "Rebalance disks",
      "Remove disks",
      "Add broker",
      "Remove broker",
      "Demote broker",
      "Fix offline replicas",
      "Topic replication factor",
      "Self-healing and concurrency",
      "Pause sampling",
      "Resume sampling",
      "Stop execution",
    ]);
  });

  it("keeps goals in a collapsed details and says what Simulate and Execute do", () => {
    setup();
    render(<Admin />);
    const details = screen.getByText("Goals, optional").closest("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText(/Execute changes the real cluster, Simulate does not/)).toBeTruthy();
  });
});
