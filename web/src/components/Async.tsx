import type { ComponentChildren } from "preact";
import { ApiError } from "../api";
import type { Resource } from "../hooks";
import { refreshSeconds, setRefresh, useStore } from "../store";

const INTERVALS: [number, string][] = [
  [0, "Off"],
  [10, "10 s"],
  [30, "30 s"],
  [60, "1 min"],
  [300, "5 min"],
];

export function RefreshBar(props: { updatedAt?: Date; loading?: boolean; onReload: () => void }) {
  const seconds = useStore(refreshSeconds);
  return (
    <div class="refresh">
      <span class="muted" aria-live="polite">
        {props.loading ? "Loading..." : props.updatedAt ? `Updated ${props.updatedAt.toLocaleTimeString()}` : ""}
      </span>
      <button type="button" onClick={props.onReload}>
        Refresh
      </button>
      <label>
        Auto-refresh{" "}
        <select value={String(seconds)} onChange={(e) => setRefresh(Number((e.target as HTMLSelectElement).value))}>
          {INTERVALS.map(([v, l]) => (
            <option key={v} value={String(v)}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Page frame: title, refresh controls and distinct loading, error and empty states. */
export function Async<T>(props: { title: string; res: Resource<T>; empty?: (data: T) => boolean; controls?: ComponentChildren; children: (data: T) => ComponentChildren }) {
  const { res } = props;
  let body: ComponentChildren;
  if (res.error && !res.data) {
    const e = res.error;
    const status = e instanceof ApiError ? e.status : 0;
    body = (
      <div class="state error" role="alert">
        <strong>{status === 403 ? "You do not have permission to see this." : "Could not load this page."}</strong>
        <p>{e.message}</p>
        {status !== 403 && (
          <button type="button" onClick={res.reload}>
            Retry
          </button>
        )}
      </div>
    );
  } else if (res.data === undefined) {
    body = (
      <p class="state" role="status">
        Loading...
      </p>
    );
  } else if (props.empty?.(res.data)) {
    body = <p class="state muted">Nothing to show.</p>;
  } else {
    body = props.children(res.data);
  }
  return (
    <section aria-labelledby="page-title">
      <div class="page-head">
        <h1 id="page-title">{props.title}</h1>
        <RefreshBar updatedAt={res.updatedAt} loading={res.loading} onReload={res.reload} />
      </div>
      {res.error && res.data !== undefined && (
        <p class="state error" role="alert">
          Last refresh failed: {res.error.message}
        </p>
      )}
      {props.controls}
      {body}
    </section>
  );
}
