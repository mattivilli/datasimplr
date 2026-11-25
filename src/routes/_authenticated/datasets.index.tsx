import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, FolderPlus, Loader2, MessageSquare, SquareArrowOutUpRight, Sparkles, Terminal, Trash2 } from "lucide-react";
import { WorkspaceShell, useProfile } from "@/components/workspace/shell";
import { TeamShareSelect } from "@/components/billing/team-share-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addFolder,
  cleanFolderName,
  dissolveFolder,
  folderSummaries,
  isPartFolder,
  loadFolderPrefs,
  moveDataset,
  renameFolder,
  resolvedFolder,
  saveFolderPrefs,
  unsortedCount,
  type FolderPrefs,
} from "@/lib/dataset-folders";
import { deleteDataset, downloadDatasetFile, getVersion, listDatasetsWithCurrentVersion, type DatasetRow } from "@/lib/dataset-library";
import { useConfirm } from "@/components/confirm/confirm-provider";
import { useRefreshEntitlements } from "@/lib/entitlements";

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Original",
  cleaning: "Cleaning in progress",
  finalized: "Finalized",
};

export const Route = createFileRoute("/_authenticated/datasets/")({
  head: () => ({
    meta: [
      { title: "My Datasets — DataSimplr Workspace" },
      { name: "description", content: "Every dataset you've saved, ready to reopen without re-uploading." },
      { property: "og:title", content: "My Datasets — DataSimplr Workspace" },
      {
        property: "og:description",
        content: "Every dataset you've saved, ready to reopen without re-uploading.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DatasetsPage,
});

function DatasetsPage() {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { data, isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasetsWithCurrentVersion,
  });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const confirm = useConfirm();
  const refreshEntitlements = useRefreshEntitlements();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<FolderPrefs>({ folders: [], byId: {} });
  const [foldersReady, setFoldersReady] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState("__all__");
  const [folderDraft, setFolderDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    setPrefs(loadFolderPrefs());
    setFoldersReady(true);
  }, []);

  useEffect(() => {
    if (selectedFolder !== "__all__" && selectedFolder !== "__none__") setRenameDraft(selectedFolder);
  }, [selectedFolder]);

  const remember = (next: FolderPrefs) => {
    setPrefs(next);
    saveFolderPrefs(next);
  };

  const remove = async (dataset: DatasetRow) => {
    const ok = await confirm({
      title: `Delete \u201c${dataset.name}\u201d?`,
      description:
        "This permanently deletes the dataset, every saved version of it (original, working and finalized) and its cleaning history. This cannot be undone.",
      confirmLabel: "Delete dataset",
      destructive: true,
    });
    if (!ok) return;
    setDeletingId(dataset.id);
    setDeleteError(null);
    try {
      await deleteDataset(dataset.id);
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      refreshEntitlements();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete that dataset.");
    } finally {
      setDeletingId(null);
    }
  };

  const download = async (dataset: DatasetRow) => {
    if (!dataset.current_version_id) return;
    setDownloadingId(dataset.id);
    setDownloadError(null);
    try {
      const version = await getVersion(dataset.current_version_id);
      if (!version) throw new Error("That file could not be found.");
      await downloadDatasetFile(dataset, version);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Could not download that dataset.");
    } finally {
      setDownloadingId(null);
    }
  };

  const rows = data ?? [];
  const summaries = foldersReady ? folderSummaries(rows, prefs) : [];
  const grouped = summaries.filter((folder) => folder.count > 0);
  const loose = foldersReady ? unsortedCount(rows, prefs) : rows.length;
  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`;

  const renderCard = (d: (typeof rows)[number]) => (
          <div key={d.id} className="panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                  {STATUS_LABEL[d.status] ?? d.status}
                  {profile && d.user_id !== profile.id && <span className="ml-2 text-primary">· Shared by teammate</span>}
                </p>
                <Link
                  to="/datasets/$id"
                  params={{ id: d.id }}
                  className="mt-1.5 block truncate font-display text-base font-semibold hover:text-primary"
                >
                  {d.name}
                </Link>
              </div>
              {d.currentVersion?.quality_score !== null && d.currentVersion?.quality_score !== undefined && (
                <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-primary">
                  {d.currentVersion.quality_score}/100
                </span>
              )}
            </div>
            <p className="mt-3 font-mono text-[10px] tracking-widest text-subtle">
              {(d.currentVersion?.row_count ?? d.row_count ?? 0).toLocaleString()} rows ×{" "}
              {d.currentVersion?.column_count ?? d.column_count ?? 0} columns ·{" "}
              {new Date(d.updated_at).toLocaleString()}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/datasets/$id" params={{ id: d.id }}>
                  <Sparkles className="mr-1.5 size-3.5" />
                  Analyze quality
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/analyze" search={{ dataset: d.id }}>
                  <SquareArrowOutUpRight className="mr-1.5 size-3.5" />
                  Open in Analyzer
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/chat" search={{ c: undefined, dataset: d.id, version: undefined, sheet: undefined, explain: undefined }}>
                  <MessageSquare className="mr-1.5 size-3.5" />
                  Chat
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/lab" search={{ dataset: d.id, version: undefined, sheet: undefined }}>
                  <Terminal className="mr-1.5 size-3.5" />
                  PythonLab
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => download(d)} disabled={downloadingId === d.id}>
                {downloadingId === d.id ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 size-3.5" />
                )}
                Download
              </Button>
              {(!profile || d.user_id === profile.id) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void remove(d)}
                  disabled={deletingId === d.id}
                  aria-label={`Delete ${d.name}`}
                >
                  {deletingId === d.id ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 size-3.5" />
                  )}
                  Delete
                </Button>
              )}
            </div>
            {foldersReady && (
              <label className="mt-3 block max-w-xs text-[11px] text-muted-foreground">
                Folder
                <select
                  data-testid="dataset-move"
                  aria-label={`Folder for ${d.name}`}
                  className="mt-1 block w-full rounded-lg border border-border bg-muted px-2 py-1 text-sm text-foreground"
                  value={resolvedFolder(d, rows, prefs) ?? ""}
                  onChange={(event) => remember(moveDataset(prefs, d.id, event.target.value))}
                >
                  <option value="">No folder</option>
                  {summaries.map((folder) => (
                    <option key={folder.name} value={folder.name}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {profile && d.user_id === profile.id && (
              <div className="mt-3 max-w-xs">
                <TeamShareSelect
                  compact
                  table="datasets"
                  rowId={d.id}
                  teamId={d.team_id}
                  onChanged={() => queryClient.invalidateQueries({ queryKey: ["datasets"] })}
                />
              </div>
            )}
          </div>
  );

  const createFolder = (event: FormEvent) => {
    event.preventDefault();
    const name = cleanFolderName(folderDraft);
    if (!name) return;
    const next = addFolder(prefs, name);
    if (next !== prefs) remember(next);
    setSelectedFolder(name);
    setFolderDraft("");
  };

  return (
    <WorkspaceShell
      title="My Datasets"
      subtitle="Saved server-side — reopen them any time without re-uploading."
      actions={
        <Button asChild size="sm">
          <Link to="/analyze" search={{ dataset: undefined }}>Upload a dataset</Link>
        </Button>
      }
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && data?.length === 0 && (
        <div className="panel p-10 text-center">
          <Database className="mx-auto size-6 text-primary" />
          <p className="mt-3 font-display text-base font-semibold">No saved datasets yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a file in Upload &amp; Analyze, then click "Save to My Datasets" to keep it here.
          </p>
          <Button asChild className="mt-5">
            <Link to="/analyze" search={{ dataset: undefined }}>Upload & analyze</Link>
          </Button>
        </div>
      )}

      {downloadError && <p className="mb-4 text-sm text-destructive">{downloadError}</p>}
      {deleteError && <p className="mb-4 text-sm text-destructive">{deleteError}</p>}

      {foldersReady && rows.length > 0 && (
        <div className="mb-4 space-y-3" data-testid="dataset-folders">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chipClass(selectedFolder === "__all__")} data-testid="dataset-folder-all" onClick={() => setSelectedFolder("__all__")}>
              All {rows.length}
            </button>
            {summaries.map((folder) => (
              <button
                key={folder.name}
                type="button"
                className={chipClass(selectedFolder === folder.name)}
                data-testid="dataset-folder-chip"
                onClick={() => setSelectedFolder(folder.name)}
              >
                {folder.name} {folder.count}
              </button>
            ))}
            <button type="button" className={chipClass(selectedFolder === "__none__")} data-testid="dataset-folder-none" onClick={() => setSelectedFolder("__none__")}>
              No folder {loose}
            </button>
          </div>
          <form className="flex flex-wrap items-center gap-2" onSubmit={createFolder}>
            <Input
              value={folderDraft}
              onChange={(event) => setFolderDraft(event.target.value)}
              placeholder="New folder name"
              aria-label="New folder name"
              className="h-8 max-w-xs"
              data-testid="dataset-folder-name"
            />
            <Button type="submit" size="sm" variant="outline">
              <FolderPlus className="mr-1.5 size-3.5" />
              New folder
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            A large file is saved as filename_1, filename_2, and so on, and those parts share a folder.
            Move any dataset with the Folder list on its card. Folders you create stay in this browser.
          </p>
          {selectedFolder !== "__all__" && selectedFolder !== "__none__" && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                aria-label="Rename folder"
                className="h-8 max-w-xs"
                data-testid="dataset-folder-rename"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const name = cleanFolderName(renameDraft);
                  if (!name || name === selectedFolder) return;
                  remember(renameFolder(prefs, rows, selectedFolder, name));
                  setSelectedFolder(name);
                }}
              >
                Rename
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  remember(dissolveFolder(prefs, rows, selectedFolder));
                  setSelectedFolder("__all__");
                }}
              >
                Ungroup
              </Button>
            </div>
          )}
        </div>
      )}

      {foldersReady && selectedFolder === "__all__" && grouped.length > 0 ? (
        <div className="space-y-6">
          {grouped.map((folder) => {
            const members = rows.filter((dataset) => resolvedFolder(dataset, rows, prefs) === folder.name);
            return (
              <section key={folder.name} data-testid="dataset-folder-section">
                <h2 className="font-display text-base font-semibold">{folder.name}</h2>
                {isPartFolder(folder.name, members) && (
                  <p className="mt-1 text-xs text-muted-foreground">Parts of one file. Combined analysis uses every part.</p>
                )}
                <div className="mt-3 grid gap-4 md:grid-cols-2">{members.map((dataset) => renderCard(dataset))}</div>
              </section>
            );
          })}
          {loose > 0 && (
            <section data-testid="dataset-folder-section">
              <h2 className="font-display text-base font-semibold">No folder</h2>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {rows.filter((dataset) => resolvedFolder(dataset, rows, prefs) == null).map((dataset) => renderCard(dataset))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(() => {
            const visible =
              foldersReady && selectedFolder !== "__all__"
                ? rows.filter((dataset) =>
                    selectedFolder === "__none__"
                      ? resolvedFolder(dataset, rows, prefs) == null
                      : resolvedFolder(dataset, rows, prefs) === selectedFolder,
                  )
                : rows;
            if (foldersReady && selectedFolder !== "__all__" && selectedFolder !== "__none__" && visible.length === 0) {
              return (
                <p className="text-sm text-muted-foreground" data-testid="dataset-folder-empty">
                  Nothing in this folder yet. Use Folder on a dataset to move it here.
                </p>
              );
            }
            return visible.map((dataset) => renderCard(dataset));
          })()}
        </div>
      )}
    </WorkspaceShell>
  );
}
