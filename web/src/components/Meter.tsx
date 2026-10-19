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
