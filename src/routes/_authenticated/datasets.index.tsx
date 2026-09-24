import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Download, Loader2, SquareArrowOutUpRight, Sparkles } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";
import { downloadDatasetFile, getVersion, listDatasetsWithCurrentVersion, type DatasetRow, type DatasetVersionRow } from "@/lib/dataset-library";

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
  const { data, isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasetsWithCurrentVersion,
  });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((d) => (
          <div key={d.id} className="panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                  {STATUS_LABEL[d.status] ?? d.status}
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
              <Button size="sm" variant="outline" onClick={() => download(d)} disabled={downloadingId === d.id}>
                {downloadingId === d.id ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 size-3.5" />
                )}
                Download
              </Button>
            </div>
          </div>
        ))}
      </div>
    </WorkspaceShell>
  );
}
