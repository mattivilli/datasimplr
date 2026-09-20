import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Loader2, Play, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceShell } from "@/components/workspace/shell";
import { Button } from "@/components/ui/button";
import { TOOLS, parseDelimited, runTool, type ToolKey } from "@/lib/analysis";

export const Route = createFileRoute("/_authenticated/analyze")({
  head: () => ({
    meta: [
      { title: "Upload & Analyze — DataSimplr Workspace" },
      { name: "description", content: "Upload a dataset and run predefined data science tools on it." },
      { property: "og:title", content: "Upload & Analyze — DataSimplr Workspace" },
      {
        property: "og:description",
        content: "Upload a dataset and run predefined data science tools on it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalyzePage,
});

const sample = `region,month,revenue,units,refunds
North,Jul,412300,1820,4200
South,Jul,198400,910,15600
East,Jul,251000,1120,3900
North,Aug,448900,1975,3800
South,Aug,171200,780,18800
East,Aug,264500,1190,4100
North,Sep,472100,2040,3600
South,Sep,158900,700,21400
East,Sep,278300,1255,4500`;

function AnalyzePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"upload" | "paste">("paste");
  const [text, setText] = useState(sample);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolKey>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: string; findings: { label: string; value: string; note?: string }[] } | null>(
    null,
  );

  const table = parseDelimited(text);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    if (file.size > 5_000_000) {
      setError("That file is larger than 5 MB. Try a smaller extract.");
      return;
    }
    const content = await file.text();
    setFileName(file.name);
    setText(content);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = runTool(tool, table);
      setResult(outcome);
      const { data: auth } = await supabase.auth.getUser();
      const toolName = TOOLS.find((t) => t.key === tool)!.name;
      const { data, error: err } = await supabase
        .from("analyses")
        .insert({
          user_id: auth.user!.id,
          title: `${toolName} — ${fileName ?? "pasted data"}`,
          source_name: fileName ?? "pasted data",
          source_type: fileName?.split(".").pop()?.toLowerCase() ?? "csv",
          tool: toolName,
          status: "complete",
          summary: outcome.summary,
          findings: outcome.findings,
        })
        .select("id")
        .single();
      if (err) throw err;
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await navigate({ to: "/analyses/$id", params: { id: data.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this analysis.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkspaceShell
      title="Upload & Analyze"
      subtitle="Drop a CSV, or paste rows, then pick a tool. Results are saved to your workspace."
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="panel p-5">
          <div className="flex gap-1.5 rounded-xl border border-border bg-muted p-1">
            {(
              [
                { key: "upload", label: "Upload file", icon: Upload },
                { key: "paste", label: "Paste data", icon: ClipboardPaste },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setMode(t.key)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  mode === t.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {mode === "upload" ? (
            <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-border bg-muted px-5 py-10 text-center transition-colors hover:border-primary">
              <Upload className="mx-auto size-5 text-primary" />
              <p className="mt-3 text-sm font-semibold">Choose a CSV or TSV file</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Up to 5 MB. Files are read in your browser, never stored.
              </p>
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : (
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
              }}
              rows={12}
              className="mt-4 w-full rounded-xl border border-border bg-muted p-3 font-mono text-[11px] leading-relaxed text-muted-foreground outline-none focus:border-primary"
            />
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-accent px-4 py-3">
            <p className="text-xs font-semibold">{fileName ?? "pasted data"}</p>
            <p className="font-mono text-[10px] tracking-widest text-subtle">
              {table.rows.length} rows · {table.columns.length} columns
            </p>
          </div>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          <Button onClick={run} disabled={busy || table.rows.length === 0} className="mt-4 w-full">
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            Run {TOOLS.find((t) => t.key === tool)!.name}
          </Button>

          {result && (
            <div className="mt-5 rounded-xl border border-border bg-muted p-4">
              <p className="text-sm font-semibold">{result.summary}</p>
            </div>
          )}
        </div>

        <div className="panel h-fit p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
            Data science tools
          </p>
          <div className="mt-3 space-y-2">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTool(t.key)}
                className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                  tool === t.key
                    ? "border-primary bg-accent"
                    : "border-border bg-muted hover:border-primary"
                }`}
              >
                <p className="text-xs font-semibold">{t.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t.blurb}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
