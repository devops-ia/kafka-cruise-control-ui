import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { TaskPanel } from "./components/TaskPanel";
import { optimization } from "./fixtures";
import { PeerReview } from "./pages/PeerReview";
import { UserTasks } from "./pages/UserTasks";
import { session } from "./session";
import { setCluster } from "./store";
import { pendingReviewId, pollDelayMs, runTask, tasks } from "./tasks";
import { mockFetch } from "./testutil";

beforeEach(() => {
  localStorage.clear();
  tasks.set([]);
  pollDelayMs.value = 5;
  setCluster("a");
  session.set({ authenticated: true, mode: "local", user: "ana", role: "admin", csrfToken: "tok" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("async tasks", () => {
  it("shows the task as running on 202, retries with User-Task-ID and ends with the result", async () => {
    pollDelayMs.value = 80;
    const calls = mockFetch((_c, n) => {
      if (n === 1) return { status: 202, body: { progress: [{ operation: "rebalance", operationProgress: [{ step: "AGGREGATING_METRICS", description: "collecting", completionPercentage: 0.5 }] }] }, headers: { "User-Task-ID": "t1" } };
      return n < 4 ? { status: 202, body: {}, headers: { "User-Task-ID": "t1" } } : { body: optimization };
    });
    const done = runTask("a", "rebalance", { dryrun: true });
    await waitFor(() => expect(tasks.get()[0]?.taskId).toBe("t1"));
    expect(tasks.get()[0].state).toBe("running");
    expect(tasks.get()[0].percent).toBe(50);
    await done;
    expect(tasks.get()[0].state).toBe("done");
    expect(calls.map((c) => c.headers.get("User-Task-ID"))).toEqual([null, "t1", "t1", "t1"]);
    expect(calls.every((c) => c.query.get("dryrun") === "true")).toBe(true);
  });

  it("keeps the panel and the task while the page changes", async () => {
    // CC keeps answering 202 for a while; the task has to stay visible meanwhile.
    mockFetch((c, n) => (c.method === "POST" ? (n < 6 ? { status: 202, headers: { "User-Task-ID": "t1" } } : { body: {} }) : { body: { userTasks: [] } }));
    pollDelayMs.value = 40;
    function Host() {
      const [page, setPage] = useState("a");
      return (
        <>
          <button onClick={() => setPage("b")}>go</button>
          {page === "a" ? <p>page A</p> : <UserTasks />}
          <TaskPanel />
        </>
      );
    }
    render(<Host />);
    void runTask("a", "rebalance", { dryrun: true });
    expect(await screen.findByText("t1")).toBeTruthy();
    fireEvent.click(screen.getByText("go"));
    expect(screen.queryByText("page A")).toBeNull();
    expect(screen.getByText("t1")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
  });

  it("reports a failure", async () => {
    mockFetch(() => ({ status: 502, body: { error: "cluster unavailable" } }));
    await runTask("a", "rebalance", { dryrun: true });
    expect(tasks.get()[0]).toMatchObject({ state: "error", error: "cluster unavailable" });
  });
});

describe("two-step verification", () => {
  const pending = { RequestInfo: [{ Id: 7, Status: "PENDING_REVIEW", EndpointWithParams: "REBALANCE?dryrun=false", SubmitterAddress: "10.0.0.1", SubmissionTimeMs: 1760000000000, Reason: "" }] };

  it("recognises a parked request and shows its review id", async () => {
    expect(pendingReviewId(pending)).toBe(7);
    expect(pendingReviewId(optimization)).toBeUndefined();
    mockFetch(() => ({ body: pending }));
    await runTask("a", "rebalance", { dryrun: false });
    expect(tasks.get()[0]).toMatchObject({ state: "review", reviewId: 7 });
    render(<TaskPanel />);
    expect(screen.getByText(/waiting for review #7/)).toBeTruthy();
  });

  it("Peer review approves, then executes the approved request with review_id", async () => {
    const board = (status: string) => ({ RequestInfo: [{ ...pending.RequestInfo[0], Status: status }] });
    let status = "PENDING_REVIEW";
    const calls = mockFetch((c) => {
      if (c.path.endsWith("/review_board")) return { body: board(status) };
      if (c.path.endsWith("/review")) {
        status = "APPROVED";
        return { body: board(status) };
      }
      if (c.path.endsWith("/rebalance")) return { body: optimization };
    });
    render(<PeerReview />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/review") && c.query.get("approve") === "7")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/rebalance"))).toBe(true));
    const exec = calls.find((c) => c.path.endsWith("/rebalance"))!;
    expect(exec.method).toBe("POST");
    expect(exec.query.get("review_id")).toBe("7");
    expect(exec.query.get("dryrun")).toBe("false");
  });

  it("Peer review is read-only for non-admins", async () => {
    session.set({ authenticated: true, mode: "local", user: "ana", role: "operator" });
    mockFetch(() => ({ body: pending }));
    render(<PeerReview />);
    expect((await screen.findByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
