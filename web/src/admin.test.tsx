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
    pick("Remove broker");
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
    pick("Remove broker");
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
    pick("Pause sampling");
    pick("Apply");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].path).toBe(proxyPath("prod-b", "pause_sampling"));
    expect(posts(calls)[0].query.has("dryrun")).toBe(false);
  });
});
