import { Async } from "../components/Async";
import { Table } from "../components/Table";
import { formatTime } from "../format";
import { useResource } from "../hooks";


export function UserTasks() {
  const res = useResource("user_tasks");
  return (
    <Async title="User tasks" res={res} empty={(d) => !d.userTasks?.length}>
      {(d) => (
        <Table
          caption="Cruise Control user tasks"
          rows={d.userTasks}
          rowKey={(r: any) => r.UserTaskId}
          columns={[
            { key: "start", header: "Started", value: (r: any) => r.StartMs, render: (r: any) => formatTime(r.StartMs) },
            { key: "status", header: "Status", value: (r: any) => r.Status, render: (r: any) => <span class={`badge ${r.Status === "CompletedWithError" ? "bad" : r.Status === "Completed" ? "ok" : ""}`}>{r.Status}</span> },
            { key: "url", header: "Request", value: (r: any) => r.RequestURL },
            { key: "client", header: "Client", value: (r: any) => r.ClientIdentity },
            { key: "id", header: "Task ID", value: (r: any) => r.UserTaskId, render: (r: any) => <span class="mono">{r.UserTaskId}</span> },
          ]}
        />
      )}
    </Async>
  );
}
