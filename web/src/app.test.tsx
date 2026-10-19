import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { App } from "./App";
import { load } from "./fixtures";
import { navigate } from "./router";
import { session } from "./session";
import { setCluster } from "./store";
import { mockFetch } from "./testutil";

afterEach(() => {
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
    await screen.findByRole("option", { name: "b" });
    fireEvent.change(screen.getByLabelText("Cluster"), { target: { value: "b" } });
    expect(localStorage.getItem("ccui.cluster")).toBe("b");
  });
});
