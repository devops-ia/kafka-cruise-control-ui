import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";

export interface Column<R> {
  key: string;
  header: string;
  /** Raw value used for sorting and filtering. */
  value: (row: R) => string | number;
  /** Optional display override (units, links). */
  render?: (row: R) => ComponentChildren;
  numeric?: boolean;
}

export function sortRows<R>(rows: R[], col: Column<R> | undefined, dir: "asc" | "desc"): R[] {
  if (!col) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
  });
}

export function Table<R>(props: { caption: string; columns: Column<R>[]; rows: R[]; rowKey?: (r: R, i: number) => string | number; filterable?: boolean }) {
  const { columns, rows } = props;
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | undefined>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const filterable = props.filterable !== false;
  const showFilters = filterable && (open || Object.values(filters).some((f) => f));

  const shown = useMemo(() => {
    const filtered = rows.filter((r) =>
      columns.every((c) => {
        const f = filters[c.key]?.trim().toLowerCase();
        return !f || String(c.value(r)).toLowerCase().includes(f);
      }),
    );
    return sortRows(
      filtered,
      columns.find((c) => c.key === sort?.col),
      sort?.dir ?? "asc",
    );
  }, [rows, columns, sort, filters]);

  const toggle = (col: string) => setSort((s) => (s?.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }));

  return (
    <div class="table-wrap" role="region" aria-label={props.caption} tabIndex={0}>
      <table aria-label={props.caption}>
        <caption>
          <div class="caption-row">
            <span class="table-title">{props.caption}</span>
            {filterable && (
              <button type="button" aria-expanded={showFilters} onClick={() => setOpen(!showFilters)}>
                Filter
              </button>
            )}
          </div>
        </caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" class={c.numeric ? "num" : ""} aria-sort={sort?.col === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" class="sort" onClick={() => toggle(c.key)}>
                  {c.header}
                  <span aria-hidden="true">{sort?.col === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
          {showFilters && (
            <tr class="filters">
              {columns.map((c) => (
                <td key={c.key}>
                  <input
                    type="search"
                    aria-label={`Filter ${c.header}`}
                    placeholder="Filter"
                    value={filters[c.key] ?? ""}
                    onInput={(e) => setFilters({ ...filters, [c.key]: (e.target as HTMLInputElement).value })}
                  />
                </td>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={props.rowKey ? props.rowKey(r, i) : i}>
              {columns.map((c) => (
                <td key={c.key} class={c.numeric ? "num" : ""}>
                  {c.render ? c.render(r) : c.value(r)}
                </td>
              ))}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={columns.length} class="muted">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
