import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";
import type { Finding } from "@/lib/analysis";

export const Route = createFileRoute("/_authenticated/analyses/$id")({
  head: () => ({
    meta: [
      { title: "Analysis — DataSimplr Workspace" },
      { name: "description", content: "A saved analysis with its findings." },
      { property: "og:title", content: "Analysis — DataSimplr Workspace" },
      { property: "og:description", content: "A saved analysis with its findings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalysisDetail,
});

function AnalysisDetail() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["analysis", id],
    queryFn: async () => {
      const { data } = await supabase.from("analyses").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  const findings = (data?.findings ?? []) as Finding[];

  return (
    <WorkspaceShell
      title={data?.title ?? "Analysis"}
      subtitle={data ? `${data.tool} · ${data.source_name ?? ""}` : undefined}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/analyses">
            <ArrowLeft className="mr-1.5 size-4" /> All analyses
          </Link>
        </Button>
      }
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && !data && (
        <div className="panel p-10 text-center">
          <p className="font-display text-base font-semibold">This analysis no longer exists</p>
          <Button asChild className="mt-5">
            <Link to="/analyses">Back to analyses</Link>
          </Button>
        </div>
      )}

      {data && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="panel p-6">
            <span className="eyebrow">Summary</span>
            <p className="mt-3 font-display text-lg font-semibold leading-snug">{data.summary}</p>

            {findings.length > 0 && (
              <div className="mt-6 overflow-hidden rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted">
                    <tr>
                      {["Item", "Result", "Detail"].map((h) => (
                        <th
                          key={h}
                          className="px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-subtle"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {findings.map((f, i) => (
                      <tr key={`${f.label}-${i}`} className="border-t border-border">
                        <td className="px-3.5 py-2.5 font-mono text-xs text-foreground">{f.label}</td>
                        <td className="px-3.5 py-2.5 text-foreground">{f.value}</td>
                        <td className="px-3.5 py-2.5 text-xs text-muted-foreground">{f.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel h-fit p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Details</p>
            <dl className="mt-4 space-y-3 text-sm">
              {[
                ["Tool", data.tool],
                ["Source", data.source_name ?? "—"],
                ["Type", data.source_type],
                ["Status", data.status],
                ["Created", new Date(data.created_at).toLocaleString()],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate text-foreground">{v as string}</dd>
                </div>
              ))}
            </dl>
            <Button asChild className="mt-5 w-full">
              <Link to="/analyze">Run another tool</Link>
            </Button>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
