import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LARGE_DATA } from "@/lib/large-data/config";
import type { CleanAction, LargeQuality, LargeSessionInfo, PreviewPage } from "@/lib/large-data/types";
import {
  deleteCleaningLogEntries,
  downloadDatasetFile,
  downloadVersionBlob,
  finalizeDatasetFile,
  getCleaningLogForDataset,
  listVersions,
  logCleaningChanges,
  saveWorkingFile,
  versionFilename,
  type CleaningLogRow,
  type DatasetRow,
  type DatasetVersionRow,
} from "@/lib/dataset-library";

const BARS: { key: keyof LargeQuality["score"]; label: string }[] = [
  { key: "completeness", label: "Completeness" },
  { key: "consistency", label: "Consistency" },
  { key: "validity", label: "Validity" },
  { key: "uniqueness", label: "Uniqueness" },
  { key: "typeCorrectness", label: "Type correctness" },
];

export function LargeCleaningWorkspace({
  dataset,
  initialVersions,
  readOnly,
}: {
  dataset: DatasetRow;
  initialVersions: DatasetVersionRow[];
  readOnly: boolean;
}) {
  const [versions, setVersions] = useState(initialVersions);
  const [session, setSession] = useState<LargeSessionInfo | null>(null);
  const [quality, setQuality] = useState<LargeQuality | null>(null);
  const [preview, setPreview] = useState<PreviewPage | null>(null);
  const [page, setPage] = useState(0);
  const [log, setLog] = useState<CleaningLogRow[]>([]);
  const [working, setWorking] = useState<DatasetVersionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const current = () => versions.find((version) => version.id === dataset.current_version_id) ?? versions[versions.length - 1] ?? null;
  const original = () => versions.find((version) => version.kind === "original") ?? null;

  const openVersion = async (version: DatasetVersionRow) => {
    const engine = await import("@/lib/large-data/engine");
    const blob = await downloadVersionBlob(version);
    const file = new File([blob], versionFilename(dataset, version), { type: blob.type || "text/csv" });
    const info = await engine.openLargeFile(file, {
      cacheKey: `${version.id}|${blob.size}|${version.row_count ?? ""}|${version.quality_score ?? ""}`,
    });
    const report = await engine.ensureQuality(info.id);
    const first = await engine.previewPage(info.id, 0);
    setSession(info);
    setQuality(report);
    setPreview(first);
    setPage(0);
    setWorking(version.kind === "working" ? version : null);
    return { info, report };
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const version = current();
        if (!version) throw new Error("This dataset has no stored version.");
        const history = await getCleaningLogForDataset(dataset.id);
        if (cancelled) return;
        setLog(history);
        await openVersion(version);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not open this dataset.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The dataset id is the identity of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.id]);

  const refreshVersions = async (saved: DatasetVersionRow) => {
    setWorking(saved.kind === "working" ? saved : working);
    setVersions(await listVersions(dataset.id));
    dataset.current_version_id = saved.id;
    dataset.status = saved.kind === "finalized" ? "finalized" : "cleaning";
  };

  const apply = async (action: CleanAction, reason: string, column: string | undefined) => {
    if (!session || readOnly) return;
    setBusy(action.type);
    setError(null);
    try {
      const engine = await import("@/lib/large-data/engine");
      const applied = await engine.applyCleaning(session.id, action);
      if (!applied.file) throw new Error("The cleaned file could not be written.");
      const report = await engine.ensureQuality(session.id);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in again to save this change.");
      const saved = await saveWorkingFile({
        dataset,
        file: applied.file,
        userId: auth.user.id,
        qualityScore: report.score.overall,
        rowCount: applied.info.rowCount,
        columnCount: applied.info.columnCount,
        existingWorkingVersion: working,
      });
      await logCleaningChanges([
        {
          datasetId: dataset.id,
          datasetVersionId: saved.id,
          userId: auth.user.id,
          rowReference: "all",
          columnName: column ?? null,
          originalValue: JSON.stringify(action),
          newValue: applied.summary,
          operation: action.type,
          reason,
        },
      ]);
      await refreshVersions(saved);
      setSession(applied.info);
      setQuality(report);
      setPreview(await engine.previewPage(session.id, 0));
      setLog(await getCleaningLogForDataset(dataset.id));
      setMessage(applied.summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply that change.");
    } finally {
      setBusy(null);
    }
  };

  const replayFromOriginal = async (actions: CleanAction[]) => {
    const source = original();
    if (!source) throw new Error("The original file is missing.");
    const engine = await import("@/lib/large-data/engine");
    const blob = await downloadVersionBlob(source);
    const file = new File([blob], versionFilename(dataset, source), { type: blob.type || "text/csv" });
    const opened = await engine.openLargeFile(file, { cacheKey: `replay|${source.id}|${Date.now()}|${actions.length}` });
    for (const action of actions) await engine.applyCleaning(opened.id, action, { exportFile: false });
    const exported = actions.length ? await engine.exportSession(opened.id) : file;
    const report = await engine.ensureQuality(opened.id);
    const info = engine.getSessionInfo(opened.id);
    setSession(info);
    setQuality(report);
    setPreview(await engine.previewPage(opened.id, 0));
    return { file: exported, info, report };
  };

  const undo = async () => {
    const latest = log[0];
    if (!latest || latest.row_reference !== "all") {
      setError("The latest cleaning entry was recorded cell by cell and can't be replayed here.");
      return;
    }
    const action = parseAction(latest.original_value);
    if (!action) {
      setError("That cleaning entry has no stored action to undo.");
      return;
    }
    setBusy("undo");
    setError(null);
    try {
      const older = log.slice(1).filter((entry) => entry.row_reference === "all").reverse();
      const actions = older.map((entry) => parseAction(entry.original_value)).filter((entry): entry is CleanAction => !!entry);
      const replayed = await replayFromOriginal(actions);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in again to undo.");
      const saved = await saveWorkingFile({
        dataset,
        file: replayed.file,
        userId: auth.user.id,
        qualityScore: replayed.report.score.overall,
        rowCount: replayed.report.rowCount,
        columnCount: replayed.report.columnCount,
        existingWorkingVersion: working,
      });
      await deleteCleaningLogEntries([latest.id]);
      await refreshVersions(saved);
      setLog(await getCleaningLogForDataset(dataset.id));
      setMessage("Undid the last cleaning action by replaying the original file.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not undo.");
    } finally {
      setBusy(null);
    }
  };

  const resetOriginal = async () => {
    const source = original();
    if (!source || readOnly) return;
    setBusy("reset");
    setError(null);
    try {
      const blob = await downloadVersionBlob(source);
      const file = new File([blob], versionFilename(dataset, source), { type: blob.type || "text/csv" });
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in again to restore the original.");
      const saved = await saveWorkingFile({
        dataset,
        file,
        userId: auth.user.id,
        qualityScore: source.quality_score ?? quality?.score.overall ?? 0,
        rowCount: source.row_count ?? dataset.row_count ?? 0,
        columnCount: source.column_count ?? dataset.column_count ?? 0,
        existingWorkingVersion: working,
      });
      await refreshVersions(saved);
      await openVersion(saved.kind === "working" ? { ...saved, storage_key: saved.storage_key } : source);
      setMessage("Restored the original file into the working copy. The cleaning log was kept.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not restore the original.");
    } finally {
      setBusy(null);
    }
  };

  const finalize = async () => {
    if (!session || !quality || readOnly) return;
    setBusy("finalize");
    setError(null);
    try {
      const engine = await import("@/lib/large-data/engine");
      const file = await engine.exportSession(session.id);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in again to finalize.");
      const saved = await finalizeDatasetFile({
        dataset,
        file,
        userId: auth.user.id,
        qualityScore: quality.score.overall,
        rowCount: session.rowCount,
        columnCount: session.columnCount,
      });
      await refreshVersions(saved);
      setWorking(null);
      setMessage("Finalized. The original upload is still stored.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not finalize.");
    } finally {
      setBusy(null);
    }
  };

  const downloadCurrent = async () => {
    if (!session) return;
    const engine = await import("@/lib/large-data/engine");
    const file = await engine.exportSession(session.id);
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Preparing this large dataset…
      </p>
    );
  }

  const from = preview ? preview.offset + (preview.rows.length ? 1 : 0) : 0;
  const to = preview ? preview.offset + preview.rows.length : 0;

  return (
    <div className="min-w-0 space-y-5">
      <div className="panel p-5" data-testid="large-cleaning">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Large Dataset</p>
        <h2 className="mt-1 font-display text-2xl font-bold">{dataset.name}</h2>
        <p className="text-sm text-muted-foreground">
          {(session?.rowCount ?? dataset.row_count ?? 0).toLocaleString()} rows · {session?.columnCount ?? dataset.column_count ?? 0} columns
        </p>
        <p className="mt-2 text-sm">DataSimplr is using optimized processing for this file.</p>
        {session && session.excludedRows > 0 && <p className="mt-2 text-xs text-muted-foreground">{session.structuralNotes.join(" ")}</p>}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link to="/analyze" search={{ dataset: dataset.id }} className="text-primary hover:underline">Analyzer</Link>
          <Link to="/chat" search={{ c: undefined, dataset: dataset.id, version: undefined, sheet: undefined, explain: undefined }} className="text-primary hover:underline">AI Chat</Link>
          <Link to="/lab" search={{ dataset: dataset.id, version: undefined, sheet: undefined }} className="text-primary hover:underline">PythonLab</Link>
        </div>
      </div>

      {readOnly && <p className="text-sm text-muted-foreground">You can review this dataset. Only the owner can clean or finalize it.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-primary">{message}</p>}

      {quality && (
        <div className="panel p-5">
          <p className="font-display text-3xl font-bold text-primary">{quality.score.overall}</p>
          <p className="text-xs text-muted-foreground">Quality score out of 100. Calculated on the loaded dataset.</p>
          <div className="mt-4 space-y-2">
            {BARS.map((bar) => (
              <div key={bar.key}>
                <div className="flex justify-between text-xs">
                  <span>{bar.label}</span>
                  <span>{quality.score[bar.key]}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${quality.score[bar.key]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm">
            <span>Showing rows {preview.rows.length ? `${from.toLocaleString()}–${to.toLocaleString()}` : "0"} of {preview.total.toLocaleString()}</span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => void turn(page - 1)}>Previous</Button>
              <Button type="button" variant="outline" size="sm" disabled={!preview || to >= preview.total} onClick={() => void turn(page + 1)}>Next</Button>
            </span>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted">
                <tr>{preview.columns.map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={`${preview.offset}-${index}`} className="border-t border-border">
                    {row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-[14rem] truncate px-3 py-1.5">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel space-y-3 p-5">
        <p className="font-semibold">Data quality</p>
        {(quality?.issues ?? []).map((issue) => (
          <div key={issue.id} className="rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">{issue.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{issue.reason}</p>
            <p className="mt-1 text-xs">{issue.affectedCount.toLocaleString()} rows · {issue.severity === "safe" ? "Safe to apply" : "Review"}</p>
            {issue.sample.length > 0 && (
              <ul className="mt-1 text-xs text-muted-foreground">
                {issue.sample.map((sample, index) => (
                  <li key={index}>Row {sample.rowIndex}: {sample.before}{sample.after ? ` → ${sample.after}` : ""}</li>
                ))}
              </ul>
            )}
            {issue.canApply && issue.action && !readOnly && (
              <Button type="button" size="sm" className="mt-2" disabled={busy !== null} onClick={() => void apply(issue.action!, issue.reason, issue.column)}>
                {busy === issue.action.type ? "Applying…" : "Apply"}
              </Button>
            )}
          </div>
        ))}
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy !== null || !log.length} onClick={() => void undo()}>Undo last action</Button>
            <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void resetOriginal()}>Reset to original</Button>
            <Button type="button" size="sm" disabled={busy !== null || !session} onClick={() => void finalize()}>Finalize</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!session} onClick={() => void downloadCurrent()}>Download current</Button>
          <Button type="button" variant="outline" size="sm" disabled={!original()} onClick={() => { const source = original(); if (source) void downloadDatasetFile(dataset, source); }}>
            Download original
          </Button>
        </div>
      </div>

      <div className="panel p-5">
        <p className="font-semibold">Cleaning log</p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {log.length === 0 && <li>No changes have been recorded.</li>}
          {log.slice(0, 20).map((entry) => (
            <li key={entry.id}>
              {entry.row_reference === "all" ? entry.new_value ?? entry.reason : `Row ${entry.row_reference}: ${entry.original_value} → ${entry.new_value}`}
            </li>
          ))}
        </ul>
      </div>

      <div className="panel p-5 text-sm">
        <p className="font-semibold">Versions</p>
        <ul className="mt-2 space-y-1 text-xs">
          {versions.map((version) => (
            <li key={version.id}>
              {version.kind} v{version.version_number}
              {version.row_count != null ? ` · ${version.row_count.toLocaleString()} rows` : ""}
              {version.id === dataset.current_version_id ? " · current" : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  async function turn(nextPage: number) {
    if (!session) return;
    const engine = await import("@/lib/large-data/engine");
    const next = await engine.previewPage(session.id, nextPage * LARGE_DATA.previewPageSize);
    setPreview(next);
    setPage(nextPage);
  }
}

function parseAction(raw: string | null): CleanAction | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as CleanAction;
    if (!value || typeof value !== "object" || !("type" in value)) return null;
    if (value.type !== "trim" && value.type !== "categories" && value.type !== "fill_missing" && value.type !== "drop_duplicate_rows") return null;
    return value;
  } catch {
    return null;
  }
}
