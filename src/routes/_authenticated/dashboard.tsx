import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, MessageSquare, Sparkles, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell, useProfile } from "@/components/workspace/shell";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — DataSimplr Workspace" },
      { name: "description", content: "Your saved chats, analyses and uploads at a glance." },
      { property: "og:title", content: "Dashboard — DataSimplr Workspace" },
      { property: "og:description", content: "Your saved chats, analyses and uploads at a glance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: profile } = useProfile();

  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [chats, analyses] = await Promise.all([
        supabase
          .from("conversations")
          .select("id, title, updated_at")
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase
          .from("analyses")
          .select("id, title, tool, summary, created_at")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      const counts = await Promise.all([
        supabase.from("conversations").select("id", { count: "exact", head: true }),
        supabase.from("analyses").select("id", { count: "exact", head: true }),
        supabase.from("messages").select("id", { count: "exact", head: true }),
      ]);
      return {
        chats: chats.data ?? [],
        analyses: analyses.data ?? [],
        chatCount: counts[0].count ?? 0,
        analysisCount: counts[1].count ?? 0,
        messageCount: counts[2].count ?? 0,
      };
    },
  });

  const stats = [
    { label: "Saved chats", value: data?.chatCount ?? 0 },
    { label: "Analyses run", value: data?.analysisCount ?? 0 },
    { label: "Messages", value: data?.messageCount ?? 0 },
  ];

  return (
    <WorkspaceShell
      title={`Welcome back, ${profile?.displayName ?? "there"}`}
      subtitle="Everything you've asked and analysed, saved to your account."
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="panel p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">{s.label}</p>
            <p className="mt-2 font-display text-3xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {[
          { to: "/chat", icon: MessageSquare, title: "Ask the AI", body: "Start a new saved chat." },
          { to: "/analyze", icon: Upload, title: "Upload & analyze", body: "Run a data science tool." },
          { to: "/analyses", icon: FileText, title: "Past analyses", body: "Revisit earlier results." },
        ].map((c) => (
          <Link key={c.to} to={c.to} className="panel group p-5 transition-colors hover:border-primary">
            <c.icon className="size-5 text-primary" />
            <p className="mt-3 font-display text-base font-semibold">{c.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs text-primary">
              Open <ArrowRight className="size-3" />
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">Recent chats</h2>
            <Link to="/chat" search={{ c: undefined, dataset: undefined, version: undefined, sheet: undefined, explain: undefined }} className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {(data?.chats.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">No chats yet — ask your first question.</p>
            )}
            {data?.chats.map((c) => (
              <Link
                key={c.id}
                to="/chat"
                search={{ c: c.id, dataset: undefined, version: undefined, sheet: undefined, explain: undefined }}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm transition-colors hover:border-primary"
              >
                <span className="truncate">{c.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-subtle">
                  {new Date(c.updated_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">Recent analyses</h2>
            <Link to="/analyses" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {(data?.analyses.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing analysed yet — upload a file or paste some rows.
              </p>
            )}
            {data?.analyses.map((a) => (
              <Link
                key={a.id}
                to="/analyses/$id"
                params={{ id: a.id }}
                className="block rounded-xl border border-border bg-muted px-3.5 py-2.5 transition-colors hover:border-primary"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate text-sm">{a.title}</span>
                </div>
                {a.summary && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{a.summary}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
