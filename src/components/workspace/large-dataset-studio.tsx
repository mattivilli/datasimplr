import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Upload } from "lucide-react";
import { TOOLS, type ToolKey } from "@/lib/analysis";
import { describeBlock, LARGE_DATA, rangeCopy } from "@/lib/large-data/config";
import { ColumnPicker } from "./column-picker";
import { DatasetTooLargeError, UseStandardPath } from "@/lib/large-data/decide";
import { estimateDataRows, sniffTabularText } from "@/lib/large-data/sniff";
import type { AnalysisRequest, LargeQuality, LargeSessionInfo, PreviewPage, ProgressStep } from "@/lib/large-data/types";
import type { QueryResult } from "@/lib/dataset-query";
import { saveActiveDataset } from "@/lib/dataset-store";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WithPythonSplit } from "./with-python-split";
import type { SavedDatasetRef, SaveDatasetPayload } from "./analytics-studio";
import { useNavigate } from "@tanstack/react-router";
import { useConfirm } from "@/components/confirm/confirm-provider";
import { DuplicateDatasetError } from "@/lib/dataset-validation";

const RANGES = rangeCopy();

export function LargeDatasetStudio({
  file,
  blocked,
  blockedRows = null,
  blockedColumns = null,
  resumeSampleRows,
  onSaveDataset,
  onBack,
  onStandard,
}: {
  file: File;
  /** The file was already classified as above the supported range. */
  blocked?: boolean;
  /** Row and column counts from the intake check, so the message can say which one is too big. */
  blockedRows?: number | null;
  blockedColumns?: number | null;
  /** Reopen the last working sample after a refresh instead of the full file. */
  resumeSampleRows?: number | null;
  onSaveDataset?: ((payload: SaveDatasetPayload) => Promise<SavedDatasetRef | void>) | undefined;
  onBack: () => void;
  onStandard: (file: File) => void;
}) {
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [info, setInfo] = useState<LargeSessionInfo | null>(null);
  const [quality, setQuality] = useState<LargeQuality | null>(null);
  const [preview, setPreview] = useState<PreviewPage | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(blocked ?? false);
  const [blockRows, setBlockRows] = useState<number | null>(blockedRows);
  const [copyOffer, setCopyOffer] = useState<string | null>(blocked ? describeBlock(blockedRows, blockedColumns).body : null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [filterColumn, setFilterColumn] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [sortColumn, setSortColumn] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [extractColumn, setExtractColumn] = useState("");
  const [extractValue, setExtractValue] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [toolSummary, setToolSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [sampleCsv, setSampleCsv] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [alreadySaved, setAlreadySaved] = useState<{ id: string; name: string } | null>(null);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const onStandardRef = useRef(onStandard);
  onStandardRef.current = onStandard;

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setQuality(null);
    setPreview(null);
    setResult(null);
    setToolSummary(null);
    setSaved(false);
    setSaveMessage(null);
    setPage(0);
    if (blocked) {
      setTooLarge(true);
      setError(null);
      setBlockRows(blockedRows);
      setCopyOffer(describeBlock(blockedRows, blockedColumns).body);
      void (async () => {
        const sniff = await sniffTabularText(file);
        const estimated = blockedRows ?? ((await estimateDataRows(file, sniff).catch(() => 0)) || null);
        if (cancelled) return;
        setHeaders(sniff.header);
        setExtractColumn(sniff.header[0] ?? "");
        setBlockRows(estimated);
        setCopyOffer(describeBlock(estimated, blockedColumns ?? (sniff.header.length || null)).body);
      })();
      return;
    }
    setTooLarge(false);
    setError(null);
    void (async () => {
      try {
        const engine = await import("@/lib/large-data/engine");
        const opened = await engine.openLargeFile(file, {
          onProgress: (next) => { if (!cancelled) setSteps(next); },
          ...(resumeSampleRows ? { sampleRows: resumeSampleRows } : {}),
        });
        if (cancelled) return;
        setInfo(opened);
        const first = await engine.previewPage(opened.id, 0);
        if (cancelled) return;
        setPreview(first);
        setHeaders(opened.columns.map((column) => column.name));
        setFilterColumn(opened.columns[0]?.name ?? "");
        setSortColumn(opened.columns.find((column) => column.type === "numeric")?.name ?? opened.columns[0]?.name ?? "");
        try {
          const report = await engine.ensureQuality(opened.id);
          if (!cancelled) setQuality(report);
        } catch {
          /* Column profile is already shown. Quality can be opened again from a saved part. */
        }
        let sampleCsvText = "";
        try {
          const sample = await engine.sampleCsv(opened.id);
          sampleCsvText = sample.csv;
          if (!cancelled) {
            setSampleCsv(sample.csv);
            setSampleNote(sample.note || null);
          }
        } catch {
          if (!cancelled) setSampleNote(opened.sampled?.label ?? opened.parts?.note ?? null);
        }
        if (cancelled) return;
        if (opened.parts && opened.columns.some((column) => /quantity|^qty$/i.test(column.name)) && opened.columns.some((column) => /unit.?price|^price$/i.test(column.name))) {
          try {
            const revenue = await engine.runAnalysis(opened.id, engine.revenueRequest(10));
            if (!cancelled) setResult(revenue);
          } catch {
            /* The revenue button still runs the same combined query. */
          }
        }
        void saveActiveDataset({
          csv: sampleCsvText,
          fileName: opened.fileName,
          columns: first.columns,
          processing: "large",
          sampleRows: opened.sampled?.rows ?? null,
        });
      } catch (reason) {
        if (cancelled) return;
        if (reason instanceof UseStandardPath) {
          onStandardRef.current(file);
          return;
        }
        if (reason instanceof DatasetTooLargeError) {
          setTooLarge(true);
          setError(null);
          const sniff = await sniffTabularText(file);
          // The engine may fail before it knows the row count (for example out of memory).
          // Estimate it so the message says which dimension is too big.
          const estimated = reason.rows ?? ((await estimateDataRows(file, sniff).catch(() => 0)) || null);
          setBlockRows(estimated);
          setCopyOffer(describeBlock(estimated, sniff.header.length || null).body);
          setHeaders(sniff.header);
          setExtractColumn(sniff.header[0] ?? "");
          return;
        }
        setError(reason instanceof Error ? reason.message : "Could not process that file.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, blocked, resumeSampleRows]);

  const reloadPreview = async (nextPage: number, column = filterColumn, value = filterValue) => {
    if (!info) return;
    const engine = await import("@/lib/large-data/engine");
    const filters = column && value ? [{ column, op: "eq" as const, value }] : undefined;
    const next = await engine.previewPage(info.id, nextPage * LARGE_DATA.previewPageSize, {
      ...(filters ? { filters } : {}),
      ...(sortColumn ? { sortColumn, sort: sortDir } : {}),
    });
    setPreview(next);
    setPage(nextPage);
  };

  const runRequest = async (request: AnalysisRequest) => {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      const { runAnalysis } = await import("@/lib/large-data/engine");
      setToolSummary(null);
      setResult(await runAnalysis(info.id, request));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That query failed.");
    } finally {
      setBusy(false);
    }
  };

  const runTool = async (tool: ToolKey) => {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      const { runLargeTool } = await import("@/lib/large-data/tools");
      const outcome = await runLargeTool(info.id, tool);
      setResult(null);
      setToolSummary(`${outcome.summary}${outcome.note ? ` ${outcome.note}` : ""}`);
      setResult({
        op: tool,
        description: TOOLS.find((item) => item.key === tool)?.name ?? tool,
        columns: ["label", "value", "note"],
        rows: outcome.findings.map((finding) => [finding.label, finding.value, finding.note ?? ""]),
        ...(outcome.note ? { note: outcome.note } : {}),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That tool failed.");
    } finally {
      setBusy(false);
    }
  };

  const openExtract = async (options: { sampleRows?: number; filter?: { column: string; value: string }; columns?: string[] }) => {
    setBusy(true);
    setError(null);
    setCopyOffer(null);
    setTooLarge(false);
    try {
      const engine = await import("@/lib/large-data/engine");
      const opened = await engine.openLargeFile(file, options);
      setInfo(opened);
      setQuality(await engine.ensureQuality(opened.id));
      setPreview(await engine.previewPage(opened.id, 0));
      const sample = await engine.sampleCsv(opened.id);
      setSampleCsv(sample.csv);
      setSampleNote(sample.note || opened.sampled?.label || null);
      void saveActiveDataset({
        csv: sample.csv,
        fileName: opened.fileName,
        columns: opened.columns.map((column) => column.name),
        processing: "large",
        sampleRows: opened.sampled?.rows ?? null,
      });
    } catch (reason) {
      if (reason instanceof DatasetTooLargeError) {
        setTooLarge(true);
        setCopyOffer(
          options.sampleRows
            ? describeBlock(blockRows, headers.length || null).body
            : options.columns
              ? `${reason.message} The selected columns are still outside the supported range. Choose fewer columns.`
              : `${reason.message} The filtered extract is still outside the supported range.`,
        );
      } else {
        setError(reason instanceof Error ? reason.message : "Could not open that extract.");
      }
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!onSaveDataset || !info || saved || alreadySaved || savingRef.current) return;
    if (info.rowCount <= 0 || info.columnCount <= 0) {
      setSaveError("This dataset has no data rows, so there is nothing to save.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    let savedParts = 0;
    const notifyDuplicate = async (existing: { id: string; name: string }, what: string) => {
      setAlreadySaved(existing);
      setSaveMessage(`${what} already saved as \u201c${existing.name}\u201d. Nothing new was saved.`);
      const open = await confirm({
        title: "Already saved",
        description: `\u201c${existing.name}\u201d already has this exact data in My Datasets, so nothing new was saved.`,
        confirmLabel: "Open saved dataset",
        cancelLabel: "Close",
      });
      if (open) await navigate({ to: "/datasets/$id", params: { id: existing.id } });
    };
    try {
      if (info.parts) {
        const engine = await import("@/lib/large-data/engine");
        const parts = await engine.exportSplitParts(info.id);
        let skipped = 0;
        let firstDuplicate: { id: string; name: string } | null = null;
        for (const part of parts) {
          try {
            await onSaveDataset({
              file: part.file,
              name: part.name,
              rowCount: part.rowCount,
              columnCount: info.columnCount,
            });
            savedParts += 1;
          } catch (e) {
            // A part that is already saved is skipped, so saving again never makes copies.
            if (!(e instanceof DuplicateDatasetError)) throw e;
            skipped += 1;
            firstDuplicate ??= e.existing;
          }
        }
        if (savedParts === 0 && firstDuplicate) {
          await notifyDuplicate(firstDuplicate, "All parts are");
          return;
        }
        setSaved(true);
        setSaveMessage(
          `Saved ${savedParts} parts to My Datasets. They are grouped in the folder "${info.parts.stem}".${
            skipped ? ` ${skipped} part${skipped === 1 ? " was" : "s were"} already saved and skipped.` : ""
          }`,
        );
      } else {
        // A sample, a filtered extract or a column selection is a different file from the upload.
        // Save the file that was actually analysed, so reopening it gives the same rows and columns.
        const base = file.name.replace(/\.[^.]+$/, "") || file.name;
        const isExtract = Boolean(info.sampled || info.filtered || info.columnsSubset);
        let toSave = file;
        let name = base;
        if (isExtract) {
          const engine = await import("@/lib/large-data/engine");
          toSave = await engine.exportSession(info.id);
          name = `${base} (${info.columnsSubset ? "selected columns" : info.sampled ? "sample" : "filtered"})`;
        }
        if (toSave.size === 0) throw new Error("This file is empty, so there is nothing to save.");
        const remember = (datasetId: string) =>
          void saveActiveDataset({
            csv: sampleCsv ?? "",
            fileName: toSave.name,
            columns: info.columns.map((column) => column.name),
            fileBlob: toSave,
            processing: "large",
            sampleRows: null,
            datasetId,
          });
        let ref: SavedDatasetRef | void;
        try {
          ref = await onSaveDataset({
            file: toSave,
            name,
            rowCount: info.rowCount,
            columnCount: info.columnCount,
          });
        } catch (e) {
          if (!(e instanceof DuplicateDatasetError)) throw e;
          remember(e.existing.id);
          await notifyDuplicate(e.existing, "This data is");
          return;
        }
        setSaved(true);
        if (ref) remember(ref.datasetId);
        if (isExtract) setSaveMessage(`Saved “${name}”. This saved file is the one used from here on.`);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not save this dataset.";
      setSaveError(savedParts > 0 ? `Saved ${savedParts} parts, then stopped. ${message}` : message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const block = describeBlock(blockRows, headers.length || blockedColumns);
  const hasRevenue = headers.some((name) => /quantity|^qty$/i.test(name)) && headers.some((name) => /unit.?price|^price$/i.test(name));
  const parts = info?.parts ?? null;
  const from = preview ? preview.offset + 1 : 0;
  const to = preview ? preview.offset + preview.rows.length : 0;

  return (
    <WithPythonSplit csv={sampleCsv} fileName={info?.fileName ?? file.name} columns={preview?.columns} notice={sampleNote ?? undefined}>
      <AlertDialog open={copyOffer != null} onOpenChange={(open) => { if (!open) setCopyOffer(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{block.title}</AlertDialogTitle>
            <AlertDialogDescription>{copyOffer}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onBack}>Cancel</AlertDialogCancel>
            <Button type="button" variant="outline" onClick={() => setCopyOffer(null)}>
              {block.kind === "wide" ? "Choose columns" : "Filter first"}
            </Button>
            {block.sampleRows != null && (
              <AlertDialogAction disabled={busy} onClick={() => void openExtract({ sampleRows: block.sampleRows ?? LARGE_DATA.sampleOfferRows })}>
                {block.kind === "wide" ? `Use a ${block.sampleRows.toLocaleString()}-row sample` : "Prepare working file"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="min-w-0 space-y-5">
        <div className="panel p-5" data-testid="large-dataset-banner">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Large Dataset</p>
          <h2 className="mt-1 font-display text-2xl font-bold">{info ? info.rowCount.toLocaleString() : "—"} rows</h2>
          <p className="text-sm text-muted-foreground">{info ? `${info.columnCount} columns` : "Counting columns"}</p>
          <p className="mt-2 text-sm">DataSimplr is using optimized processing for this file.</p>
          {parts && (
            <div className="mt-3 space-y-2" data-testid="split-parts">
              <p className="text-sm">{parts.note}</p>
              <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                {parts.names.map((name, index) => (
                  <li key={name} data-testid="split-part">
                    {name} · {(parts.rows[index] ?? 0).toLocaleString()} rows
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Standard datasets: {RANGES.standard}. Large datasets: {RANGES.large}. {RANGES.above}.
          </p>
          {info?.sampled && <p className="mt-2 text-sm text-amber-500">{info.sampled.label}</p>}
          {info?.filtered && (
            <p className="mt-2 text-sm text-amber-500">
              Filtered to {info.filtered.column} = {info.filtered.value}. This is not the unfiltered file.
            </p>
          )}
          {info && info.excludedRows > 0 && <p className="mt-2 text-xs text-muted-foreground">{info.structuralNotes.join(" ")}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              Choose a different file
            </Button>
            {onSaveDataset && info && (
              <Button type="button" size="sm" onClick={() => void save()} disabled={saving || saved || alreadySaved != null || !info || info.rowCount <= 0}>
                {saving ? "Saving…" : saved ? "Saved to My Datasets" : parts ? `Save ${parts.names.length} parts` : "Save dataset"}
              </Button>
            )}
          </div>
          {saveMessage && <p className="mt-2 text-sm text-muted-foreground">{saveMessage}</p>}
          {saveError && <p className="mt-2 text-sm text-destructive">{saveError}</p>}
        </div>

        {steps.length > 0 && (
          <ol className="panel space-y-1.5 p-4 text-sm" data-testid="large-progress">
            {steps.map((step) => (
              <li key={step.id} className="flex items-center gap-2">
                {step.state === "done" ? (
                  <Check className="size-3.5 text-primary" />
                ) : step.state === "active" ? (
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                ) : (
                  <span className="size-3.5" />
                )}
                <span className={step.state === "pending" ? "text-muted-foreground" : ""}>{step.label}</span>
              </li>
            ))}
          </ol>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {tooLarge && (
          <div className="panel space-y-3 p-5" data-testid="large-too-big">
            <p className="text-sm font-semibold">{block.headline}</p>
            {block.kind === "wide" && <p className="text-sm text-muted-foreground">{block.body}</p>}
            <p className="text-sm text-muted-foreground">You can:</p>
            <div className="flex flex-wrap gap-2">
              {block.sampleRows != null && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void openExtract({ sampleRows: block.sampleRows ?? LARGE_DATA.sampleOfferRows })}
                >
                  {block.kind === "wide"
                    ? `Use a ${block.sampleRows.toLocaleString()}-row sample (all columns)`
                    : `Prepare a ${block.sampleRows.toLocaleString()}-row working file`}
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                Cancel
              </Button>
            </div>
            {block.kind !== "tall" && headers.length > 1 && (
              <ColumnPicker
                headers={headers}
                rows={blockRows}
                maxCells={LARGE_DATA.supportedMaxCells}
                busy={busy}
                onOpen={(columns) => void openExtract({ columns })}
              />
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                Filter before analysis
                <select className="mt-1 block rounded-lg border border-border bg-muted px-2 py-1 text-sm" value={extractColumn} onChange={(event) => setExtractColumn(event.target.value)}>
                  {headers.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <input
                className="rounded-lg border border-border bg-muted px-2 py-1 text-sm"
                placeholder="Value"
                value={extractValue}
                onChange={(event) => setExtractValue(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !extractColumn || !extractValue}
                onClick={() => void openExtract({ filter: { column: extractColumn, value: extractValue } })}
              >
                Apply filter
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">A sample is labeled as a sample. It is not a full-dataset result.</p>
          </div>
        )}

        {info && preview && (
          <>
            <div className="panel overflow-hidden" data-testid="large-preview">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <p className="text-sm font-semibold" data-testid="large-preview-range">
                  Showing rows {preview.rows.length ? `${from.toLocaleString()}–${to.toLocaleString()}` : "0"} of {preview.total.toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={page === 0 || busy} onClick={() => void reloadPreview(page - 1)}>
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || to >= preview.total}
                    onClick={() => void reloadPreview(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
              <div className="max-w-full overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      {preview.columns.map((column) => (
                        <th key={column} className="px-3 py-2 font-semibold">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, index) => (
                      <tr key={`${preview.offset}-${index}`} className="border-t border-border">
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="max-w-[16rem] truncate px-3 py-1.5">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-end gap-2 border-t border-border px-4 py-3">
                <label className="text-xs">
                  Filter
                  <select className="mt-1 block rounded-lg border border-border bg-muted px-2 py-1" value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)} data-testid="large-filter-column">
                    {headers.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <input
                  className="rounded-lg border border-border bg-muted px-2 py-1 text-sm"
                  placeholder="Equals"
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                  data-testid="large-filter-value"
                />
                <label className="text-xs">
                  Sort
                  <select className="mt-1 block rounded-lg border border-border bg-muted px-2 py-1" value={sortColumn} onChange={(event) => setSortColumn(event.target.value)} data-testid="large-sort-column">
                    {headers.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <select className="rounded-lg border border-border bg-muted px-2 py-1 text-sm" value={sortDir} onChange={(event) => setSortDir(event.target.value === "asc" ? "asc" : "desc")}>
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reloadPreview(0)} data-testid="large-apply-view">
                  Apply
                </Button>
              </div>
            </div>

            {quality && (
              <div className="panel p-4 text-sm" data-testid="large-quality">
                <p className="font-semibold">Data quality {quality.score.overall}/100</p>
                <p className="mt-1 text-muted-foreground">
                  {quality.issues.length} item{quality.issues.length === 1 ? "" : "s"} flagged.{" "}
                  {parts ? "Counts are combined from every part." : "Counts are for the loaded dataset."} Outliers are not removed.
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {quality.issues.slice(0, 8).map((issue) => (
                    <li key={issue.id}>
                      {issue.title} — {issue.affectedCount.toLocaleString()} rows
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="panel p-4">
              <p className="text-sm font-semibold">Analysis</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {TOOLS.map((tool) => (
                  <Button key={tool.key} type="button" variant="outline" size="sm" disabled={busy} onClick={() => void runTool(tool.key)}>
                    {tool.name}
                  </Button>
                ))}
              </div>
              {hasRevenue && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    data-testid="revenue-top-countries"
                    onClick={() => void runRequest({ operation: "group_by", groupBy: ["Country"], metric: "Revenue", aggregation: "sum", sort: "desc", limit: 10 })}
                  >
                    Top 10 countries by revenue
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    data-testid="monthly-revenue"
                    onClick={() => void runRequest({ operation: "time_trend", dateColumn: "InvoiceDate", metric: "Revenue", aggregation: "sum", granularity: "month", limit: 60 })}
                  >
                    Monthly revenue
                  </Button>
                </div>
              )}
              {busy && (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> {parts ? "Combining every part…" : "Working on the loaded dataset…"}
                </p>
              )}
              {toolSummary && <p className="mt-3 text-sm">{toolSummary}</p>}
              {result?.error && <p className="mt-3 text-sm text-destructive">{result.error}</p>}
              {result?.rows && (
                <div className="mt-3 max-w-full overflow-x-auto" data-testid="large-result">
                  <p className="mb-2 text-xs text-muted-foreground">{result.description}{result.note ? ` ${result.note}` : ""}</p>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr>
                        {(result.columns ?? []).map((column) => (
                          <th key={column} className="px-2 py-1 font-semibold">{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, index) => (
                        <tr key={index} className="border-t border-border">
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} className="px-2 py-1">{String(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result?.value != null && !result.rows && (
                <p className="mt-3 text-sm" data-testid="large-result">
                  {result.description}: {String(result.value)}
                </p>
              )}
            </div>
          </>
        )}

        {!info && !tooLarge && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Upload className="size-4" /> Preparing this file. The page stays usable while that runs.
          </p>
        )}
      </div>
    </WithPythonSplit>
  );
}
