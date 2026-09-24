import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";
import type { Table } from "@/lib/analysis";
import { analyzeQuality, applyIssue, type QualityIssue, type QualityReport } from "@/lib/data-quality";
import {
  deleteCleaningLogEntries,
  downloadDatasetFile,
  finalizeDataset,
  getCleaningLogForDataset,
  getDataset,
  getVersion,
  listVersions,
  loadDatasetTable,
  logCleaningChanges,
  saveWorkingVersion,
  type CleaningLogRow,
  type DatasetRow,
  type DatasetVersionRow,
} from "@/lib/dataset-library";

export const Route = createFileRoute("/_authenticated/datasets/$id")({
  head: () => ({
    meta: [
      { title: "Dataset — DataSimplr Workspace" },
      { name: "description", content: "Review data quality, clean issues and finalize this dataset." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DatasetWorkspace,
});

const KIND_LABEL: Record<string, string> = { original: "Original", working: "Cleaning in progress", finalized: "Finalized" };

function DatasetWorkspace() {
  const { id } = Route.useParams();
  const [dataset, setDataset] = useState<DatasetRow | null>(null);
  const [versions, setVersions] = useState<DatasetVersionRow[]>([]);
  const [workingVersion, setWorkingVersion] = useState<DatasetVersionRow | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [log, setLog] = useState<CleaningLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIssue, setBusyIssue] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [finalizing, setFinalizing] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const ds = await getDataset(id);
      if (!ds) throw new Error("Dataset not found.");
      const vs = await listVersions(id);
      const current = ds.current_version_id ? await getVersion(ds.current_version_id) : vs[0] ?? null;
      if (!current) throw new Error("This dataset has no stored version.");
      const { table: loaded } = await loadDatasetTable(ds, current);
      setDataset(ds);
      setVersions(vs);
      // Only an in-progress working copy is editable in place; original and
      // finalized versions are immutable, so editing them starts a new working version.
      setWorkingVersion(current.kind === "working" ? current : null);
      setTable(loaded);
      setLog(await getCleaningLogForDataset(ds.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this dataset.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const report: QualityReport | null = useMemo(() => (table ? analyzeQuality(table) : null), [table]);
  const originalVersion = versions.find((v) => v.kind === "original") ?? null;

  const toggleExpand = (issueId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(issueId) ? next.delete(issueId) : next.add(issueId);
      return next;
    });
  };

  const ignore = (issueId: string) => {
    setIgnored((prev) => new Set(prev).add(issueId));
  };

  const persistWorkingTable = async (nextTable: Table, score: number) => {
    if (!dataset) return null;
    const { data: auth } = await supabase.auth.getUser();
    const saved = await saveWorkingVersion({
      dataset,
      table: nextTable,
      userId: auth.user!.id,
      qualityScore: score,
      existingWorkingVersion: workingVersion,
    });
    setWorkingVersion(saved);
    setVersions((prev) => (prev.some((v) => v.id === saved.id) ? prev.map((v) => (v.id === saved.id ? saved : v)) : [...prev, saved]));
    return saved;
  };

  const apply = async (issue: QualityIssue) => {
    if (!table || !dataset || !report) return;
    setBusyIssue(issue.id);
    setError(null);
    try {
      const outcome = applyIssue(table, issue);
      const nextTable = outcome.table;
      const nextScore = analyzeQuality(nextTable).score.overall;
      const saved = await persistWorkingTable(nextTable, nextScore);
      if (!saved) return;
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user!.id;
      const entries = [
        ...outcome.cellChanges.map((c) => ({
          datasetId: dataset.id,
          datasetVersionId: saved.id,
          userId,
          rowReference: String(c.rowIndex),
          columnName: c.column,
          originalValue: c.before,
          newValue: c.after,
          operation: issue.kind,
          reason: issue.reason,
        })),
        ...outcome.removedRows.map((r) => ({
          datasetId: dataset.id,
          datasetVersionId: saved.id,
          userId,
          rowReference: String(r.rowIndex),
          columnName: null,
          originalValue: JSON.stringify(r.row),
          newValue: null,
          operation: "remove_row",
          reason: issue.reason,
        })),
      ];
      await logCleaningChanges(entries);
      setTable(nextTable);
      setLog(await getCleaningLogForDataset(dataset.id));
      setIgnored((prev) => {
        const next = new Set(prev);
        next.delete(issue.id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply that correction.");
    } finally {
      setBusyIssue(null);
    }
  };

  const undoLastOperation = async () => {
    if (!table || !dataset || !workingVersion || !log.length) return;
    setUndoing(true);
    setError(null);
    try {
      const latestTime = log[0]!.created_at;
      const batch = log.filter((entry) => entry.created_at === latestTime);
      let rows = table.rows.map((r) => [...r]);
      for (const entry of batch) {
        if (entry.operation === "remove_row") {
          const idx = Number(entry.row_reference);
          const row = JSON.parse(entry.original_value ?? "[]") as string[];
          rows.splice(Math.min(idx, rows.length), 0, row);
        } else if (entry.column_name) {
          const ci = table.columns.indexOf(entry.column_name);
          const idx = Number(entry.row_reference);
          if (ci >= 0 && rows[idx]) rows[idx]![ci] = entry.original_value ?? "";
        }
      }
      const nextTable = { columns: table.columns, rows };
      const nextScore = analyzeQuality(nextTable).score.overall;
      const saved = await persistWorkingTable(nextTable, nextScore);
      await deleteCleaningLogEntries(batch.map((b) => b.id));
      setTable(nextTable);
      if (saved) setLog(await getCleaningLogForDataset(dataset.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo that operation.");
    } finally {
      setUndoing(false);
    }
  };

  const restoreOriginal = async () => {
    if (!dataset || !originalVersion) return;
    setUndoing(true);
    setError(null);
    try {
      const { table: original } = await loadDatasetTable(dataset, originalVersion);
      const score = analyzeQuality(original).score.overall;
      const saved = await persistWorkingTable(original, score);
      setTable(original);
      if (saved) setLog(await getCleaningLogForDataset(dataset.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore the original.");
    } finally {
      setUndoing(false);
    }
  };

  const finalize = async () => {
    if (!table || !dataset || !report) return;
    setFinalizing(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      await finalizeDataset({ dataset, table, userId: auth.user!.id, qualityScore: report.score.overall });
      setConfirmFinalize(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finalize this dataset.");
    } finally {
      setFinalizing(false);
    }
  };

  const download = async () => {
    if (!dataset) return;
    const current = dataset.current_version_id ? await getVersion(dataset.current_version_id) : null;
    if (current) await downloadDatasetFile(dataset, current);
  };

  if (loading) {
    return (
      <WorkspaceShell title="Dataset" subtitle="Loading…">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading dataset…
        </p>
      </WorkspaceShell>
    );
  }

  if (error && !dataset) {
    return (
      <WorkspaceShell title="Dataset" subtitle="">
        <p className="text-sm text-destructive">{error}</p>
        <Button asChild className="mt-4" size="sm">
          <Link to="/datasets">Back to My Datasets</Link>
        </Button>
      </WorkspaceShell>
    );
  }

  if (!dataset || !table || !report) return null;

  const visibleIssues = report.issues.filter((i) => !ignored.has(i.id));
  const safeIssues = visibleIssues.filter((i) => i.severity === "safe");
  const reviewIssues = visibleIssues.filter((i) => i.severity === "review");
  return (
    <WorkspaceShell
      title={dataset.name}
      subtitle={`${KIND_LABEL[workingVersion?.kind ?? "original"] ?? "Original"} · ${table.rows.length.toLocaleString()} rows × ${table.columns.length} columns`}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={download}>
            <Download className="mr-1.5 size-3.5" /> Download
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/analyze" search={{ dataset: dataset.id }}>
              Analyze
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/chat" search={{ c: undefined, dataset: dataset.id, version: undefined, sheet: undefined, explain: undefined }}>
              Chat
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/lab" search={{ dataset: dataset.id, version: undefined, sheet: undefined }}>
              PythonLab
            </Link>
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Data quality</p>
                <p className="mt-1 font-display text-lg font-semibold">
                  ✓ {table.rows.length - new Set(reviewIssues.flatMap((i) => i.affectedRowIndexes)).size} rows with no flagged review issues
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {log.length > 0 && workingVersion && (
                  <Button size="sm" variant="outline" onClick={undoLastOperation} disabled={undoing}>
                    {undoing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Undo2 className="mr-1.5 size-3.5" />}
                    Undo last change
                  </Button>
                )}
                {originalVersion && workingVersion && (
                  <Button size="sm" variant="outline" onClick={restoreOriginal} disabled={undoing}>
                    Reset to original
                  </Button>
                )}
              </div>
            </div>

            {visibleIssues.length === 0 ? (
              <p className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-primary" /> No data-quality issues detected in this version.
              </p>
            ) : (
              <div className="mt-4 space-y-5">
                {safeIssues.length > 0 && (
                  <IssueGroup
                    title="Safe fixes"
                    hint="Deterministic corrections — same result every time, low risk to apply."
                    issues={safeIssues}
                    expanded={expanded}
                    busyIssue={busyIssue}
                    onToggle={toggleExpand}
                    onApply={apply}
                    onIgnore={ignore}
                  />
                )}
                {reviewIssues.length > 0 && (
                  <IssueGroup
                    title="Review required"
                    hint="Needs your judgement — nothing here is changed automatically."
                    issues={reviewIssues}
                    expanded={expanded}
                    busyIssue={busyIssue}
                    onToggle={toggleExpand}
                    onApply={apply}
                    onIgnore={ignore}
                  />
                )}
              </div>
            )}
          </div>

          {log.length > 0 && (
            <div className="panel p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Cleaning log</p>
              <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1 text-xs">
                {log.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border bg-muted px-3 py-2">
                    <span className="font-semibold">{entry.operation}</span>
                    {entry.column_name && <span className="text-muted-foreground"> · {entry.column_name}</span>}
                    <span className="text-muted-foreground"> · row {entry.row_reference}</span>
                    {entry.new_value !== null && (
                      <div className="mt-1 font-mono text-[11px] text-subtle">
                        {entry.original_value} → {entry.new_value}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-subtle">{new Date(entry.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel p-5">
            {!confirmFinalize ? (
              <Button onClick={() => setConfirmFinalize(true)} className="w-full">
                <ShieldCheck className="mr-2 size-4" /> Finalize dataset
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-semibold">Confirm finalization</p>
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                  <Stat label="Original rows" value={String(originalVersion?.row_count ?? table.rows.length)} />
                  <Stat label="Final rows" value={String(table.rows.length)} />
                  <Stat label="Changes applied" value={String(log.length)} />
                  <Stat label="Issues remaining" value={String(reviewIssues.length)} />
                  <Stat label="Issues ignored" value={String(ignored.size)} />
                  <Stat label="Quality score" value={`${report.score.overall}/100`} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={finalize} disabled={finalizing}>
                    {finalizing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                    Confirm & finalize
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmFinalize(false)} disabled={finalizing}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">DataSimplr quality score</p>
            <p className="mt-2 font-display text-3xl font-bold text-primary">{report.score.overall}</p>
            <p className="text-[11px] text-subtle">
              A DataSimplr-generated indicator (not an industry-standard metric), averaging the five signals below.
            </p>
            <div className="mt-4 space-y-2 text-xs">
              <ScoreBar label="Completeness" value={report.score.completeness} />
              <ScoreBar label="Consistency" value={report.score.consistency} />
              <ScoreBar label="Validity" value={report.score.validity} />
              <ScoreBar label="Uniqueness" value={report.score.uniqueness} />
              <ScoreBar label="Type correctness" value={report.score.typeCorrectness} />
            </div>
          </div>

          <div className="panel p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Versions</p>
            <div className="mt-3 space-y-2 text-xs">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2">
                  <span>
                    v{v.version_number} · {KIND_LABEL[v.kind] ?? v.kind}
                  </span>
                  <span className="text-subtle">{v.quality_score !== null ? `${v.quality_score}/100` : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function IssueGroup({
  title,
  hint,
  issues,
  expanded,
  busyIssue,
  onToggle,
  onApply,
  onIgnore,
}: {
  title: string;
  hint: string;
  issues: QualityIssue[];
  expanded: Set<string>;
  busyIssue: string | null;
  onToggle: (id: string) => void;
  onApply: (issue: QualityIssue) => void;
  onIgnore: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold">{title}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      <div className="mt-2 space-y-2">
        {issues.map((issue) => {
          const isOpen = expanded.has(issue.id);
          return (
            <div key={issue.id} className="rounded-xl border border-border bg-muted">
              <button
                type="button"
                onClick={() => onToggle(issue.id)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              >
                {isOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{issue.title}</span>
                <span className="shrink-0 text-[10px] text-subtle">{issue.affectedRowIndexes.length} rows</span>
              </button>
              {isOpen && (
                <div className="space-y-2.5 border-t border-border px-3 py-3">
                  <p className="text-xs text-muted-foreground">{issue.reason}</p>
                  <div className="space-y-1">
                    {issue.sample.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg bg-background px-2 py-1.5 font-mono text-[11px]">
                        <span className="text-subtle">row {s.rowIndex}</span>
                        <span className="truncate text-destructive">{s.before}</span>
                        {s.after && (
                          <>
                            <span className="text-subtle">→</span>
                            <span className="truncate text-primary">{s.after}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {issue.canApply && (
                      <Button size="sm" onClick={() => onApply(issue)} disabled={busyIssue === issue.id}>
                        {busyIssue === issue.id ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                        Apply
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => onIgnore(issue.id)}>
                      Ignore
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted px-2.5 py-2">
      <p className="font-mono text-[9px] uppercase tracking-widest text-subtle">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
