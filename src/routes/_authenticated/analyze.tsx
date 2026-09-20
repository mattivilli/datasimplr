import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell } from "@/components/workspace/shell";
import { AnalyticsStudio } from "@/components/workspace/analytics-studio";

export const Route = createFileRoute("/_authenticated/analyze")({
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

  return (
    <WorkspaceShell
      title="Upload & Analyze"
      subtitle="Excel, CSV or JSON — clean, model and save the result to your workspace."
    >
      <AnalyticsStudio
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
