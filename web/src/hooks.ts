import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiError, ccWait, type Params } from "./api";
import { cluster as clusterStore, refreshSeconds, useStore } from "./store";

export interface Resource<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  updatedAt: Date | undefined;
  reload: () => void;
}

/**
 * Loads a read-only CC endpoint for the selected cluster and repeats it on the chosen refresh interval.
 * GET endpoints that CC answers with 202 are followed until they complete.
 */
export function useResource<T = any>(endpoint: string, params: Params = {}, clusterName?: string): Resource<T> {
  const selected = useStore(clusterStore);
  const name = clusterName ?? selected;
  const seconds = useStore(refreshSeconds);
  const [state, setState] = useState<Omit<Resource<T>, "reload">>({ data: undefined, error: undefined, loading: true, updatedAt: undefined });
  const key = JSON.stringify([name, endpoint, params]);
  const abort = useRef<AbortController | undefined>(undefined);

  const load = useCallback(() => {
    if (!name) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setState((s) => ({ ...s, loading: true }));
    ccWait(name, endpoint, params, { signal: ctl.signal, delayMs: 1500 })
      .then((r) => setState({ data: r.data, error: undefined, loading: false, updatedAt: new Date() }))
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setState((s) => ({ ...s, error: e instanceof ApiError ? e : new Error(String(e)), loading: false }));
      });
  }, [key]);

  useEffect(() => {
    setState({ data: undefined, error: undefined, loading: true, updatedAt: undefined });
    load();
    return () => abort.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!seconds) return;
    const t = setInterval(load, seconds * 1000);
    return () => clearInterval(t);
  }, [load, seconds]);

  return { ...state, reload: load };
}
