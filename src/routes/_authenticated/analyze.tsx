import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell } from "@/components/workspace/shell";
import { AnalyticsStudio } from "@/components/workspace/analytics-studio";
import { getDataset, getVersion, loadDatasetTable, saveDataset } from "@/lib/dataset-library";
import type { Table } from "@/lib/analysis";

export const Route = createFileRoute("/_authenticated/analyze")({
  validateSearch: (search: Record<string, unknown>) => ({
    dataset: typeof search["dataset"] === "string" ? search["dataset"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Upload & Analyze — DataSimplr Workspace" },
      { name: "description", content: "Upload a dataset and run cleaning, stats, regression, clustering and PCA." },
      { property: "og:title", content: "Upload & Analyze — DataSimplr Workspace" },
      {
        property: "og:description",
        content: "Upload a dataset and run cleaning, stats, regression, clustering and PCA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalyzePage,
});

function AnalyzePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dataset: datasetId } = Route.useSearch();
  const [initialDataset, setInitialDataset] = useState<{ table: Table; sourceName: string; sourceFile: File } | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    (async () => {
      try {
        const dataset = await getDataset(datasetId);
        if (!dataset?.current_version_id) throw new Error("That dataset has no saved version.");
        const version = await getVersion(dataset.current_version_id);
        if (!version) throw new Error("That dataset's file could not be found.");
        const { table, sourceName, file } = await loadDatasetTable(dataset, version);
        if (!cancelled) setInitialDataset({ table, sourceName, sourceFile: file });
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not open that dataset.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  return (
    <WorkspaceShell
      title="Upload & Analyze"
      subtitle="Excel, CSV or JSON — clean, model and save the result to your workspace."
    >
      {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}
      <AnalyticsStudio
        initialDataset={initialDataset}
        onSaveDataset={async (payload) => {
          const { data: auth } = await supabase.auth.getUser();
          await saveDataset({
            userId: auth.user!.id,
            file: payload.file,
            name: payload.name,
            rowCount: payload.rowCount,
            columnCount: payload.columnCount,
          });
          queryClient.invalidateQueries({ queryKey: ["datasets"] });
        }}
        onSave={async (payload) => {
          const { data: auth } = await supabase.auth.getUser();
          const { data, error: err } = await supabase
            .from("analyses")
            .insert({
              user_id: auth.user!.id,
              title: payload.title,
              source_name: payload.sourceName,
              source_type: payload.sourceType,
              tool: payload.tool,
              status: "complete",
              summary: payload.summary,
              findings: payload.findings,
            })
            .select("id")
            .single();
          if (err) throw err;
          queryClient.invalidateQueries({ queryKey: ["analyses"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          await navigate({ to: "/analyses/$id", params: { id: data.id } });
        }}
      />
    </WorkspaceShell>
  );
}
