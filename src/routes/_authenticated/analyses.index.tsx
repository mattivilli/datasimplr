import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/analyses/")({
  head: () => ({
    meta: [
      { title: "Past Analyses — DataSimplr Workspace" },
      { name: "description", content: "Every dataset and paper you've analysed, with its results." },
      { property: "og:title", content: "Past Analyses — DataSimplr Workspace" },
      {
        property: "og:description",
        content: "Every dataset and paper you've analysed, with its results.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalysesPage,
});

function AnalysesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: async () => {
      const { data } = await supabase
        .from("analyses")
        .select("id, title, tool, source_name, summary, created_at")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const remove = async (id: string) => {
    await supabase.from("analyses").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["analyses"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  return (
    <WorkspaceShell
      title="Past Analyses"
      subtitle="Saved results from every dataset you've run."
      actions={
        <Button asChild size="sm">
          <Link to="/analyze" search={{ dataset: undefined }}>New analysis</Link>
        </Button>
      }
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && data?.length === 0 && (
        <div className="panel p-10 text-center">
          <FileText className="mx-auto size-6 text-primary" />
          <p className="mt-3 font-display text-base font-semibold">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a dataset or paste a few rows and run a tool — it'll be saved here.
          </p>
          <Button asChild className="mt-5">
            <Link to="/analyze" search={{ dataset: undefined }}>Upload & analyze</Link>
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((a) => (
          <div key={a.id} className="panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">{a.tool}</p>
                <Link
                  to="/analyses/$id"
                  params={{ id: a.id }}
                  className="mt-1.5 block truncate font-display text-base font-semibold hover:text-primary"
                >
                  {a.title}
                </Link>
              </div>
              <button
                aria-label="Delete analysis"
                onClick={() => remove(a.id)}
                className="text-subtle hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            {a.summary && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{a.summary}</p>}
            <p className="mt-3 font-mono text-[10px] tracking-widest text-subtle">
              {a.source_name} · {new Date(a.created_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </WorkspaceShell>
  );
}
