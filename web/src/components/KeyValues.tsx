import { JsonView } from "./Results";

/** Scalar fields as a definition list; nested values collapse into JSON so nothing CC reports is hidden. */
export function KeyValues({ obj }: { obj: Record<string, unknown> | undefined }) {
  if (!obj) return <p class="muted">No data.</p>;
  const scalars = Object.entries(obj).filter(([, v]) => v === null || typeof v !== "object");
  const nested = Object.entries(obj).filter(([, v]) => v !== null && typeof v === "object");
  return (
    <div class="stack">
      <dl class="stats">
        {scalars.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
      </dl>
      {nested.map(([k, v]) => (
        <details key={k}>
          <summary>{k}</summary>
          <JsonView data={v} />
        </details>
      ))}
    </div>
  );
}

export function Tabs<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="tabs" role="group" aria-label={props.label}>
      {props.options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
