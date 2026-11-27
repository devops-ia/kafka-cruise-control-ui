import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import type { Role } from "./api";
import { ccState, clusterState, load, optimization } from "./fixtures";
import { Admin } from "./pages/Admin";
import { session } from "./session";
import { act } from "@testing-library/preact";
import { setCluster } from "./store";
import { tasks } from "./tasks";
import { mockFetch, proxyPath, type Call, type Reply } from "./testutil";

function setup(role: Role = "admin", cluster = "prod-b", kcs: object = clusterState, override?: (c: Call) => Reply | undefined) {
  localStorage.clear();
  tasks.set([]);
  setCluster(cluster);
  session.set({ authenticated: true, mode: "local", user: "ana", role, csrfToken: "tok" });
  return mockFetch((c) => {
    if (c.method === "POST") return { body: optimization };
    const o = override?.(c);
    if (o) return o;
    if (c.path.endsWith("/state")) return { body: ccState };
    if (c.path.endsWith("/kafka_cluster_state")) return { body: kcs };
    if (c.path.endsWith("/load")) return { body: load };
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
    const dirs = within(screen.getByRole("alertdialog")).getAllByRole("listitem").map((li) => li.textContent);
    expect(dirs).toEqual(["0-/data/b", "1-/data/a"]); // one log dir per line
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

describe("Admin broker picker", () => {
  // kafka_cluster_state with these broker ids, and a load answer with host kafka-<id> for each.
  const kcsOf = (...ids: number[]) => ({ KafkaBrokerState: { ReplicaCountByBrokerId: Object.fromEntries(ids.map((i) => [i, 1])) } });
  const loadOf = (...ids: number[]) => ({ brokers: ids.map((i) => ({ Broker: i, Host: `kafka-${i}`, BrokerState: "ALIVE" })) });
  const down: Reply = { status: 500, body: { errorMessage: "boom" } };
  const pending: Reply = { status: 202, headers: { "User-Task-ID": "t" } };
  const replies = (kcs: Reply, ld: Reply) => (c: Call) => (c.path.endsWith("/kafka_cluster_state") ? kcs : c.path.endsWith("/load") ? ld : undefined);
  const brokers = (...ids: number[]) => replies({ body: kcsOf(...ids) }, { body: loadOf(...ids) });

  function open(name = "Remove broker", override = brokers(0, 1)) {
    const calls = setup("admin", "prod-b", clusterState, override);
    render(<Admin />);
    tab(name);
    return calls;
  }
  const box = async (id: number) => (await screen.findByLabelText(`Broker ${id}`)) as HTMLInputElement;
  const check = async (id: number) => fireEvent.click(await box(id));
  const field = () => screen.getByLabelText(/Broker IDs/) as HTMLInputElement;
  const type = (value: string) => fireEvent.input(field(), { target: { value } });
  const table = () => within(screen.getByRole("region", { name: "Brokers" }));
  // Cell texts after the checkbox column: id, host, state.
  const rows = () => table().getAllByRole("checkbox").map((c) => [...c.closest("tr")!.cells].slice(1).map((td) => td.textContent));
  const filterHost = (value: string) => {
    if (!table().queryByLabelText("Filter Host")) fireEvent.click(table().getByRole("button", { name: "Filter" }));
    fireEvent.input(table().getByLabelText("Filter Host"), { target: { value } });
  };
  const sent = async (calls: Call[]) => {
    pick("Simulate");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    return posts(calls)[0].query;
  };

  it("shows one row per broker, ordered by id, with id, host and state", async () => {
    open("Remove broker", replies({ body: kcsOf(1, 0) }, { body: { brokers: [{ Broker: 1, Host: "kafka-1", BrokerState: "DEAD" }, { Broker: 0, Host: "kafka-0", BrokerState: "ALIVE" }] } }));
    await screen.findByText("kafka-1");
    expect(rows()).toEqual([["0", "kafka-0", "ALIVE"], ["1", "kafka-1", "DEAD"]]);
    expect(table().getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Select", "ID", "Host", "State"]);
  });

  it("remove broker sends the two marked brokers and counts them", async () => {
    const calls = open();
    await check(0);
    await check(1);
    expect(screen.getByText("2 of 2 brokers selected")).toBeTruthy();
    const q = await sent(calls);
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "remove_broker"));
    expect([q.get("brokerid"), q.get("dryrun")]).toEqual(["0,1", "true"]);
  });

  it("demote broker sends the marked broker", async () => {
    const calls = open("Demote broker");
    await check(1);
    const q = await sent(calls);
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "demote_broker"));
    expect([q.get("brokerid"), q.get("dryrun")]).toEqual(["1", "true"]);
  });

  it("unchecking removes the broker", async () => {
    const calls = open();
    await check(0);
    await check(1);
    await check(0);
    expect((await sent(calls)).get("brokerid")).toBe("1");
  });

  it("sends nothing without a selection", async () => {
    const calls = open();
    await check(1);
    await check(1);
    pick("Simulate");
    expect(posts(calls)).toHaveLength(0);
  });

  it("switching cluster shows the new brokers with nothing selected", async () => {
    open("Remove broker", (c) => brokers(...(c.path.includes("prod-c") ? [1, 5] : [0, 1]))(c));
    await check(1);
    act(() => setCluster("prod-c"));
    await box(5);
    expect(screen.queryByLabelText("Broker 0")).toBeNull();
    expect(table().getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked)).toEqual([false, false]);
    expect(field().value).toBe("");
  });

  it("add broker has the field and the table", async () => {
    open("Add broker");
    await screen.findByText("kafka-1");
    expect(field()).toBeTruthy();
    expect(table().getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Select", "ID", "Host", "State"]);
    expect(rows()).toEqual([["0", "kafka-0", "ALIVE"], ["1", "kafka-1", "ALIVE"]]);
  });

  it("add broker sends the two marked brokers and counts them", async () => {
    const calls = open("Add broker", brokers(0, 1, 2, 3));
    await check(2);
    await check(3);
    expect(screen.getByText("2 of 4 brokers selected")).toBeTruthy();
    const q = await sent(calls);
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "add_broker"));
    expect([q.get("brokerid"), q.get("dryrun")]).toEqual(["2,3", "true"]);
  });

  it("add broker can mark a new broker with no replicas that load does not report", async () => {
    const calls = open("Add broker", replies({ body: { KafkaBrokerState: { ReplicaCountByBrokerId: { 0: 120, 1: 80, 2: 0 } } } }, { body: loadOf(0, 1) }));
    await screen.findByText("kafka-1");
    expect(rows()).toEqual([["0", "kafka-0", "ALIVE"], ["1", "kafka-1", "ALIVE"], ["2", "", ""]]);
    await check(2);
    const q = await sent(calls);
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "add_broker"));
    expect(q.get("brokerid")).toBe("2");
  });

  it("add broker sends typed ids that are not in the table yet", async () => {
    const calls = open("Add broker");
    await box(1);
    type("3,4");
    const q = await sent(calls);
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "add_broker"));
    expect([q.get("brokerid"), q.get("dryrun")]).toEqual(["3,4", "true"]);
  });

  it("the add broker dialog and request mix a typed id and a marked box", async () => {
    const calls = open("Add broker", brokers(0, 1, 2));
    await box(2);
    type("7");
    await check(2);
    pick("Execute");
    expect(within(screen.getByRole("alertdialog")).getByText("7,2")).toBeTruthy();
    pick("Execute on prod-b");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "add_broker"));
    expect([posts(calls)[0].query.get("brokerid"), posts(calls)[0].query.get("dryrun")]).toEqual(["7,2", "false"]);
  });

  it("rebalance keeps destination broker ids as a text field with no table", () => {
    open("Rebalance");
    expect((screen.getByLabelText("Destination broker IDs") as HTMLInputElement).type).toBe("text");
    expect(screen.queryByRole("region", { name: "Brokers" })).toBeNull();
  });

  it("keeps a selection hidden by the filter, also after clearing it", async () => {
    const calls = open();
    await check(0);
    await screen.findByText("kafka-1");
    filterHost("kafka-1");
    expect(rows().map((r) => r[0])).toEqual(["1"]);
    await check(1);
    expect((await sent(calls)).get("brokerid")).toBe("0,1");
    filterHost("");
    expect([(await box(0)).checked, (await box(1)).checked]).toEqual([true, true]);
  });

  it("keeps the selection across pages", async () => {
    const calls = open("Remove broker", brokers(...Array.from({ length: 16 }, (_, i) => i)));
    await check(0);
    fireEvent.click(table().getByRole("button", { name: "Next" }));
    await check(15);
    expect((await sent(calls)).get("brokerid")).toBe("0,15");
  });

  it("typing ids checks their boxes, ignoring spaces", async () => {
    open();
    await box(0);
    type("0, 1");
    expect([(await box(0)).checked, (await box(1)).checked]).toEqual([true, true]);
  });

  it("matches ids exactly", async () => {
    open("Remove broker", brokers(1, 11));
    await box(1);
    type("11");
    expect([(await box(1)).checked, (await box(11)).checked]).toEqual([false, true]);
  });

  it("checking a box keeps a typed id that is not in the table", async () => {
    open();
    await box(1);
    type("7");
    await check(1);
    expect(field().value).toBe("7,1");
  });

  it("sends a typed id without touching the table", async () => {
    const calls = open();
    type("3");
    expect((await sent(calls)).get("brokerid")).toBe("3");
  });

  it("lists selectable ids and says so when load fails", async () => {
    const calls = open("Remove broker", replies({ body: kcsOf(0, 1) }, down));
    expect((await screen.findByText(/Host and state could not be read/)).textContent).toContain("boom");
    await box(1);
    expect(rows()).toEqual([["0", "", ""], ["1", "", ""]]);
    await check(1);
    expect((await sent(calls)).get("brokerid")).toBe("1");
  });

  it("lists selectable ids while load has not answered", async () => {
    open("Remove broker", replies({ body: kcsOf(0, 1) }, pending));
    await check(1);
    expect((await box(1)).checked).toBe(true);
    expect(screen.getByText("Reading host and state...")).toBeTruthy();
  });

  it("lists brokers from load when kafka_cluster_state fails", async () => {
    open("Remove broker", replies(down, { body: loadOf(0, 1) }));
    await box(1);
    expect(rows()).toEqual([["0", "kafka-0", "ALIVE"], ["1", "kafka-1", "ALIVE"]]);
  });

  it("includes a broker found in only one source once", async () => {
    open("Remove broker", replies({ body: kcsOf(0, 1) }, { body: loadOf(0, 1, 2) }));
    await box(2);
    expect(rows().map((r) => r[0])).toEqual(["0", "1", "2"]);
  });

  it("says brokers cannot be read when neither source answers, and the field still works", async () => {
    const calls = open("Remove broker", replies(down, down));
    expect(await screen.findByText(/Brokers could not be read from the cluster/)).toBeTruthy();
    type("3");
    expect((await sent(calls)).get("brokerid")).toBe("3");
  });

  it("says so when the cluster reports no brokers", async () => {
    open("Remove broker", brokers());
    expect(await screen.findByText(/reports no brokers/)).toBeTruthy();
  });

  it("the dialog and the request include brokers hidden by the filter", async () => {
    const calls = open();
    await check(0);
    await check(1);
    await screen.findByText("kafka-1");
    filterHost("kafka-1");
    pick("Execute");
    expect(within(screen.getByRole("alertdialog")).getByText("0,1")).toBeTruthy();
    pick("Execute on prod-b");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect([posts(calls)[0].query.get("brokerid"), posts(calls)[0].query.get("dryrun")]).toEqual(["0,1", "false"]);
  });

  it("the demote dialog names the broker and Cancel sends nothing", async () => {
    const calls = open("Demote broker");
    await check(1);
    pick("Execute");
    expect(within(screen.getByRole("alertdialog")).getByText("1")).toBeTruthy();
    pick("Cancel");
    expect(posts(calls)).toHaveLength(0);
  });
});
