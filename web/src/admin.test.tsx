import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { Role } from "./api";
import { ccState, optimization } from "./fixtures";
import { Admin } from "./pages/Admin";
import { session } from "./session";
import { setCluster } from "./store";
import { tasks } from "./tasks";
import { mockFetch, proxyPath } from "./testutil";

function setup(role: Role = "admin", cluster = "prod-b") {
  localStorage.clear();
  tasks.set([]);
  setCluster(cluster);
  session.set({ authenticated: true, mode: "local", user: "ana", role, csrfToken: "tok" });
  return mockFetch((c) => {
    if (c.method === "POST") return { body: optimization };
    if (c.path.endsWith("/state")) return { body: ccState };
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

  it("is a horizontal tab bar wired to one labelled tabpanel", () => {
    setup();
    render(<Admin />);
    const list = screen.getByRole("tablist");
    expect(list.getAttribute("aria-label")).toBeTruthy();
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

  it("keeps goals in a collapsed details and says what Simulate and Execute do", () => {
    setup();
    render(<Admin />);
    const details = screen.getByText("Goals, optional").closest("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText(/Execute changes the real cluster, Simulate does not/)).toBeTruthy();
  });
});
