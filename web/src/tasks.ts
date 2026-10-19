import { ApiError, ccWait, type CCResult, type Params } from "./api";
import { createStore, useStore } from "./store";

export type TaskState = "running" | "done" | "review" | "error";

export interface Task {
  id: number;
  cluster: string;
  endpoint: string;
  dryrun?: string;
  /** CC's User-Task-ID, known after the first 202. */
  taskId?: string;
  state: TaskState;
  /** Latest progress line while running. */
  progress?: string;
  percent?: number;
  result?: unknown;
  error?: string;
  /** Set when CC parked the request for peer review (two-step verification). */
  reviewId?: number;
  startedAt: number;
}

export const tasks = createStore<Task[]>([]);
export const useTasks = () => useStore(tasks);

let seq = 0;
export const pollDelayMs = { value: 2000 };

function patch(id: number, p: Partial<Task>) {
  tasks.set(tasks.get().map((t) => (t.id === id ? { ...t, ...p } : t)));
}

// CC's 202 body: {progress:[{operation, operationProgress:[{step, description, completionPercentage?}]}]}
function describeProgress(data: any): { text?: string; percent?: number } {
  const steps = data?.progress?.[0]?.operationProgress;
  const last = Array.isArray(steps) ? steps[steps.length - 1] : undefined;
  if (!last) return {};
  const pct = typeof last.completionPercentage === "number" ? last.completionPercentage : undefined;
  return { text: [last.step, last.description].filter(Boolean).join(": "), percent: pct === undefined ? undefined : Math.round(pct * 100) };
}

/** Review id of a request CC parked for approval, if the response is one. */
export function pendingReviewId(data: any): number | undefined {
  const info = Array.isArray(data?.RequestInfo) ? data.RequestInfo : data?.RequestInfo ? [data.RequestInfo] : [];
  const pending = info.find((r: any) => r?.Status === "PENDING_REVIEW");
  return typeof pending?.Id === "number" ? pending.Id : undefined;
}

/**
 * Runs a POST (or GET) on the global task list. Async CC operations show up in the panel as soon as CC
 * answers 202 and are repeated with their User-Task-ID until the final 200.
 */
export async function runTask(cluster: string, endpoint: string, params: Params, method: "GET" | "POST" = "POST"): Promise<CCResult | undefined> {
  const id = ++seq;
  const dryrun = params.dryrun === undefined ? undefined : String(params.dryrun);
  tasks.set([{ id, cluster, endpoint, dryrun, state: "running", startedAt: Date.now() }, ...tasks.get()]);
  try {
    const r = await ccWait(cluster, endpoint, params, {
      method,
      delayMs: pollDelayMs.value,
      onProgress: (p) => {
        const d = describeProgress(p.data);
        patch(id, { taskId: p.taskId, progress: d.text, percent: d.percent });
      },
    });
    const reviewId = pendingReviewId(r.data);
    patch(id, reviewId === undefined ? { state: "done", result: r.data, ...(r.taskId && { taskId: r.taskId }) } : { state: "review", reviewId, result: r.data });
    return r;
  } catch (e) {
    patch(id, { state: "error", error: e instanceof ApiError || e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

export function dismissTask(id: number): void {
  tasks.set(tasks.get().filter((t) => t.id !== id));
}
