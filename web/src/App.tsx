import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { cc, logout } from "./api";
import { loadClusters, useClusters } from "./clusters";
import { TaskPanel } from "./components/TaskPanel";
import { Admin } from "./pages/Admin";
import { CCState } from "./pages/CCState";
import { ClusterState } from "./pages/ClusterState";
import { ConfigInsights } from "./pages/ConfigInsights";
import { Load } from "./pages/Load";
import { Login } from "./pages/Login";
import { PartitionLoad } from "./pages/PartitionLoad";
import { PeerReview } from "./pages/PeerReview";
import { Proposals } from "./pages/Proposals";
import { Summary } from "./pages/Summary";
import { UserTasks } from "./pages/UserTasks";
import { Link, navigate, path } from "./router";
import { isAdmin, refreshSession, useSession } from "./session";
import { applyTheme, cluster as clusterStore, setCluster, setTheme, theme, useStore, type Theme } from "./store";
import { probeTwoStep, twoStep } from "./twostep";

interface Route {
  path: string;
  title: string;
  group: string;
  /** Needs the admin role; a viewer only gets Overview and Load. */
  admin?: boolean;
  view: () => ComponentChildren;
}

export const ROUTES: Route[] = [
  { path: "/summary", title: "Summary", group: "Overview", view: () => <Summary /> },
  { path: "/state", title: "Cluster state", group: "Overview", view: () => <ClusterState /> },
  { path: "/cc-state", title: "Cruise Control state", group: "Overview", view: () => <CCState /> },
  { path: "/config", title: "Config insights", group: "Overview", view: () => <ConfigInsights /> },
  { path: "/load", title: "Load", group: "Load", view: () => <Load /> },
  { path: "/partition-load", title: "Partition load", group: "Load", view: () => <PartitionLoad /> },
  { path: "/proposals", title: "Proposals", group: "Operations", admin: true, view: () => <Proposals /> },
  { path: "/admin", title: "Admin", group: "Operations", admin: true, view: () => <Admin /> },
  { path: "/review", title: "Peer review", group: "Operations", admin: true, view: () => <PeerReview /> },
  { path: "/tasks", title: "User tasks", group: "Tasks", admin: true, view: () => <UserTasks /> },
];

const GROUPS = ["Overview", "Load", "Operations", "Tasks"];

