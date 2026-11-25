import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Lets the user pick which columns of a very wide file to load. Shows live
 * whether the selection fits the cell limit so nothing is guessed.
 */
export function ColumnPicker({
  headers,
  rows,
  maxCells,
  busy,
  onOpen,
}: {
  headers: string[];
  /** Row count of the file when known. Without it the fit check is skipped. */
  rows: number | null;
  maxCells: number;
  busy: boolean;
  onOpen: (columns: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const maxColumns = rows != null && rows > 0 ? Math.max(1, Math.floor(maxCells / rows)) : null;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? headers.filter((name) => name.toLowerCase().includes(q)) : headers;
  }, [headers, query]);

  const count = selected.size;
  const cells = rows != null ? rows * count : null;
  const fits = count > 0 && (maxColumns == null || count <= maxColumns);

  const toggle = (name: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const selectFirst = () => setSelected(new Set(headers.slice(0, maxColumns ?? headers.length)));

  return (
    <div className="space-y-2" data-testid="column-picker">
      <p className="text-sm font-semibold">Choose columns to load</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[10rem] flex-1 rounded-lg border border-border bg-muted px-2 py-1 text-sm"
          placeholder="Search columns"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search columns"
        />
        <Button type="button" variant="outline" size="sm" onClick={selectFirst}>
          Select first {maxColumns ?? headers.length}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set())} disabled={count === 0}>
          Clear
        </Button>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/40 p-2">
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((name) => (
            <li key={name}>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} />
                <span className="truncate" title={name}>
                  {name}
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="text-xs text-muted-foreground">No columns match.</li>}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${count > 0 && !fits ? "text-destructive" : "text-muted-foreground"}`} data-testid="column-picker-fit">
          {count} of {headers.length} columns
          {cells != null && count > 0 ? ` × ${rows?.toLocaleString()} rows = ${(cells / 1_000_000).toFixed(1)} million cells, ${fits ? "fits" : "too many"}` : ""}
          {maxColumns != null ? ` (up to ${maxColumns} fit)` : ""}
        </p>
        <Button type="button" size="sm" disabled={busy || !fits} onClick={() => onOpen([...selected])}>
          Open {count || ""} selected {count === 1 ? "column" : "columns"}
        </Button>
      </div>
    </div>
  );
}
