import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { ResultDialog } from "./components/Dialog";
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

  it("Peer review shows a neutral note when two-step verification is disabled, whatever the status", async () => {
    mockFetch((c) =>
      c.path.endsWith("/review_board")
        ? { status: 403, body: { errorMessage: "Attempt to access REVIEW_BOARD endpoint without enabling 'two.step.verification.enabled' config." } }
        : undefined,
    );
    render(<PeerReview />);
    expect(await screen.findByText(/Two-step verification is disabled on this cluster/)).toBeTruthy();
    expect(screen.queryByText(/Attempt to access/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Peer review still shows other errors with the usual state", async () => {
    mockFetch((c) => (c.path.endsWith("/review_board") ? { status: 502, body: { error: "cluster unavailable" } } : undefined));
    render(<PeerReview />);
    expect(await screen.findByText(/cluster unavailable/)).toBeTruthy();
    expect(screen.queryByText(/Two-step verification is disabled/)).toBeNull();
  });
});

describe("result dialog", () => {
  const done = { id: 1, endpoint: "rebalance", cluster: "a", dryrun: "true", state: "done", result: optimization } as unknown as ReturnType<typeof tasks.get>[number];

  it("opens the result in a modal dialog with Close and Dismiss, and no inline result", () => {
    tasks.set([done]);
    render(<TaskPanel />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.textContent).toMatch(/rebalance/);
    expect(dlg.textContent).toMatch(/dry run/);
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Dismiss" }).length).toBe(2);
    expect(screen.queryByRole("button", { name: "Hide result" })).toBeNull();
  });

  it("Close and Escape keep the task and return focus to Show result", () => {
    tasks.set([done]);
    render(<TaskPanel />);
    const show = screen.getByRole("button", { name: "Show result" });
    show.focus();
    fireEvent.click(show);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tasks.get()).toHaveLength(1);
    expect(document.activeElement).toBe(show);
    fireEvent.click(show);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tasks.get()).toHaveLength(1);
  });

  it("Escape returns focus to the opener", () => {
    tasks.set([done]);
    render(<TaskPanel />);
    const show = screen.getByRole("button", { name: "Show result" });
    show.focus();
    fireEvent.click(show);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(show);
  });

  it("Dismiss in the dialog moves focus to the Operations heading, not the body", () => {
    tasks.set([done, { ...done, id: 2 }]);
    render(<TaskPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Show result" })[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Dismiss" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Operations" }));
  });

  it("Tab wraps over inputs and skips disabled controls, both ways", () => {
    render(
      <ResultDialog title="t" onClose={() => {}} onDismiss={() => {}}>
        <input aria-label="filter" />
        <button type="button" disabled>
          off
        </button>
      </ResultDialog>,
    );
    const dlg = screen.getByRole("dialog");
    const filter = screen.getByLabelText("filter");
    filter.focus();
    fireEvent.keyDown(dlg, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(dlg, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(filter);
  });

  it("Dismiss in the dialog closes it and removes the task", () => {
    tasks.set([done]);
    render(<TaskPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    const dlg = screen.getByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tasks.get()).toHaveLength(0);
  });

  it("a running task has neither Show result nor Dismiss; an error task keeps Dismiss", () => {
    tasks.set([{ ...done, state: "running", result: undefined }]);
    const { rerender } = render(<TaskPanel />);
    expect(screen.queryByRole("button", { name: "Show result" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    tasks.set([{ ...done, state: "error", error: "boom", result: undefined }]);
    rerender(<TaskPanel />);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
