import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardPaste,
  DatabaseZap,
  Loader2,
  Play,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  TOOLS,
  cleanTable,
  correlationMatrix,
  describeNumeric,
  detectTypes,
  executiveInsights,
  kmeans,
  linearRegression,
  multipleRegression,
  parseDelimited,
  pca,
  previewRows,
  runTool,
  tableToCsv,
  type FillStrategy,
  type Table,
  type ToolKey,
} from "@/lib/analysis";
import { getSheetNames, parseUploadedFile } from "@/lib/parse-file";
import { WithPythonSplit } from "@/components/workspace/with-python-split";
import { saveActiveDataset } from "@/lib/dataset-store";

const sample = `region,month,revenue,units,refunds
North,Jul,412300,1820,4200
South,Jul,198400,910,15600
East,Jul,251000,1120,3900
North,Aug,448900,1975,3800
South,Aug,171200,780,18800
East,Aug,264500,1190,4100
North,Sep,472100,2040,3600
South,Sep,158900,700,21400
East,Sep,278300,1255,4500`;

const tabs = TOOLS;

const clusterColors = ["#39ff88", "#5b8cff", "#ffb020", "#ff6b6b", "#c084fc", "#22d3ee"];

type SavePayload = {
  title: string;
  sourceName: string;
  sourceType: string;
  tool: string;
  summary: string;
  findings: { label: string; value: string; note?: string }[];
};

export type SaveDatasetPayload = {
  file: File;
  name: string;
  rowCount: number;
  columnCount: number;
};

