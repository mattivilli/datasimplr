import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, Lock, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell, useProfile } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";
import { useUpgrade } from "@/components/billing/upgrade";
import { TeamShareSelect } from "@/components/billing/team-share-select";
import { isPaid, useEntitlements, useRefreshEntitlements } from "@/lib/entitlements";
import { PLAN_LIMITS } from "@/lib/plans";
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

const WATERMARK = "Made with DataSimplr Free — upgrade at datasimplr.com to remove this line";

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadCsv(title: string, summary: string, findings: Finding[], watermark: boolean) {
  const lines = [
    ["Item", "Result", "Detail"].join(","),
    ...findings.map((f) => [f.label, f.value, f.note ?? ""].map(csvCell).join(",")),
    "",
    ["Summary", summary].map(csvCell).join(","),
    ...(watermark ? [csvCell(WATERMARK)] : []),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w\- ]+/g, "").trim() || "analysis"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Opens a clean printable report; the browser's print dialog saves it as PDF.
function printReport(title: string, meta: string, summary: string, findings: Finding[], watermark: boolean) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  const rows = findings
    .map((f) => `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(f.value)}</td><td>${escapeHtml(f.note ?? "")}</td></tr>`)
    .join("");
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
body{font-family:system-ui,sans-serif;color:#111;margin:40px;max-width:820px}
h1{font-size:22px;margin:0 0 4px}.meta{color:#666;font-size:12px;margin-bottom:20px}
p.summary{font-size:15px;line-height:1.5}
table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}
th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666}
.wm{margin-top:32px;padding-top:12px;border-top:1px dashed #bbb;color:#16a34a;font-size:12px;text-align:center}
</style></head><body><h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(meta)}</div>
<p class="summary">${escapeHtml(summary)}</p>
<table><thead><tr><th>Item</th><th>Result</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>
${watermark ? `<div class="wm">${escapeHtml(WATERMARK)}</div>` : ""}
</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

function AnalysisDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { data: ent } = useEntitlements();
  const refreshEntitlements = useRefreshEntitlements();
  const upgrade = useUpgrade();
  const [redeeming, setRedeeming] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["analysis", id],
    queryFn: async () => {
      const { data } = await supabase.from("analyses").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  // A Report Pass redeemed on this analysis unlocks it for its owner.
  const { data: unlocked } = useQuery({
    queryKey: ["analysis-unlocked", id],
    enabled: !!ent?.enforced,
    queryFn: async () => {
      const { data } = await supabase.from("report_credits").select("id").eq("analysis_id", id).maybeSingle();
      return !!data;
    },
  });

  const findings = (data?.findings ?? []) as Finding[];
  const full = isPaid(ent) || !!unlocked;
  const limit = PLAN_LIMITS.free.insightPreview ?? 3;
  const visible = full ? findings : findings.slice(0, limit);
  const hidden = full ? [] : findings.slice(limit);
  const isOwner = !!data && data.user_id === profile?.id;
  const credits = ent?.reportCredits ?? 0;
  const meta = data ? `${data.tool} · ${data.source_name ?? ""} · ${new Date(data.created_at).toLocaleString()}` : "";

  const unlock = async () => {
    setUnlockError(null);
    if (isOwner && credits > 0) {
      setRedeeming(true);
      const { error } = await supabase.rpc("redeem_report_credit", { _analysis: id });
      setRedeeming(false);
      if (error) setUnlockError(error.message);
      await queryClient.invalidateQueries({ queryKey: ["analysis-unlocked", id] });
      refreshEntitlements();
      return;
    }
    upgrade.open({
      title: hidden.length ? `${hidden.length} more finding${hidden.length === 1 ? "" : "s"} in this analysis` : "Export clean reports",
      reason: "Upgrade to see every finding and export without a watermark — or unlock just this one report.",
      offerReportPass: isOwner,
      onPurchased: () => queryClient.invalidateQueries({ queryKey: ["analysis-unlocked", id] }),
    });
  };

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
              <div className="relative mt-6 overflow-hidden rounded-xl border border-border">
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
                    {visible.map((f, i) => (
                      <tr key={`${f.label}-${i}`} className="border-t border-border">
                        <td className="px-3.5 py-2.5 font-mono text-xs text-foreground">{f.label}</td>
                        <td className="px-3.5 py-2.5 text-foreground">{f.value}</td>
                        <td className="px-3.5 py-2.5 text-xs text-muted-foreground">{f.note}</td>
                      </tr>
                    ))}
                    {hidden.map((f, i) => (
                      <tr key={`hidden-${i}`} aria-hidden className="pointer-events-none select-none border-t border-border blur-[5px]">
                        <td className="px-3.5 py-2.5 font-mono text-xs">{f.label}</td>
                        <td className="px-3.5 py-2.5">{f.value}</td>
                        <td className="px-3.5 py-2.5 text-xs text-muted-foreground">{f.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hidden.length > 0 && (
                  <div className="absolute inset-x-0 bottom-0 flex justify-center pb-4">
                    <button
                      type="button"
                      onClick={unlock}
                      disabled={redeeming}
                      className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_12px_32px_-12px_var(--glow)]"
                    >
                      {redeeming ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
                      {isOwner && credits > 0
                        ? `Unlock with Report Pass (${credits} left)`
                        : `${hidden.length} more finding${hidden.length === 1 ? "" : "s"} — unlock`}
                    </button>
                  </div>
                )}
              </div>
            )}
            {unlockError && <p className="mt-3 text-sm text-destructive">{unlockError}</p>}
          </div>

          <div className="space-y-4">
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
                <Link to="/analyze" search={{ dataset: undefined }}>Run another tool</Link>
              </Button>
            </div>

            <div className="panel h-fit space-y-2.5 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Export &amp; share</p>
              <Button variant="outline" className="w-full" onClick={() => downloadCsv(data.title, data.summary ?? "", visible, !full)}>
                <Download className="mr-2 size-4" /> Download CSV
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => printReport(data.title, meta, data.summary ?? "", visible, !full)}
              >
                <Printer className="mr-2 size-4" /> Print / save as PDF
              </Button>
              {!full && (
                <button
                  type="button"
                  onClick={unlock}
                  className="w-full text-center text-[11px] text-muted-foreground hover:text-primary"
                >
                  Free exports carry a watermark and the top {limit} findings. Remove →
                </button>
              )}
              {isOwner ? (
                <TeamShareSelect
                  table="analyses"
                  rowId={data.id}
                  teamId={data.team_id}
                  onChanged={() => queryClient.invalidateQueries({ queryKey: ["analysis", id] })}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Shared with you by a teammate.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
