import { ApiError } from "../api";
import { useClusters } from "../clusters";
import { RefreshBar } from "../components/Async";
import { KeyValues } from "../components/KeyValues";
import { Table } from "../components/Table";
import { useResource } from "../hooks";
import { useSession } from "../session";

/** What the server was configured with, as far as the browser may know: clusters and the signed-in identity. Never URLs or credentials. */
export function ConfigInsights() {
  const clusters = useClusters();
  const s = useSession();
  const perms = useResource("permissions");
  // CC answers 400 here when it runs without security; that is a state of the cluster, not a failure.
  const unsecured = perms.error instanceof ApiError && perms.error.status === 400 && /unsecure connection/i.test(perms.error.message);
  return (
    <section aria-labelledby="page-title" class="stack">
      <div class="page-head">
        <h1 id="page-title">Config insights</h1>
        <RefreshBar updatedAt={perms.updatedAt} loading={perms.loading} onReload={perms.reload} />
      </div>
      <h2>This session</h2>
      <KeyValues obj={{ user: s?.user, role: s?.role, "authentication mode": s?.mode }} />
      <h2>Clusters</h2>
      <Table
        caption="Configured clusters"
        rows={clusters}
        rowKey={(c) => c.name}
        columns={[
          { key: "name", header: "Name", value: (c) => c.name },
          { key: "group", header: "Group", value: (c) => c.group ?? "" },
        ]}
        pageable
      />
      <h2>Permissions reported by the selected cluster</h2>
      {perms.data ? (
        <KeyValues obj={perms.data} />
      ) : unsecured ? (
        <p class="state">Security is disabled on this cluster, so there are no per-user permissions to show.</p>
      ) : perms.error ? (
        <div class="state error" role="alert">
          <p>{perms.error.message}</p>
          <button type="button" onClick={perms.reload}>
            Retry
          </button>
        </div>
      ) : (
        <p class="muted">Loading...</p>
      )}
    </section>
  );
}
