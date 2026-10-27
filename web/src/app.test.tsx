import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { App } from "./App";
import { clusters } from "./clusters";
import { load } from "./fixtures";
import { navigate } from "./router";
import { session } from "./session";
import { setCluster } from "./store";
import { twoStep } from "./twostep";
import { mockFetch } from "./testutil";

afterEach(() => {
  twoStep.set({});
  cleanup();
  vi.unstubAllGlobals();
  session.set(undefined);
});

describe("App", () => {
  it("sends a 401 to the login and returns to the same page after signing in", async () => {
    localStorage.clear();
    setCluster("a");
    let authed = true;
    mockFetch((c) => {
      if (c.path === "/api/session") return { body: authed ? { authenticated: true, mode: "local", user: "ana", role: "admin", csrfToken: "t" } : { authenticated: false, mode: "local" } };
      if (c.path === "/api/clusters") return { body: [{ name: "a" }] };
      if (c.path === "/api/login") {
        authed = true;
        return { body: { user: "ana" } };
      }
      if (c.path.endsWith("/proxy/load")) return authed ? { body: load } : { status: 401, body: { error: "authentication required" } };
      if (c.path.endsWith("/proxy/state")) return { body: {} };
    });
    navigate("/load");
    render(<App />);
    expect(await screen.findByRole("row", { name: /kafka-0/ })).toBeTruthy();

    authed = false; // the session expires; the next refresh gets a 401
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();

    fireEvent.input(screen.getByLabelText("User name"), { target: { value: "admin" } });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("row", { name: /kafka-0/ })).toBeTruthy();
    expect(location.pathname).toBe("/load");
  });

  it("shows the navigation in four groups and every page is one click away", async () => {
    localStorage.clear();
    setCluster("a");
    mockFetch((c) => {
      if (c.path === "/api/session") return { body: { authenticated: true, mode: "none", user: "anonymous", role: "admin", csrfToken: "t" } };
      if (c.path === "/api/clusters") return { body: [{ name: "a" }] };
      return { body: {} };
    });
    navigate("/summary");
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect([...nav.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Overview", "Load", "Operations", "Tasks"]);
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      "Summary", "Cluster state", "Cruise Control state", "Config insights", "Load", "Partition load", "Proposals", "Admin", "Peer review", "User tasks",
    ]);
  });

  it("remembers the selected cluster", async () => {
    localStorage.clear();
    setCluster("a");
    mockFetch((c) => {
      if (c.path === "/api/session") return { body: { authenticated: true, mode: "none", user: "anonymous", role: "admin", csrfToken: "t" } };
      if (c.path === "/api/clusters") return { body: [{ name: "a", group: "prod" }, { name: "b", group: "dev" }] };
      return { body: {} };
    });
    navigate("/load");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cluster a" }));
    fireEvent.click(await screen.findByRole("button", { name: "b" }));
    expect(localStorage.getItem("ccui.cluster")).toBe("b");
    expect(screen.getByRole("button", { name: "Cluster b" })).toBeTruthy();
  });

  it("opens its own cluster list from the first group and drives it from the keyboard", async () => {
    localStorage.clear();
    setCluster("c");
    const list = [{ name: "a", group: "prod" }, { name: "b", group: "dev" }, { name: "c" }];
    clusters.set(list); // not the previous test's list while /api/clusters is in flight
    mockFetch((c) => {
      if (c.path === "/api/session") return { body: { authenticated: true, mode: "none", user: "anonymous", role: "admin", csrfToken: "t" } };
      if (c.path === "/api/clusters") return { body: list };
      return { body: {} };
    });
    navigate("/load");
    render(<App />);
    const toggle = await screen.findByRole("button", { name: "Cluster c" });
    expect(document.querySelector("select#cluster")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    await screen.findByRole("button", { name: "c" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const box = document.querySelector(".cluster-list")!;
    expect([...box.querySelectorAll("[id], button")].map((e) => e.textContent)).toEqual(["prod", "a", "dev", "b", "Ungrouped", "c"]);
    for (const g of ["prod", "dev", "Ungrouped"]) expect(screen.getByRole("group", { name: g })).toBeTruthy();
    expect([...box.querySelectorAll('[aria-current="true"]')].map((e) => e.textContent)).toEqual(["c"]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("c"));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("b");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("c");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); // no wrap at the end
    expect(document.activeElement?.textContent).toBe("c");

    // Safari and Firefox on macOS blur on mousedown over a button: focusout with no relatedTarget must not close the list.
    // A native event: jsdom has no onfocusout, so fireEvent.focusOut sends a "FocusOut" type that Preact never hears.
    document.activeElement!.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    await new Promise((r) => setTimeout(r));
    expect(document.querySelector(".cluster-list")).not.toBeNull();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".cluster-list")).toBeNull());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(localStorage.getItem("ccui.cluster")).toBe("c");

    fireEvent.click(toggle);
    await screen.findByRole("button", { name: "a" });
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(document.querySelector(".cluster-list")).toBeNull());
    expect(localStorage.getItem("ccui.cluster")).toBe("c");

    fireEvent.click(toggle);
    const b = await screen.findByRole("button", { name: "b" });
    b.focus();
    // jsdom does not turn Enter on a button into a click as browsers do, so the click stands in for that activation.
    fireEvent.keyDown(b, { key: "Enter" });
    fireEvent.click(b);
    expect(localStorage.getItem("ccui.cluster")).toBe("b");
    await waitFor(() => expect(document.querySelector(".cluster-list")).toBeNull());
    expect(document.activeElement).toBe(toggle);
  });

  it("marks an unreachable cluster in the list", async () => {
    localStorage.clear();
    setCluster("a");
    mockFetch((c) => {
      if (c.path === "/api/session") return { body: { authenticated: true, mode: "none", user: "anonymous", role: "admin", csrfToken: "t" } };
      if (c.path === "/api/clusters") return { body: [{ name: "a" }, { name: "b" }] };
      if (c.path === "/api/clusters/b/proxy/state") return { status: 502, body: { error: "x" } };
      return { body: {} };
    });
    navigate("/load");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cluster a" }));
    expect(await screen.findByRole("button", { name: "b (unreachable)" })).toBeTruthy();
    expect(document.querySelector(".cluster-select .dot")).toBeTruthy();
  });

  const asRole = (role: "viewer" | "admin", mode = "local") => {
    localStorage.clear();
    setCluster("a");
    return mockFetch((c) => {
      if (c.path === "/api/session") return { body: { authenticated: true, mode, user: "leo", role, csrfToken: "t" } };
      if (c.path === "/api/clusters") return { body: [{ name: "a" }] };
      return { body: {} };
    });
  };
  const links = async () => [...(await screen.findByRole("navigation", { name: "Main" })).querySelectorAll("a")].map((a) => a.textContent);

  it("viewer sees only Overview and Load in the sidebar", async () => {
    asRole("viewer");
    navigate("/summary");
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect([...nav.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Overview", "Load"]);
    expect(await links()).toEqual(["Summary", "Cluster state", "Cruise Control state", "Config insights", "Load", "Partition load"]);
  });

  it.each(["/tasks", "/proposals", "/admin", "/review"])("viewer on %s gets a 403 page and no request for it", async (page) => {
    const calls = asRole("viewer");
    navigate(page);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "403 Forbidden" })).toBeTruthy();
    await links();
    expect(calls.filter((c) => /\/proxy\/(user_tasks|proposals|review_board)$/.test(c.path) || c.method === "POST")).toEqual([]);
  });

  it("admin sees the four groups, and mode none counts as admin", async () => {
    asRole("admin");
    navigate("/summary");
    render(<App />);
    expect((await links()).length).toBe(10);
    // the build's version sits under the title; tests build without one
    expect(document.querySelector(".brand .build")?.textContent).toBe("dev");
    expect(document.querySelector(".brand img")).toBeNull(); // no CCUI_LOGO_URL: the built-in mark
    cleanup();
    const icon = Object.assign(document.createElement("link"), { rel: "icon" });
    icon.setAttribute("href", "https://cdn.example.com/logo.png");
    document.head.append(icon);
    render(<App />);
    await links();
    expect(document.querySelector(".brand img")?.getAttribute("src")).toBe("https://cdn.example.com/logo.png");
    icon.remove();
    cleanup();
    asRole("admin", "none");
    render(<App />);
    expect((await links()).length).toBe(10);
  });

  describe("Peer review in the sidebar", () => {
    const OFF = { status: 403, body: { errorMessage: "Cannot process GET request due to: 'Attempt to access REVIEW_BOARD endpoint without enabling 'two.step.verification.enabled' config.'." } };
    const setup = (role: "viewer" | "admin", review: (cluster: string) => { status?: number; body?: unknown }) => {
      localStorage.clear();
      setCluster("a");
      return mockFetch((c) => {
        if (c.path === "/api/session") return { body: { authenticated: true, mode: "local", user: "leo", role, csrfToken: "t" } };
        if (c.path === "/api/clusters") return { body: [{ name: "a" }, { name: "b" }] };
        const m = c.path.match(/^\/api\/clusters\/(\w+)\/proxy\/review_board$/);
        if (m) return review(m[1]);
        return { body: {} };
      });
    };
    const hasReview = async () => (await links()).includes("Peer review");

    it("hides Peer review when two-step verification is off and keeps the other Operations entries", async () => {
      setup("admin", () => OFF);
      navigate("/summary");
      render(<App />);
      await waitFor(async () => expect(await hasReview()).toBe(false));
      expect(await links()).toEqual(["Summary", "Cluster state", "Cruise Control state", "Config insights", "Load", "Partition load", "Proposals", "Admin", "User tasks"]);
    });

    it("follows the selected cluster without a reload", async () => {
      setup("admin", (cl) => (cl === "a" ? OFF : { body: { RequestInfo: [] } }));
      navigate("/summary");
      render(<App />);
      await waitFor(async () => expect(await hasReview()).toBe(false));
      // scoped to the header: the Summary table has a button per cluster too
      const header = within(screen.getByRole("banner"));
      fireEvent.click(header.getByRole("button", { name: /Cluster/ }));
      fireEvent.click(await header.findByRole("button", { name: "b" }));
      await waitFor(async () => expect(await hasReview()).toBe(true));
      fireEvent.click(header.getByRole("button", { name: /Cluster/ }));
      fireEvent.click(await header.findByRole("button", { name: "a" }));
      await waitFor(async () => expect(await hasReview()).toBe(false));
    });

    it.each([502, 504, 401, 500])("keeps Peer review when the probe fails with %s", async (status) => {
      const calls = setup("admin", () => ({ status, body: { error: "x" } }));
      navigate("/summary");
      render(<App />);
      await waitFor(() => expect(calls.some((c) => c.path.endsWith("/proxy/review_board"))).toBe(true));
      await new Promise((r) => setTimeout(r, 20));
      expect(await hasReview()).toBe(true);
    });

    it("does not probe for a viewer", async () => {
      const calls = setup("viewer", () => OFF);
      navigate("/summary");
      render(<App />);
      await links();
      await new Promise((r) => setTimeout(r, 20));
      expect(calls.filter((c) => c.path.endsWith("/proxy/review_board"))).toEqual([]);
    });

    it("still shows the notice on /review when the menu entry is hidden", async () => {
      setup("admin", () => OFF);
      navigate("/review");
      render(<App />);
      expect(await screen.findByText(/Two-step verification is disabled on this cluster/)).toBeTruthy();
      await waitFor(async () => expect(await hasReview()).toBe(false));
    });
  });
});
