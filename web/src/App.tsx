import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
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
import { refreshSession, useSession } from "./session";
import { applyTheme, cluster as clusterStore, setCluster, setTheme, theme, useStore, type Theme } from "./store";

interface Route {
  path: string;
  title: string;
  group: string;
  view: () => ComponentChildren;
}

export const ROUTES: Route[] = [
  { path: "/summary", title: "Summary", group: "Overview", view: () => <Summary /> },
  { path: "/state", title: "Cluster state", group: "Overview", view: () => <ClusterState /> },
  { path: "/cc-state", title: "Cruise Control state", group: "Overview", view: () => <CCState /> },
  { path: "/config", title: "Config insights", group: "Overview", view: () => <ConfigInsights /> },
  { path: "/load", title: "Load", group: "Load", view: () => <Load /> },
  { path: "/partition-load", title: "Partition load", group: "Load", view: () => <PartitionLoad /> },
  { path: "/proposals", title: "Proposals", group: "Operations", view: () => <Proposals /> },
  { path: "/admin", title: "Admin", group: "Operations", view: () => <Admin /> },
  { path: "/review", title: "Peer review", group: "Operations", view: () => <PeerReview /> },
  { path: "/tasks", title: "User tasks", group: "Tasks", view: () => <UserTasks /> },
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
  return (
    <div class="cluster-select">
      <label for="cluster">Cluster</label>
      <select id="cluster" value={selected} onChange={(e) => setCluster((e.target as HTMLSelectElement).value)}>
        {groups.map((g) => (
          <optgroup key={g} label={g || "Ungrouped"}>
            {clusters
              .filter((c) => (c.group ?? "") === g)
              .map((c) => (
                <option key={c.name} value={c.name}>
                  {health[c.name] === "error" ? `${c.name} (unreachable)` : c.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <span class={`dot ${state ?? "unknown"}`} role="img" aria-label={state === "ok" ? "Cluster reachable" : state === "error" ? "Cluster unreachable" : "Checking cluster"} />
    </div>
  );
}

function Shell({ children }: { children: ComponentChildren }) {
  const s = useSession();
  const current = useStore(path);
  const t = useStore(theme);
  return (
    <div class="shell">
      <a class="skip" href="#main">
        Skip to content
      </a>
      <header class="topbar">
        <span class="brand">Cruise Control</span>
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
        <span class="who">
          {s?.user} <span class="badge">{s?.role}</span>
        </span>
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
      <nav class="sidebar" aria-label="Main">
        {GROUPS.map((g) => (
          <div key={g}>
            <h2>{g}</h2>
            <ul>
              {ROUTES.filter((r) => r.group === g).map((r) => (
                <li key={r.path}>
                  <Link href={r.path} aria-current={current === r.path ? "page" : undefined}>
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
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
  useEffect(() => {
    if (s?.authenticated && (current === "/" || !ROUTES.some((r) => r.path === current))) navigate("/summary");
  }, [s?.authenticated, current]);

  if (failed) return <p class="state error" role="alert">Could not reach the server: {failed}</p>;
  if (!s) return <p class="state" role="status">Loading...</p>;
  if (!s.authenticated) return <Login />;
  const route = ROUTES.find((r) => r.path === current);
  return <Shell>{selected ? route?.view() : <p class="state" role="status">Loading clusters...</p>}</Shell>;
}