export function AnalyticsStudio({
  onSave,
  onSaveDataset,
  initialDataset,
}: {
  onSave?: (payload: SavePayload) => Promise<void>;
  onSaveDataset?: (payload: SaveDatasetPayload) => Promise<void>;
  initialDataset?: { table: Table; sourceName: string; sourceFile: File } | null;
}) {
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [text, setText] = useState(sample);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [raw, setRaw] = useState<Table>(() => parseDelimited(sample));
  const [fill, setFill] = useState<FillStrategy>("mean");
  const [removeDups, setRemoveDups] = useState(true);
  const [cleaned, setCleaned] = useState(() => cleanTable(parseDelimited(sample), { fill: "mean", removeDuplicates: true }));
  const [tool, setTool] = useState<ToolKey>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sheetOptions, setSheetOptions] = useState<string[] | null>(null);
  const [k, setK] = useState(3);
  const [xCol, setXCol] = useState("");
  const [yCol, setYCol] = useState("");
  const [multiCols, setMultiCols] = useState<string[]>([]);
  const [savingDataset, setSavingDataset] = useState(false);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [savedDatasetName, setSavedDatasetName] = useState<string | null>(null);

  const table = cleaned.table;
  const types = useMemo(() => detectTypes(table), [table]);
  const numericNames = useMemo(
    () => table.columns.filter((c) => types[c] === "numeric"),
    [table, types],
  );

  const applyTable = (next: Table, name: string | null, file: File | null = null) => {
    setRaw(next);
    const result = cleanTable(next, { fill, removeDuplicates: removeDups });
    setCleaned(result);
    setFileName(name);
    setSourceFile(file);
    setSavedDatasetName(null);
    const nums = next.columns.filter((_, i) => {
      const values = next.rows.map((r) => r[i]).filter(Boolean);
      return values.length > 0;
    });
    const detected = detectTypes(result.table);
    const numeric = result.table.columns.filter((c) => detected[c] === "numeric");
    setXCol(numeric[0] ?? nums[0] ?? "");
    setYCol(numeric[1] ?? numeric[0] ?? "");
    setMultiCols(numeric.slice(0, Math.max(1, numeric.length - 1)));
    void saveActiveDataset({
      csv: tableToCsv(result.table),
      fileName: name ?? "pasted data",
      columns: result.table.columns,
    });
  };

  useEffect(() => {
    if (initialDataset) applyTable(initialDataset.table, initialDataset.sourceName, initialDataset.sourceFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDataset]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const sheets = await getSheetNames(file);
      if (sheets && sheets.length > 1) {
        setPendingFile(file);
        setSheetOptions(sheets);
        return;
      }
      const parsed = await parseUploadedFile(file, sheets?.[0]);
      applyTable(parsed.table, parsed.sourceName, file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    }
  };

  const chooseSheet = async (name: string) => {
    if (!pendingFile) return;
    setError(null);
    try {
      const parsed = await parseUploadedFile(pendingFile, name);
      applyTable(parsed.table, `${parsed.sourceName} — ${name}`, pendingFile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that sheet.");
    } finally {
      setPendingFile(null);
      setSheetOptions(null);
    }
  };

  const saveDataset = async () => {
    if (!onSaveDataset || raw.rows.length === 0) return;
    setSavingDataset(true);
    setDatasetError(null);
    try {
      const file = sourceFile ?? new File([tableToCsv(raw)], fileName ?? "pasted-data.csv", { type: "text/csv" });
      await onSaveDataset({
        file,
        name: fileName ?? "Pasted data",
        rowCount: raw.rows.length,
        columnCount: raw.columns.length,
      });
      setSavedDatasetName(fileName ?? "Pasted data");
    } catch (e) {
      setDatasetError(e instanceof Error ? e.message : "Could not save this dataset.");
    } finally {
      setSavingDataset(false);
    }
  };

  const reclean = (nextFill = fill, nextDups = removeDups) => {
    const result = cleanTable(raw, { fill: nextFill, removeDuplicates: nextDups });
    setCleaned(result);
    void saveActiveDataset({
      csv: tableToCsv(result.table),
      fileName: fileName ?? "pasted data",
      columns: result.table.columns,
    });
  };

  const stats = describeNumeric(table);
  const corr = useMemo(() => correlationMatrix(table), [table]);
  const insights = useMemo(() => executiveInsights(table), [table]);
  const regression = xCol && yCol ? linearRegression(table, xCol, yCol) : null;
  const multi = yCol && multiCols.length ? multipleRegression(table, multiCols.filter((c) => c !== yCol), yCol) : null;
  const clusters = kmeans(table, k);
  const pcaResult = pca(table);
  const preview = previewRows(table, 8);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = runTool(tool, table);
      if (onSave) {
        const toolName = TOOLS.find((t) => t.key === tool)!.name;
        await onSave({
          title: `${toolName} — ${fileName ?? "pasted data"}`,
          sourceName: fileName ?? "pasted data",
          sourceType: fileName?.split(".").pop()?.toLowerCase() ?? "csv",
          tool: toolName,
          summary: outcome.summary,
          findings: outcome.findings,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this analysis.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <WithPythonSplit csv={tableToCsv(table)} fileName={fileName ?? "pasted data"} columns={table.columns}>
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
      <div className="min-w-0 space-y-5">
        <div className="panel p-5">
          <div className="flex gap-1.5 rounded-xl border border-border bg-muted p-1">
            {(
              [
                { key: "upload", label: "Upload file", icon: Upload },
                { key: "paste", label: "Paste data", icon: ClipboardPaste },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setMode(t.key)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  mode === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {mode === "upload" ? (
            sheetOptions ? (
              <div className="mt-4 rounded-xl border border-border bg-muted p-5">
                <p className="text-sm font-semibold">{pendingFile?.name} has {sheetOptions.length} sheets</p>
                <p className="mt-1 text-xs text-muted-foreground">Pick the one to analyze.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {sheetOptions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => void chooseSheet(name)}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:border-primary hover:text-primary"
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPendingFile(null);
                    setSheetOptions(null);
                  }}
                  className="mt-3 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel and choose a different file
                </button>
              </div>
            ) : (
              <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-border bg-muted px-5 py-10 text-center transition-colors hover:border-primary">
                <Upload className="mx-auto size-5 text-primary" />
                <p className="mt-3 text-sm font-semibold">Drop Excel, CSV, TSV or JSON</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  .xlsx, .xls, .csv, .tsv, .json — up to 50 MB. Parsed in your browser.
                </p>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,.json,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )
          ) : (
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                applyTable(parseDelimited(e.target.value), null);
              }}
              rows={10}
              className="mt-4 w-full rounded-xl border border-border bg-muted p-3 font-mono text-[11px] leading-relaxed text-muted-foreground outline-none focus:border-primary"
            />
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-accent/40 px-4 py-3 sm:grid-cols-4">
            <Meta label="Source" value={fileName ?? "pasted data"} />
            <Meta label="Rows" value={String(table.rows.length)} />
            <Meta label="Columns" value={String(table.columns.length)} />
            <Meta label="Numeric" value={String(numericNames.length)} />
          </div>

          {onSaveDataset && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={saveDataset}
                disabled={savingDataset || raw.rows.length === 0}
              >
                {savingDataset ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <DatabaseZap className="mr-1.5 size-3.5" />
                )}
                Save to My Datasets
              </Button>
              {savedDatasetName && (
                <p className="flex items-center gap-1.5 text-xs text-primary">
                  <Check className="size-3.5" /> Saved “{savedDatasetName}” — find it under My Datasets.
                </p>
              )}
              {datasetError && <p className="text-xs text-destructive">{datasetError}</p>}
            </div>
          )}
        </div>

        <div className="panel p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Cleaning</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="text-xs font-semibold">
              Fill missing
              <select
                value={fill}
                onChange={(e) => {
                  const next = e.target.value as FillStrategy;
                  setFill(next);
                  reclean(next, removeDups);
                }}
                className="mt-1 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs sm:w-auto"
              >
                <option value="mean">Mean / mode</option>
                <option value="median">Median</option>
                <option value="mode">Mode</option>
                <option value="drop">Drop incomplete rows</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={removeDups}
                onChange={(e) => {
                  setRemoveDups(e.target.checked);
                  reclean(fill, e.target.checked);
                }}
              />
              Remove duplicates
            </label>
            <p className="font-mono text-[10px] text-subtle sm:ml-auto">
              {cleaned.report.duplicatesRemoved} dups · {cleaned.report.missingFilled} filled · {cleaned.report.rowsDropped} dropped
            </p>
          </div>
        </div>

        {tool === "profile" && (
          <div className="panel overflow-hidden">
            <div className="border-b border-border px-5 py-3 text-sm font-semibold">Preview</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-muted">
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-subtle">
                        {c}
                        <span className="ml-2 text-primary">{types[c]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {row.map((cell, j) => (
                        <td key={j} className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tool === "summary_stats" && (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-muted">
                  <tr>
                    {["Column", "N", "Mean", "Median", "Std", "Min", "Max", "Skew"].map((h) => (
                      <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-subtle">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.map((c) => (
                    <tr key={c.name} className="border-t border-border">
                      <td className="px-3 py-2 font-semibold">{c.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.n}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.mean.toFixed(2)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.median.toFixed(2)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.std.toFixed(2)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.min.toFixed(2)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.max.toFixed(2)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.skew.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tool === "correlation" && corr.names.length > 1 && (
          <div className="panel overflow-hidden p-5">
            <div
              className="grid min-w-[420px] gap-1 overflow-x-auto"
              style={{ gridTemplateColumns: `90px repeat(${corr.names.length}, minmax(48px, 1fr))` }}
            >
              <div />
              {corr.names.map((n) => (
                <div key={n} className="truncate text-center font-mono text-[9px] text-subtle">
                  {n}
                </div>
              ))}
              {corr.names.map((rowName, i) => (
                <div key={rowName} className="contents">
                  <div className="truncate font-mono text-[9px] text-subtle">{rowName}</div>
                  {corr.matrix[i]!.map((r, j) => (
                    <div
                      key={`${i}-${j}`}
                      className="flex h-10 items-center justify-center rounded-md font-mono text-[10px]"
                      style={{
                        background: `rgba(57, 255, 136, ${Math.abs(r) * 0.55})`,
                        color: Math.abs(r) > 0.55 ? "#04150b" : "inherit",
                      }}
                    >
                      {r.toFixed(2)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {tool === "regression" && (
          <div className="panel space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Feature (X)" value={xCol} options={numericNames} onChange={setXCol} />
              <Select label="Target (Y)" value={yCol} options={numericNames} onChange={setYCol} />
            </div>
            {regression && (
              <>
                <p className="text-sm font-semibold">{regression.equation}</p>
                <p className="font-mono text-xs text-subtle">
                  R² {regression.r2.toFixed(3)} · n {regression.n}
                </p>
                {regression.points && (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart>
                        <CartesianGrid stroke="var(--border)" />
                        <XAxis dataKey="x" name={xCol} stroke="var(--subtle)" fontSize={11} />
                        <YAxis dataKey="y" name={yCol} stroke="var(--subtle)" fontSize={11} />
                        <Tooltip />
                        <Scatter data={regression.points} fill="var(--primary)" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
            <div>
              <p className="mb-2 text-xs font-semibold">Multiple regression predictors</p>
              <div className="flex flex-wrap gap-2">
                {numericNames
                  .filter((n) => n !== yCol)
                  .map((n) => (
                    <label key={n} className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={multiCols.includes(n)}
                        onChange={(e) =>
                          setMultiCols((prev) => (e.target.checked ? [...prev, n] : prev.filter((c) => c !== n)))
                        }
                      />
                      {n}
                    </label>
                  ))}
              </div>
              {multi && (
                <p className="mt-3 text-sm">
                  {multi.equation}
                  <span className="ml-2 font-mono text-xs text-subtle">R² {multi.r2.toFixed(3)}</span>
                </p>
              )}
            </div>
          </div>
        )}

        {tool === "clustering" && clusters && (
          <div className="panel p-5">
            <label className="text-xs font-semibold">
              k
              <input
                type="number"
                min={2}
                max={6}
                value={k}
                onChange={(e) => setK(Number(e.target.value) || 3)}
                className="ml-2 w-16 rounded-lg border border-border bg-muted px-2 py-1"
              />
            </label>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {clusters.sizes.map((size, i) => (
                <div key={i} className="rounded-xl border border-border bg-muted px-3 py-2 text-xs">
                  <p className="font-semibold">Cluster {i + 1}</p>
                  <p className="text-muted-foreground">{size} rows</p>
                </div>
              ))}
            </div>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid stroke="var(--border)" />
                  <XAxis dataKey="x" stroke="var(--subtle)" fontSize={11} />
                  <YAxis dataKey="y" stroke="var(--subtle)" fontSize={11} />
                  <Tooltip />
                  <Scatter data={clusters.points}>
                    {clusters.points.map((p, i) => (
                      <Cell key={i} fill={clusterColors[p.cluster % clusterColors.length]} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {tool === "pca" && pcaResult && (
          <div className="panel p-5">
            <p className="text-sm font-semibold">
              PC1 {pcaResult.explained[0]!.toFixed(1)}% · PC2 {pcaResult.explained[1]!.toFixed(1)}%
            </p>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid stroke="var(--border)" />
                  <XAxis dataKey="x" name="PC1" stroke="var(--subtle)" fontSize={11} />
                  <YAxis dataKey="y" name="PC2" stroke="var(--subtle)" fontSize={11} />
                  <Tooltip />
                  <Scatter data={pcaResult.points} fill="var(--primary)" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {(tool === "insights" || tool === "missing_values" || tool === "outliers" || tool === "trend" || tool === "segment") && (
          <div className="panel p-5">
            <div className="space-y-2">
              {(tool === "insights" ? insights : runTool(tool, table).findings.map((f) => `${f.label}: ${f.value}${f.note ? ` — ${f.note}` : ""}`)).map(
                (line) => (
                  <p key={line} className="rounded-xl border border-border bg-muted px-3 py-2 text-sm">
                    {line}
                  </p>
                ),
              )}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={run} disabled={busy || table.rows.length === 0} className="sticky bottom-3 z-10 w-full shadow-[0_12px_32px_-12px_var(--glow)]">
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : onSave ? <Play className="mr-2 size-4" /> : <Sparkles className="mr-2 size-4" />}
          {onSave ? `Run and save ${TOOLS.find((t) => t.key === tool)!.name}` : `Run ${TOOLS.find((t) => t.key === tool)!.name}`}
        </Button>
      </div>

      <div className="order-first min-w-0 xl:order-none">
        <div className="sticky top-16 z-20 -mx-1 mb-3 flex gap-2 overflow-x-auto bg-background/90 px-1 py-2 backdrop-blur-md xl:hidden">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTool(t.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                tool === t.key ? "border-primary bg-accent text-foreground" : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="panel sticky top-20 hidden h-fit p-5 xl:block">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Data science tools</p>
          <div className="mt-3 space-y-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTool(t.key)}
                className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                  tool === t.key ? "border-primary bg-accent" : "border-border bg-muted hover:border-primary"
                }`}
              >
                <p className="text-xs font-semibold">{t.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t.blurb}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
    </WithPythonSplit>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">{label}</p>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-xs font-semibold">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
