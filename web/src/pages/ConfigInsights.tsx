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
      />
      <h2>Permissions reported by the selected cluster</h2>
      {perms.error && !perms.data ? <p class="state error">{perms.error.message}</p> : perms.data ? <KeyValues obj={perms.data} /> : <p class="muted">Loading...</p>}
    </section>
  );
}
