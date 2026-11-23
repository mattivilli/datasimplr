import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { WorkspaceShell } from "@/components/workspace/shell";
import { OperationalStudio } from "@/components/workspace/operational-studio";
import { listDatasetsWithCurrentVersion } from "@/lib/dataset-library";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/documents")({
  validateSearch: (search: Record<string, unknown>) => ({
    dataset: typeof search["dataset"] === "string" ? search["dataset"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Document Studio — DataSimplr Workspace" },
      { name: "description", content: "Generate Lean Six Sigma Project Charters, A3 drafts, check sheets, and data collection templates." },
      { property: "og:title", content: "Document Studio — DataSimplr Workspace" },
      { property: "og:description", content: "Generate Lean Six Sigma Project Charters, A3 drafts, check sheets, and data collection templates." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { dataset } = Route.useSearch();
  const { data: datasets, isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasetsWithCurrentVersion,
  });

  return (
    <WorkspaceShell
      title="Operational Document Studio"
      subtitle="Transform verified analysis into project charters, A3 problem-solving drafts, floor check sheets, and data templates."
    >
      {isLoading ? (
        <div className="panel p-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" /> Loading datasets…
        </div>
      ) : (
        <OperationalStudio savedDatasets={datasets ?? []} initialDatasetId={dataset} />
      )}
    </WorkspaceShell>
  );
}