/** One dot per cluster, refreshed every 30 s: a cheap `state` call tells reachable from unreachable. */
function useHealth(): Record<string, "ok" | "error"> {
  const clusters = useClusters();
  const [health, setHealth] = useState<Record<string, "ok" | "error">>({});
  useEffect(() => {
    let stop = false;
    const check = () =>
      clusters.forEach((c) =>
        cc(c.name, "state", { substates: "EXECUTOR" })
          .then(() => !stop && setHealth((h) => ({ ...h, [c.name]: "ok" })))
          .catch(() => !stop && setHealth((h) => ({ ...h, [c.name]: "error" }))),
      );
    check();
    const t = setInterval(check, 30000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [clusters]);
  return health;
}

function ClusterSelect() {
  const clusters = useClusters();
  const selected = useStore(clusterStore);
  const health = useHealth();
  const groups = [...new Set(clusters.map((c) => c.group ?? ""))];
  const state = health[selected];
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const text = (name: string) => (health[name] === "error" ? `${name} (unreachable)` : name);
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...(box.current?.querySelectorAll<HTMLElement>(".cluster-list button") ?? [])];
      items[items.indexOf(document.activeElement as HTMLElement) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    }
  };

  return (
    <div
      ref={box}
      class="cluster-select"
      onKeyDown={onKey}
      // Null relatedTarget is a click in Safari/Firefox on macOS (buttons do not take focus); the pointerdown listener handles clicks.
      onFocusOut={(e) => open && e.relatedTarget && !box.current?.contains(e.relatedTarget as Node) && setOpen(false)}
    >
      {/* No "for": a native label would replace the button's own text in its aria-labelledby name. */}
      <label id="cluster-label">Cluster</label>
      <button ref={toggle} type="button" id="cluster" aria-labelledby="cluster-label cluster" aria-expanded={open} onClick={() => setOpen(!open)}>
        {text(selected)}
      </button>
      {open && (
        <div class="cluster-list">
          {groups.map((g, i) => (
            <div key={g} role="group" aria-labelledby={`cluster-group-${i}`}>
              <div id={`cluster-group-${i}`} class="cluster-group">
                {g || "Ungrouped"}
              </div>
              {clusters
                .filter((c) => (c.group ?? "") === g)
                .map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    aria-current={c.name === selected ? "true" : undefined}
                    onClick={() => {
                      setCluster(c.name);
                      close();
                    }}
                  >
                    {text(c.name)}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
      <span class={`dot ${state ?? "unknown"}`} role="img" aria-label={state === "ok" ? "Cluster reachable" : state === "error" ? "Cluster unreachable" : "Checking cluster"} />
    </div>
  );
}

function Forbidden({ title }: { title: string }) {
  const s = useSession();
  return (
    <section aria-labelledby="page-title">
      <div class="page-head">
        <h1 id="page-title">403 Forbidden</h1>
      </div>
      <p class="state error" role="alert">
        Your role ({s?.role ?? "unknown"}) cannot open {title}. It needs the admin role.
      </p>
    </section>
  );
}

/** CCUI_LOGO_URL as the server wrote it into the icon link; undefined keeps the built-in mark. */
const logo = () => {
  const href = document.querySelector('link[rel="icon"]')?.getAttribute("href");
  return href && href !== "/logo.svg" ? href : undefined;
};

function Shell({ children }: { children: ComponentChildren }) {
  const s = useSession();
  const current = useStore(path);
  const t = useStore(theme);
  const off = useStore(twoStep)[useStore(clusterStore)] === "off";
  return (
    <div class="shell">
      <a class="skip" href="#main">
        Skip to content
      </a>
      <nav class="sidebar" aria-label="Main">
        <div class="brand">
          {logo() ? <img class="mark logo" src={logo()} alt="" /> : <span class="mark" aria-hidden="true" />}
          <div>
            Cruise Control
            <small class="build">{import.meta.env.VITE_VERSION || "dev"}</small>
          </div>
        </div>
        {GROUPS.map((g) => ({ g, routes: ROUTES.filter((r) => r.group === g && (!r.admin || isAdmin(s)) && !(off && r.path === "/review")) }))
          .filter(({ routes }) => routes.length > 0)
          .map(({ g, routes }) => (
            <div key={g}>
              <h2>{g}</h2>
              <ul>
                {routes.map((r) => (
                  <li key={r.path}>
                    <Link href={r.path} aria-current={current === r.path ? "page" : undefined}>
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        <div class="who">
          <span>{s?.user}</span> <span class="badge">{s?.role}</span>
        </div>
      </nav>
      <header class="topbar">
        <ClusterSelect />
        <div class="spacer" />
        <label>
          Theme{" "}
          <select value={t} onChange={(e) => setTheme((e.target as HTMLSelectElement).value as Theme)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        {s?.mode !== "none" && (
          <button
            type="button"
            onClick={async () => {
              await logout();
              await refreshSession();
            }}
          >
            Sign out
          </button>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <TaskPanel />
    </div>
  );
}

export function App() {
  const s = useSession();
  const current = useStore(path);
  const [failed, setFailed] = useState("");
  const selected = useStore(clusterStore);

  useEffect(() => {
    applyTheme(theme.get());
    refreshSession().catch((e: Error) => setFailed(e.message));
  }, []);
  useEffect(() => {
    if (s?.authenticated) loadClusters().catch((e: Error) => setFailed(e.message));
  }, [s?.authenticated]);
  // Admin only: the proxy refuses review_board to a viewer. Runs again on every cluster change.
  useEffect(() => {
    if (s?.authenticated && isAdmin(s) && selected) probeTwoStep(selected);
  }, [s?.authenticated, s?.role, selected]);
  useEffect(() => {
    if (s?.authenticated && (current === "/" || !ROUTES.some((r) => r.path === current))) navigate("/summary");
  }, [s?.authenticated, current]);

  if (failed) return <p class="state error" role="alert">Could not reach the server: {failed}</p>;
  if (!s) return <p class="state" role="status">Loading...</p>;
  if (!s.authenticated) return <Login />;
  const route = ROUTES.find((r) => r.path === current);
  // The guard renders no view for a viewer, so no request for the page goes out; the server enforces the same rule.
  const body = route?.admin && !isAdmin(s) ? <Forbidden title={route.title} /> : selected ? route?.view() : <p class="state" role="status">Loading clusters...</p>;
  return <Shell>{body}</Shell>;
}

