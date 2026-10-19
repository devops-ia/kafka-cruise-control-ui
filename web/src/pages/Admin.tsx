import { useRef, useState } from "preact/hooks";
import { ConfirmDialog } from "../components/Dialog";
import { useGoals } from "../goals";
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

function FieldInput({ f, values, set }: { f: Field; values: Values; set: (name: string, v: string | boolean) => void }) {
  const id = `f-${f.name}`;
  if (f.kind === "goals") {
    return (
      <div class="field">
        <span class="label">{f.label}</span>
        <GoalPicker value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} />
        {f.help && <small class="muted">{f.help}</small>}
      </div>
    );
  }
  if (f.kind === "bool") {
    return (
      <label class="check field">
        <input type="checkbox" name={f.name} checked={values[f.name] === true} onChange={(e) => set(f.name, (e.target as HTMLInputElement).checked)} /> {f.label}
      </label>
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
        {f.required && <span aria-hidden="true"> *</span>}
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
  const form = useRef<HTMLFormElement>(null);

  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }));

  const run = (dryrun: boolean | undefined) => {
    if (!form.current?.reportValidity()) return;
    void runTask(cluster, op.endpoint, buildParams(op, values, dryrun));
  };
  const execute = () => (op.confirm ? setConfirming(true) : run(op.dryRunnable ? false : undefined));

  return (
    <form ref={form} class="stack op-form" onSubmit={(e) => e.preventDefault()} aria-labelledby="op-title">
      <h2 id="op-title">{op.title}</h2>
      <p>{op.description}</p>
      {op.fields.map((f) => (
        <FieldInput key={f.name} f={f} values={values} set={set} />
      ))}
      <div class="actions">
        {op.dryRunnable && (
          <button type="button" onClick={() => run(true)}>
            Simulate
          </button>
        )}
        <button type="button" class="danger" onClick={execute}>
          {op.dryRunnable ? "Execute" : "Apply"}
        </button>
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

export function Admin() {
  const [id, setId] = useState(OPERATIONS[0].id);
  const op = OPERATIONS.find((o) => o.id === id)!;
  return (
    <section aria-labelledby="page-title">
      <div class="page-head">
        <h1 id="page-title">Admin</h1>
      </div>
      <div class="admin-layout">
        <nav aria-label="Operations" class="op-list">
          <ul>
            {OPERATIONS.map((o) => (
              <li key={o.id}>
                <button type="button" aria-current={o.id === id ? "true" : undefined} onClick={() => setId(o.id)}>
                  {o.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <OperationForm key={op.id} op={op} />
      </div>
    </section>
  );
}
