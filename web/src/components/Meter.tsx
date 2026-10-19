// A percentage bar that works without colour: the number is always printed next to it.
export function Meter(props: { value: number; label: string; max?: number }) {
  const max = props.max ?? 100;
  const v = Number.isFinite(props.value) ? props.value : 0;
  const level = v >= 0.9 * max ? "high" : v >= 0.7 * max ? "mid" : "low";
  return (
    <span class="meter-cell">
      <meter class={`level-${level}`} min={0} max={max} value={Math.min(v, max)} aria-label={props.label} />
      <span class="num">{Math.round(v * 10) / 10}%</span>
    </span>
  );
}

/** Flat progress bar for a share of a whole; the caller prints the numbers next to it. */
export function Progress(props: { label: string; value: number; total: number }) {
  const pct = props.total > 0 ? Math.min(100, Math.round((props.value / props.total) * 100)) : 0;
  return <progress class="bar" max={100} value={pct} aria-label={props.label} />;
}
