import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell } from "@/components/workspace/shell";
import { AnalyticsStudio } from "@/components/workspace/analytics-studio";
import { QuotaError, getDataset, getVersion, loadDatasetTable, saveDataset } from "@/lib/dataset-library";
import { useUpgrade } from "@/components/billing/upgrade";
import { checkDatasetQuota, useEntitlements, useRefreshEntitlements } from "@/lib/entitlements";
import { PLAN_LIMITS, QUOTA_MESSAGES, formatBytes, type QuotaReason } from "@/lib/plans";
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
  const upgrade = useUpgrade();
  const { data: ent } = useEntitlements();
  const refreshEntitlements = useRefreshEntitlements();

  const promptUpgrade = (reason: QuotaReason, fileSize: number) => {
    const detail =
      reason === "file_too_large"
        ? `This file is ${formatBytes(fileSize)}; your plan allows up to ${formatBytes(ent?.limits.maxFileBytes ?? 0)}. Plus handles ${formatBytes(PLAN_LIMITS.plus.maxFileBytes)}, Pro ${formatBytes(PLAN_LIMITS.pro.maxFileBytes)}.`
        : reason === "monthly_limit"
          ? "Your analysis is still here — upgrade and save it straight away. Plus saves 30 datasets a month, Pro is unlimited."
          : "Upgrade for more room — Plus has 2 GB, Pro 10 GB.";
    upgrade.open({ title: QUOTA_MESSAGES[reason], reason: detail });
  };
  const [initialDataset, setInitialDataset] = useState<
    { table: Table; sourceName: string; sourceFile: File; sheetName: string | null } | null
  >(null);
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
        if (!cancelled) setInitialDataset({ table, sourceName, sourceFile: file, sheetName: version.sheet_name });
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
        insightLimit={ent?.enforced && ent.plan === "free" ? PLAN_LIMITS.free.insightPreview : null}
        onUnlockInsights={() =>
          upgrade.open({
            title: "See every insight",
            reason: "Free shows the top 3 insights. Plus and Pro show the full list for every dataset.",
          })
        }
        onSaveDataset={async (payload) => {
          const reason = await checkDatasetQuota(payload.file.size);
          if (reason) {
            promptUpgrade(reason, payload.file.size);
            throw new Error(QUOTA_MESSAGES[reason]);
          }
          const { data: auth } = await supabase.auth.getUser();
          try {
            await saveDataset({
              userId: auth.user!.id,
              file: payload.file,
              name: payload.name,
              rowCount: payload.rowCount,
              columnCount: payload.columnCount,
              sheetName: payload.sheetName ?? null,
            });
          } catch (e) {
            if (e instanceof QuotaError) promptUpgrade("monthly_limit", payload.file.size);
            throw e;
          } finally {
            refreshEntitlements();
          }
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
