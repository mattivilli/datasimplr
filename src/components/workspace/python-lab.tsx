import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Play, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findBlocked, nextSteps, runPython, starterPython } from "@/lib/pyodide-runtime";

export function PythonLab({
  csv,
  fileName,
  columns,
  seedCode,
}: {
  csv?: string;
  fileName?: string | null;
  columns?: string[];
  seedCode?: string;
}) {
  const starter = useMemo(() => starterPython(fileName, columns), [fileName, columns]);
  const [code, setCode] = useState(seedCode || starter);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Python loads in the browser on first Run (~15 MB).");
  const [stdout, setStdout] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    if (seedCode) setCode(seedCode);
  }, [seedCode]);

  const warnings = findBlocked(code);
  const steps = ran ? nextSteps(!error && !blocked, blocked) : [];

  const run = async () => {
    setBusy(true);
    setError(null);
    setBlocked(false);
    setStatus("Running…");
    try {
      const hits = findBlocked(code);
      if (hits.length) {
        setBlocked(true);
        setRan(true);
        setImages([]);
        setStdout("");
        setError(hits.map((h) => `${h.label} — ${h.hint}`).join("\n"));
        setStatus("This snippet needs libraries the lab cannot load.");
        return;
      }
      const result = await runPython(code, csv);
      setStdout(result.stdout);
      setImages(result.images);
      setError(result.error ?? null);
      setRan(true);
      setStatus(
        result.ok
          ? result.images.length
            ? `Preview ready · ${result.images.length} chart${result.images.length === 1 ? "" : "s"}`
            : "Ran with no figure — call plt.subplots() to preview."
          : "Execution stopped.",
      );
    } catch (e) {
      setRan(true);
      setError(e instanceof Error ? e.message : "Python runtime failed to start.");
      setStatus("Runtime error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <Terminal className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Python visual lab</p>
          <p className="truncate font-mono text-[10px] text-subtle">
            {fileName ? `df ← ${fileName}` : "Upload a file to bind df"} · pandas · matplotlib
          </p>
        </div>
        <Button size="sm" onClick={run} disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Play className="mr-1.5 size-3.5" />}
          Run
        </Button>
      </div>

      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        className="min-h-[140px] flex-1 resize-none bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none"
      />

      <div className="max-h-[48%] overflow-y-auto border-t border-border p-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">{status}</p>

        {warnings.length > 0 && !ran && (
          <p className="mt-2 flex items-start gap-2 text-xs text-amber-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {warnings[0]!.hint}
          </p>
        )}

        {error && (
          <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
            {error}
          </pre>
        )}

        {stdout && (
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-2 font-mono text-[11px] text-muted-foreground">
            {stdout}
          </pre>
        )}

        {images.length > 0 && (
          <div className="mt-3 grid gap-2">
            {images.map((src, i) => (
              <img
                key={i}
                alt={`Chart ${i + 1}`}
                src={`data:image/png;base64,${src}`}
                className="w-full rounded-xl border border-border bg-white"
              />
            ))}
          </div>
        )}

        {steps.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold">Next steps</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
