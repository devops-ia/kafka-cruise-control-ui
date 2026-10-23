import { useEffect, useRef, useState } from "preact/hooks";
import { dismissTask, useTasks } from "../tasks";
import { ResultDialog } from "./Dialog";
import { OptimizationView } from "./Results";

/** Global list of asynchronous operations. It lives outside the pages, so tasks stay visible while navigating. */
export function TaskPanel() {
  const tasks = useTasks();
  const [open, setOpen] = useState<number | undefined>();
  const heading = useRef<HTMLHeadingElement>(null);
  const refocus = useRef(false);
  // The opener is gone after Dismiss in the dialog; park focus on the panel heading instead of the body.
  useEffect(() => {
    if (refocus.current) heading.current?.focus();
    refocus.current = false;
  });
  // A finished run (dry run or not) closes itself after 5 s; errors and reviews stay until Dismiss. The pointer on the
  // panel pauses every timer, focus inside it puts the close off by another 5 s, and nothing closes under its open result.
  const [hover, setHover] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const schedule = (id: number) =>
    timers.current.set(
      id,
      setTimeout(() => {
        if (panel.current?.contains(document.activeElement)) return schedule(id);
        timers.current.delete(id);
        dismissTask(id);
      }, 5000),
    );
  useEffect(() => {
    for (const t of tasks) {
      const auto = t.state === "done" && t.id !== open && !hover;
      if (auto && !timers.current.has(t.id)) schedule(t.id);
      if (!auto && timers.current.has(t.id)) {
        clearTimeout(timers.current.get(t.id));
        timers.current.delete(t.id);
      }
    }
  }, [tasks, open, hover]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  if (tasks.length === 0) return null;
  return (
    <aside ref={panel} class="task-panel" aria-label="Operations" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <h2 ref={heading} tabIndex={-1}>
        Operations
      </h2>
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
                <button type="button" onClick={() => setOpen(t.id)}>
                  Show result
                </button>
              )}
              {t.state !== "running" && (
                <button type="button" onClick={() => dismissTask(t.id)}>
                  Dismiss
                </button>
              )}
            </div>
            {open === t.id && (
              <ResultDialog
                title={
                  <>
                    {t.endpoint} on {t.cluster}
                    {t.dryrun === "true" && <span class="badge">dry run</span>}
                  </>
                }
                onClose={() => setOpen(undefined)}
                onDismiss={
                  t.state !== "running"
                    ? () => {
                        refocus.current = true;
                        dismissTask(t.id);
                      }
                    : undefined
                }
              >
                <OptimizationView data={t.result} />
              </ResultDialog>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
