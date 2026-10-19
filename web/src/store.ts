import { useEffect, useState } from "preact/hooks";

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      subs.forEach((f) => f());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  const [v, setV] = useState(store.get());
  useEffect(() => {
    setV(store.get());
    return store.subscribe(() => setV(store.get()));
  }, [store]);
  return v;
}

// Preferences live in localStorage; every read tolerates a blocked or empty storage.
export function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference only lasts for this visit */
  }
}

export type Theme = "system" | "light" | "dark";

export const cluster = createStore(readPref("ccui.cluster", ""));
export const refreshSeconds = createStore(Number(readPref("ccui.refresh", "0")) || 0);
export const theme = createStore<Theme>(readPref("ccui.theme", "system") as Theme);

export function setCluster(name: string): void {
  writePref("ccui.cluster", name);
  cluster.set(name);
}

export function setRefresh(seconds: number): void {
  writePref("ccui.refresh", String(seconds));
  refreshSeconds.set(seconds);
}

export function setTheme(t: Theme): void {
  writePref("ccui.theme", t);
  theme.set(t);
  applyTheme(t);
}

export function applyTheme(t: Theme): void {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
