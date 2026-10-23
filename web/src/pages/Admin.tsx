import { useRef, useState } from "preact/hooks";
import { ConfirmDialog } from "../components/Dialog";
import { Table } from "../components/Table";
import { useGoals } from "../goals";
import { useResource } from "../hooks";
import { buildParams, OPERATIONS, type Field, type Operation, type Values } from "../ops";
import { cluster as clusterStore, useStore } from "../store";
import { runTask } from "../tasks";

function GoalPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { goals, error } = useGoals();
  const chosen = new Set(value.split(",").filter(Boolean));
  const toggle = (g: string) => {
    const next = new Set(chosen);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    onChange([...next].join(","));
  };
  if (error) return <p class="muted">Goals could not be read from the cluster: {error.message}</p>;
  if (!goals) return <p class="muted">Reading goals from the cluster...</p>;
  return (
    <div class="goal-groups">
      {(["hard", "soft"] as const).map((g) => (
        <fieldset key={g}>
          <legend>{g === "hard" ? "Hard goals" : "Soft goals"}</legend>
          {goals[g].length === 0 && <span class="muted">None</span>}
          {goals[g].map((name) => (
            <label key={name} class="check">
              <input type="checkbox" checked={chosen.has(name)} onChange={() => toggle(name)} /> {name}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/** Value is "brokerId-logdir" entries, comma separated, the format of brokerid_and_logdirs. A path with a comma is disabled, so split(",") never mis-parses. */
function LogDirPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const res = useResource("kafka_cluster_state");
  const chosen = new Set(value.split(",").filter(Boolean));
  const toggle = (k: string) => {
    const next = new Set(chosen);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange([...next].join(","));
  };
  if (res.error) return <p class="muted">Log dirs could not be read from the cluster: {res.error.message}</p>;
  if (!res.data) return <p class="muted">Reading log dirs from the cluster...</p>;
  const dirs: Record<string, string[]> = res.data.KafkaBrokerState?.OnlineLogDirsByBrokerId ?? {};
  const ids = Object.keys(dirs).sort((a, b) => Number(a) - Number(b));
  if (ids.length === 0) return <p class="muted">This cluster does not report any log dirs, so there is nothing to choose. Cruise Control needs a Kafka version that returns them.</p>;
  // One row per log dir in the shared table, so it filters, pages and grows down; the selection lives in value and survives both.
  const rows = ids.flatMap((id) => dirs[id].map((d) => ({ id, d, key: `${id}-${d}` })));
  return (
    <div class="stack logdirs">
      <p class="muted" aria-live="polite">
        {chosen.size} of {rows.length} log dirs selected
      </p>
      <Table
        caption="Log dirs"
        rows={rows}
        rowKey={(r) => r.key}
        pageable
        columns={[
          {
            key: "pick",
            header: "Remove",
            value: (r) => (chosen.has(r.key) ? 1 : 0),
            render: (r) => <input type="checkbox" aria-label={`Broker ${r.id} ${r.d}`} checked={chosen.has(r.key)} disabled={r.d.includes(",")} onChange={() => toggle(r.key)} />,
          },
          { key: "broker", header: "Broker", value: (r) => Number(r.id), numeric: true },
          {
            key: "dir",
            header: "Log dir",
            value: (r) => r.d,
            render: (r) => (
              <span class="logdir">
                {r.d}
                {r.d.includes(",") && <small class="muted"> (path contains a comma, cannot be selected)</small>}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

function FieldInput({ f, values, set }: { f: Field; values: Values; set: (name: string, v: string | boolean) => void }) {
  const id = `f-${f.name}`;
  if (f.kind === "goals") {
    return (
      <div class="field wide">
        <details class="goals">
          <summary>Goals, optional</summary>
          <GoalPicker value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} />
        </details>
        {f.help && <small class="muted">{f.help}</small>}
      </div>
    );
  }
  if (f.kind === "logdirs") {
    return (
      <div class="field wide">
        <LogDirPicker value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} />
      </div>
    );
  }
  if (f.kind === "bool") {
    return (
      <label class="check field wide">
        <input type="checkbox" name={f.name} checked={values[f.name] === true} onChange={(e) => set(f.name, (e.target as HTMLInputElement).checked)} /> {f.label}
      </label>
    );
  }
  if (f.kind === "select") {
    return (
      <div class="field">
        <label for={id}>{f.label}</label>
        <select id={id} name={f.name} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, (e.target as HTMLSelectElement).value)}>
          {f.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const common = {
    id,
    name: f.name,
    required: f.required,
    value: String(values[f.name] ?? ""),
    "aria-describedby": f.help ? `${id}-help` : undefined,
    onInput: (e: Event) => set(f.name, (e.target as HTMLInputElement).value),
  };
  return (
    <div class="field">
      <label for={id}>
        {f.label}
        {f.required && (
          <span class="req" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {f.kind === "number" ? <input {...common} type="number" min={0} /> : <input {...common} type="text" />}
      {f.help && (
        <small id={`${id}-help`} class="muted">
          {f.help}
        </small>
      )}
    </div>
  );
}

function OperationForm({ op }: { op: Operation }) {
  const cluster = useStore(clusterStore);
  const [values, setValues] = useState<Values>({});
  const [confirming, setConfirming] = useState(false);
  const [missing, setMissing] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const set = (name: string, v: string | boolean) => {
    setMissing(false);
    setValues((s) => ({ ...s, [name]: v }));
  };

  // Checkboxes have no native "required", so a required logdirs field is checked here.
  const lacksLogDirs = () => op.fields.some((f) => f.kind === "logdirs" && f.required && !values[f.name]);
  const run = (dryrun: boolean | undefined) => {
    if (!form.current?.reportValidity()) return;
    if (lacksLogDirs()) return setMissing(true);
    void runTask(cluster, op.endpoint, buildParams(op, values, dryrun));
  };
  const execute = () => (op.confirm && lacksLogDirs() ? setMissing(true) : op.confirm ? setConfirming(true) : run(op.dryRunnable ? false : undefined));

  return (
    <form ref={form} class="op-form" onSubmit={(e) => e.preventDefault()} aria-labelledby="op-title">
      <div class="panel-head op-head">
        <div>
          <h2 id="op-title">{op.title}</h2>
          <p class="muted">{op.description}</p>
        </div>
      </div>
      <div class="panel-body form-grid">
        {op.fields.map((f) => (
          <FieldInput key={f.name} f={f} values={values} set={set} />
        ))}
      </div>
      {missing && (
        <p role="alert" class="state error">
          Choose at least one log dir.
        </p>
      )}
      <div class="actions-bar">
        <div class="actions">
          {op.dryRunnable && (
            <button type="button" class="primary" onClick={() => run(true)}>
              Simulate
            </button>
          )}
          <button type="button" class="danger" onClick={execute}>
            {op.dryRunnable ? "Execute" : "Apply"}
          </button>
        </div>
        {op.dryRunnable && <small class="muted">Execute changes the real cluster, Simulate does not.</small>}
      </div>
      {confirming && (
        <ConfirmDialog
          title={`Execute "${op.title}"?`}
          confirmLabel={`Execute on ${cluster}`}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            run(false);
          }}
        >
          <p>
            This changes the real cluster <strong>{cluster}</strong> and cannot be undone from here.
          </p>
          <dl class="stats">
            <div>
              <dt>Operation</dt>
              <dd>{op.title}</dd>
            </div>
            <div>
              <dt>Cluster</dt>
              <dd>{cluster}</dd>
            </div>
            {values.brokerid_and_logdirs && (
              <div>
                <dt>Log dirs</dt>
                <dd>{String(values.brokerid_and_logdirs)}</dd>
              </div>
            )}
            {values.brokerid && (
              <div>
                <dt>Brokers</dt>
                <dd>{String(values.brokerid)}</dd>
              </div>
            )}
          </dl>
        </ConfirmDialog>
      )}
    </form>
  );
}

// Consecutive operations with the same group share one titled wrapper; an operation without a group gets its own.
const groups = OPERATIONS.reduce<Operation[][]>((gs, o) => {
  const last = gs[gs.length - 1];
  if (last && o.group && last[0].group === o.group) last.push(o);
  else gs.push([o]);
  return gs;
}, []);

export function Admin() {
  const cluster = useStore(clusterStore);
  const [id, setId] = useState(OPERATIONS[0].id);
  const list = useRef<HTMLDivElement>(null);
  const idx = OPERATIONS.findIndex((o) => o.id === id);
  const op = OPERATIONS[idx];
  // WAI-ARIA vertical tabs: Up/Down (and Left/Right) wrap, Home/End jump; focus follows selection.
  const onKeyDown = (e: KeyboardEvent) => {
    const n = OPERATIONS.length;
    const next = (idx + 1) % n;
    const prev = (idx + n - 1) % n;
    const to = { ArrowDown: next, ArrowRight: next, ArrowUp: prev, ArrowLeft: prev, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setId(OPERATIONS[to].id);
    (list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to])?.focus();
  };
  return (
    <section aria-labelledby="page-title">
      <div class="page-head">
        <h1 id="page-title">Admin</h1>
      </div>
      <div class="op-layout">
        <div class="op-nav" role="tablist" aria-label="Operations" aria-orientation="vertical" ref={list}>
          {groups.map((g) => (
            <div key={g[0].id} class="op-group" role="none">
              {g[0].group && (
                <span class="op-group-label" aria-hidden="true">
                  {g[0].group}
                </span>
              )}
              {g.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  id={`tab-${o.id}`}
                  aria-selected={o.id === id}
                  aria-controls="op-panel"
                  tabIndex={o.id === id ? 0 : -1}
                  onClick={() => setId(o.id)}
                  onKeyDown={onKeyDown}
                >
                  {o.title}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div class="panel op-panel" role="tabpanel" id="op-panel" aria-labelledby={`tab-${op.id}`}>
          <OperationForm key={`${cluster}:${op.id}`} op={op} />
        </div>
      </div>
    </section>
  );
}
