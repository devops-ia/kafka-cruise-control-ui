import { Async } from "../components/Async";
import { Table } from "../components/Table";
import { formatTime } from "../format";
import { useResource } from "../hooks";
import { parseEndpointWithParams } from "../ops";
import { atLeast, useSession } from "../session";
import { cluster as clusterStore, useStore } from "../store";
import { runTask } from "../tasks";


function Actions({ r, reload }: { r: any; reload: () => void }) {
  const session = useSession();
  const cluster = useStore(clusterStore);
  const isAdmin = atLeast(session, "admin");
  const id = String(r.Id);
  const review = async (verb: "approve" | "discard") => {
    await runTask(cluster, "review", { [verb]: id });
    reload();
  };
  const execute = async () => {
    const { endpoint, params } = parseEndpointWithParams(String(r.EndpointWithParams));
    await runTask(cluster, endpoint, { ...params, review_id: id });
    reload();
  };
  return (
    <span class="actions">
      {r.Status === "PENDING_REVIEW" && (
        <button type="button" disabled={!isAdmin} onClick={() => review("approve")}>
          Approve
        </button>
      )}
      {r.Status === "APPROVED" && (
        <button type="button" class="danger" disabled={!isAdmin} onClick={execute}>
          Execute
        </button>
      )}
      {(r.Status === "PENDING_REVIEW" || r.Status === "APPROVED") && (
        <button type="button" disabled={!isAdmin} onClick={() => review("discard")}>
          Discard
        </button>
      )}
    </span>
  );
}

export function PeerReview() {
  const res = useResource("review_board");
  const session = useSession();
  return (
    <Async title="Peer review" res={res} empty={(d) => !d.RequestInfo?.length}>
      {(d) => (
        <div class="stack">
          {!atLeast(session, "admin") && <p class="state warn">Reviewing and executing requests needs the admin role.</p>}
          <Table
            caption="Requests waiting for review"
            rows={d.RequestInfo}
            rowKey={(r: any) => r.Id}
            columns={[
              { key: "id", header: "Review ID", value: (r: any) => r.Id, numeric: true },
              { key: "status", header: "Status", value: (r: any) => r.Status, render: (r: any) => <span class="badge">{r.Status}</span> },
              { key: "req", header: "Request", value: (r: any) => r.EndpointWithParams },
              { key: "by", header: "Submitted by", value: (r: any) => r.SubmitterAddress },
              { key: "at", header: "Submitted", value: (r: any) => r.SubmissionTimeMs, render: (r: any) => formatTime(r.SubmissionTimeMs) },
              { key: "reason", header: "Reason", value: (r: any) => r.Reason ?? "" },
              { key: "act", header: "Actions", value: () => "", render: (r: any) => <Actions r={r} reload={res.reload} /> },
            ]}
          />
        </div>
      )}
    </Async>
  );
}
