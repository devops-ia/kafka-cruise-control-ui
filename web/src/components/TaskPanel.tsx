import { useState } from "preact/hooks";
import { dismissTask, useTasks } from "../tasks";
import { OptimizationView } from "./Results";

/** Global list of asynchronous operations. It lives outside the pages, so tasks stay visible while navigating. */
export function TaskPanel() {
  const tasks = useTasks();
  const [open, setOpen] = useState<number | undefined>();
  if (tasks.length === 0) return null;
  return (
    <aside class="task-panel" aria-label="Operations">
      <h2>Operations</h2>
      <ul>
        {tasks.map((t) => (
          <li key={t.id} class={`task ${t.state}`}>
            <div class="task-head">
              <strong>{t.endpoint}</strong> on {t.cluster}
              {t.dryrun === "true" && <span class="badge">dry run</span>}
              <span class={`badge ${t.state === "error" ? "bad" : t.state === "done" ? "ok" : ""}`}>
                {t.state === "running" ? "running" : t.state === "review" ? `waiting for review #${t.reviewId}` : t.state}
              </span>
            </div>
            {t.taskId && <div class="muted mono">{t.taskId}</div>}
            {t.state === "running" && (
              <div class="muted" role="status">
                {t.progress ?? "starting"}
                {t.percent !== undefined && ` (${t.percent}%)`}
              </div>
            )}
            {t.error && <div class="state error">{t.error}</div>}
            <div class="task-actions">
              {t.result !== undefined && (
                <button type="button" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? undefined : t.id)}>
                  {open === t.id ? "Hide result" : "Show result"}
                </button>
              )}
              {t.state !== "running" && (
                <button type="button" onClick={() => dismissTask(t.id)}>
                  Dismiss
                </button>
              )}
            </div>
            {open === t.id && <OptimizationView data={t.result} />}
          </li>
        ))}
      </ul>
    </aside>
  );
}
