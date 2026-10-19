import type { ComponentChildren } from "preact";

/** Bordered block with a small uppercase header and an optional summary tag on the right. */
export function Panel(props: { title: string; aside?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="panel" aria-label={props.title}>
      <div class="panel-head">
        <h2>{props.title}</h2>
        {props.aside}
      </div>
      <div class="panel-body">{props.children}</div>
    </section>
  );
}

/** Label/value rows; rows whose value is undefined are left out, so fields a CC version lacks do not leave holes. */
export function Rows({ rows }: { rows: [string, ComponentChildren | undefined][] }) {
  return (
    <dl class="kv">
      {rows
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
