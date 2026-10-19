// The only module that talks to the server. The browser never sees Cruise Control credentials:
// requests go to /api/clusters/<name>/proxy/<endpoint> on the same origin.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Role = "viewer" | "operator" | "admin";

export interface Session {
  authenticated: boolean;
  mode: "none" | "local" | "oidc";
  user?: string;
  role?: Role;
  csrfToken?: string;
  providers?: string[];
}

export interface ClusterInfo {
  name: string;
  group?: string;
}

export type Params = Record<string, string | number | boolean | undefined>;

export interface CCResult {
  status: number;
  taskId?: string;
  data: any;
}

let csrfToken = "";
let onUnauthorized: () => void = () => {};

/** Called whenever the server answers 401 to anything but the login itself. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function call(method: string, url: string, init: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    signal: init.signal,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status === 401 && !url.endsWith("/api/login")) onUnauthorized();
  if (res.status >= 400) {
    const d = data as { error?: string; errorMessage?: string } | string | null;
    const msg = typeof d === "string" ? d : (d?.error ?? d?.errorMessage ?? res.statusText);
    throw new ApiError(res.status, msg || `HTTP ${res.status}`);
  }
  return { res, data };
}

export async function getSession(): Promise<Session> {
  const { data } = await call("GET", "/api/session");
  const s = data as Session;
  csrfToken = s.csrfToken ?? "";
  return s;
}

export async function login(username: string, password: string): Promise<void> {
  await call("POST", "/api/login", { body: { username, password } });
}

export async function logout(): Promise<void> {
  await call("POST", "/api/logout");
}

export async function getClusters(): Promise<ClusterInfo[]> {
  const { data } = await call("GET", "/api/clusters");
  return data as ClusterInfo[];
}

export function buildQuery(params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  return q.toString();
}

export interface CCOptions {
  method?: "GET" | "POST";
  taskId?: string;
  signal?: AbortSignal;
}

/** One request to Cruise Control. A 202 comes back as a result with the User-Task-ID to poll with. */
export async function cc(cluster: string, endpoint: string, params: Params = {}, opts: CCOptions = {}): Promise<CCResult> {
  const q = buildQuery(params);
  const url = `/api/clusters/${encodeURIComponent(cluster)}/proxy/${endpoint}${q ? `?${q}` : ""}`;
  const headers: Record<string, string> = {};
  if (opts.taskId) headers["User-Task-ID"] = opts.taskId;
  const { res, data } = await call(opts.method ?? "GET", url, { headers, signal: opts.signal });
  return { status: res.status, taskId: res.headers.get("User-Task-ID") ?? undefined, data };
}

export interface WaitOptions extends CCOptions {
  delayMs?: number;
  /** Called for every 202 with the task id and CC's progress body. */
  onProgress?: (r: CCResult) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/** Repeats the same request with its User-Task-ID until Cruise Control answers something other than 202. */
export async function ccWait(cluster: string, endpoint: string, params: Params = {}, opts: WaitOptions = {}): Promise<CCResult> {
  let r = await cc(cluster, endpoint, params, opts);
  while (r.status === 202 && r.taskId) {
    opts.onProgress?.(r);
    await sleep(opts.delayMs ?? 2000, opts.signal);
    r = await cc(cluster, endpoint, params, { ...opts, taskId: r.taskId });
  }
  return r;
}
