import { ApiError, buildQuery, cc, ccWait, getSession, login, setUnauthorizedHandler } from "./api";
import { mockFetch, proxyPath } from "./testutil";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("keeps explicit false and drops empty values", () => {
    expect(buildQuery({ dryrun: false, goals: "", brokerid: undefined, n: 0 })).toBe("dryrun=false&n=0");
  });

  it("sends the CSRF token from the session on POST only", async () => {
    const calls = mockFetch((c) => (c.path === "/api/session" ? { body: { authenticated: true, mode: "local", csrfToken: "tok" } } : { body: {} }));
    await getSession();
    await cc("a", "state");
    await cc("a", "rebalance", { dryrun: true }, { method: "POST" });
    expect(calls[1].headers.get("X-CSRF-Token")).toBeNull();
    expect(calls[2].headers.get("X-CSRF-Token")).toBe("tok");
    expect(calls[2].url).toBe("/api/clusters/a/proxy/rebalance?dryrun=true");
  });

  it("calls the unauthorized handler on 401, but not for a wrong password", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetch(() => ({ status: 401, body: { error: "authentication required" } }));
    await expect(cc("a", "state")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(login("u", "p")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("surfaces CC's own error message", async () => {
    mockFetch(() => ({ status: 400, body: { errorMessage: "bad goal" } }));
    await expect(cc("a", "rebalance", {}, { method: "POST" })).rejects.toThrow("bad goal");
  });

  it("repeats a 202 with its User-Task-ID until 200", async () => {
    const seen: (string | null)[] = [];
    const calls = mockFetch((c, n) => {
      seen.push(c.headers.get("User-Task-ID"));
      return n < 3 ? { status: 202, body: { progress: [] }, headers: { "User-Task-ID": "t1" } } : { body: { done: true } };
    });
    const r = await ccWait("a", "proposals", {}, { delayMs: 1 });
    expect(r.data).toEqual({ done: true });
    expect(calls).toHaveLength(3);
    expect(seen).toEqual([null, "t1", "t1"]);
    expect(calls[0].path).toBe(proxyPath("a", "proposals"));
  });
});
