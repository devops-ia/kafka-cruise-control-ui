import { vi } from "vitest";

export interface Call {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
}

export interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Replaces fetch. The handler sees each call and answers; unhandled calls get 404 so tests fail loudly. */
export function mockFetch(handler: (c: Call, n: number) => Reply | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const u = new URL(input, "http://localhost");
      const call: Call = { method: init.method ?? "GET", url: input, path: u.pathname, query: u.searchParams, headers: new Headers(init.headers) };
      calls.push(call);
      const r = handler(call, calls.length) ?? { status: 404, body: { error: "unhandled in test" } };
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
    }),
  );
  return calls;
}

export const proxyPath = (cluster: string, endpoint: string) => `/api/clusters/${cluster}/proxy/${endpoint}`;
