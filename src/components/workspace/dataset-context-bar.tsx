import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, Loader2, X } from "lucide-react";
import { listDatasets } from "@/lib/dataset-library";
import { versionLabel, type DatasetSelection, type ResolvedDatasetContext } from "@/lib/dataset-context";

const borderFor = (edge: "top" | "bottom") => (edge === "top" ? "border-b" : "border-t");
const selectClass = "mt-0.5 block w-full rounded-lg border border-border bg-muted px-2 py-1 text-xs";

// Always shows which dataset / version / sheet an analysis is running on, and
// is the one place a user changes them — nothing switches silently.
export function DatasetContextBar({
  ctx,
  loading,
  error,
  selection,
  onSelect,
  truncatedRows,
  edge = "bottom",
}: {
  ctx: ResolvedDatasetContext | null;
  loading: boolean;
  error: string | null;
  selection: DatasetSelection | null;
  onSelect: (next: DatasetSelection | null) => void;
  truncatedRows?: number | undefined;
  edge?: "top" | "bottom";
}) {
  const { data: datasets } = useQuery({ queryKey: ["dataset-options"], queryFn: listDatasets });

  if (!selection) {
    if (!datasets?.length) return null;
    return (
      <div className={`flex flex-wrap items-center gap-2 ${borderFor(edge)} border-border bg-accent/30 px-4 py-2 text-xs`}>
        <Database className="size-3.5 text-primary" />
        <span className="text-muted-foreground">Analyse a saved dataset:</span>
        <select
          aria-label="Choose a saved dataset"
          value=""
          onChange={(e) => e.target.value && onSelect({ datasetId: e.target.value })}
          className="max-w-[16rem] rounded-lg border border-border bg-muted px-2 py-1 text-xs"
        >
          <option value="">Select from My Datasets…</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className={`${borderFor(edge)} border-border bg-accent/40 px-4 py-2.5 text-xs`} data-testid="active-dataset">
      <div className="flex items-start gap-2">
        <Database className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Active Dataset</p>
          {loading && !ctx ? (
            <p className="mt-1 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading dataset…
            </p>
          ) : error ? (
            <p className="mt-1 text-destructive">{error}</p>
          ) : ctx ? (
            <>
              <p className="mt-0.5 truncate text-sm font-semibold">{ctx.dataset.name}</p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <label className="block">
                  <span className="text-subtle">Version</span>
                  <select
                    aria-label="Dataset version"
                    className={selectClass}
                    value={selection.versionId ?? ctx.requestedVersion.id}
                    onChange={(e) => onSelect({ ...selection, versionId: e.target.value })}
                  >
                    {ctx.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {versionLabel(v)}
                        {v.id === ctx.dataset.current_version_id ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-subtle">Sheet</span>
                  {ctx.sheets.length > 1 ? (
                    <select
                      aria-label="Sheet"
                      className={selectClass}
                      value={ctx.sheetName ?? ""}
                      onChange={(e) => onSelect({ ...selection, sheetName: e.target.value })}
                    >
                      {ctx.sheets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-1.5 font-medium">{ctx.sheetName ?? "— (single table)"}</p>
                  )}
                </label>
                <div>
                  <span className="text-subtle">Analysing</span>
                  <p className="mt-1.5 font-medium">{ctx.versionLabel}</p>
                </div>
                <div>
                  <span className="text-subtle">Rows × Columns</span>
                  <p className="mt-1.5 font-medium">
                    {ctx.table.rows.length.toLocaleString()} × {ctx.table.columns.length}
                  </p>
                </div>
              </div>
              {ctx.note && (
                <p className="mt-2 flex items-start gap-1.5 text-amber-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {ctx.note}
                </p>
              )}
              {truncatedRows ? (
                <p className="mt-1 text-[11px] text-subtle">
                  PythonLab loads the first {truncatedRows.toLocaleString()} rows of this sheet (browser memory limit).
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Stop using this dataset"
          onClick={() => onSelect(null)}
          className="shrink-0 text-subtle hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
