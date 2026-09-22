import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Play, Sparkles, Terminal, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findBlocked, nextSteps, runPython, starterPython } from "@/lib/pyodide-runtime";
import { loadActiveDataset, saveActiveDataset, subscribeDataset } from "@/lib/dataset-store";
import { parseUploadedFile } from "@/lib/parse-file";
import { tableToCsv } from "@/lib/analysis";
import { fixPython } from "@/lib/ai.functions";
import { extractCodeBlocks } from "./copy-button";

export function PythonLab({
  csv,
  fileName,
  columns,
  seedCode,
}: {
  csv?: string | undefined;
  fileName?: string | null | undefined;
  columns?: string[] | undefined;
  seedCode?: string | undefined;
}) {
  const fix = useServerFn(fixPython);
  const fileRef = useRef<HTMLInputElement>(null);
  const [boundCsv, setBoundCsv] = useState(csv ?? "");
  const [boundName, setBoundName] = useState(fileName ?? "");
  const [boundCols, setBoundCols] = useState<string[]>(columns ?? []);
  const starter = useMemo(() => starterPython(boundName || fileName, boundCols.length ? boundCols : columns), [boundName, fileName, boundCols, columns]);
  const [code, setCode] = useState(seedCode || starter);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [status, setStatus] = useState("Python loads in the browser on first Run.");
  const [stdout, setStdout] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [ran, setRan] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [needUpload, setNeedUpload] = useState(false);

  useEffect(() => {
    if (seedCode) setCode(seedCode);
  }, [seedCode]);

  useEffect(() => {
    if (csv) {
      setBoundCsv(csv);
      setBoundName(fileName ?? "uploaded.csv");
      setBoundCols(columns ?? []);
      setNeedUpload(false);
      void saveActiveDataset({ csv, fileName: fileName ?? "uploaded.csv", columns: columns ?? [] });
      return;
    }
    void loadActiveDataset().then((stored) => {
      if (stored?.csv) {
        setBoundCsv(stored.csv);
        setBoundName(stored.fileName);
        setBoundCols(stored.columns);
        setNeedUpload(false);
      } else {
        setNeedUpload(true);
      }
    });
  }, [csv, fileName, columns]);

  useEffect(() => subscribeDataset((d) => {
    if (!d?.csv) return;
    setBoundCsv(d.csv);
    setBoundName(d.fileName);
    setBoundCols(d.columns);
    setNeedUpload(false);
  }), []);

  const warnings = findBlocked(code);
  const steps = ran ? nextSteps(!error && !blocked, blocked) : [];

  const onReupload = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = await parseUploadedFile(file);
      const nextCsv = tableToCsv(parsed.table);
      if (!nextCsv.trim() || parsed.table.rows.length === 0) {
        setNeedUpload(true);
        setError("That file did not load any rows. Upload a CSV or Excel file again.");
        return;
      }
      await saveActiveDataset({ csv: nextCsv, fileName: parsed.sourceName, columns: parsed.table.columns });
      setBoundCsv(nextCsv);
      setBoundName(parsed.sourceName);
      setBoundCols(parsed.table.columns);
      setNeedUpload(false);
      setError(null);
      setStatus(`Loaded ${parsed.sourceName} · ${parsed.table.rows.length} rows`);
      setCode(starterPython(parsed.sourceName, parsed.table.columns));
    } catch {
      setNeedUpload(true);
      setError("Could not read that file. Upload a CSV, Excel or JSON file again.");
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setBlocked(false);
    setAiNote(null);
    setStatus("Running…");
    try {
      let data = boundCsv;
      if (!data.trim()) {
        const stored = await loadActiveDataset();
        data = stored?.csv ?? "";
        if (stored) {
          setBoundCsv(stored.csv);
          setBoundName(stored.fileName);
          setBoundCols(stored.columns);
        }
      }
      if (!data.trim()) {
        setNeedUpload(true);
        setRan(true);
        setError("No uploaded file is bound to df. Upload the dataset again in this lab or in Upload & Analyze.");
        setStatus("Waiting for a file");
        return;
      }

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
      const result = await runPython(code, data, boundName || fileName);
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

  const askAi = async () => {
    if (!error) return;
    setFixing(true);
    setAiNote(null);
    try {
      const { reply, code: next } = await fix({
        data: { code, error, columns: boundCols, fileName: boundName || undefined },
      });
      const extracted = next || extractCodeBlocks(reply)[0]?.code || "";
      if (extracted) setCode(extracted);
      setAiNote(reply.replace(/```[\s\S]*?```/g, "").trim() || "Updated the script from the traceback.");
    } catch {
      setAiNote("Sign in to let AI rewrite this script from the error. Guest mode can still re-upload the file and run pandas + matplotlib.");
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Terminal className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Python visual lab</p>
          <p className="truncate font-mono text-[10px] text-subtle">
            {boundName ? `df ← ${boundName} (saved on this device)` : "No file bound"} · pandas · matplotlib
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.json,.xlsx,.xls"
          className="hidden"
          onChange={(e) => void onReupload(e.target.files?.[0] ?? null)}
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="shrink-0">
          <Upload className="mr-1.5 size-3.5" />
          File
        </Button>
        <Button size="sm" onClick={run} disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Play className="mr-1.5 size-3.5" />}
          Run
        </Button>
      </div>

      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        className="min-h-[120px] shrink-0 basis-[34%] resize-none bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none"
      />

      <div className="shrink-0 border-t border-border px-3 py-2">
        {needUpload && (
          <p className="mb-2 text-xs text-amber-500">
            The dataset is not in memory. Upload the file again here — it is cached on this device for the lab.
          </p>
        )}
        {warnings.length > 0 && !error && (
          <p className="mb-2 flex items-start gap-2 text-xs text-amber-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {warnings[0]!.hint}
          </p>
        )}
        {error && (
          <div className="space-y-2">
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
              {error}
            </pre>
            <Button size="sm" variant="outline" onClick={askAi} disabled={fixing}>
              {fixing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Sparkles className="mr-1.5 size-3.5" />}
              Ask AI to fix
            </Button>
            {aiNote && <p className="text-xs leading-relaxed text-muted-foreground">{aiNote}</p>}
          </div>
        )}
        {!error && aiNote && <p className="text-xs leading-relaxed text-muted-foreground">{aiNote}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">{status}</p>
        {stdout && (
          <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-2 font-mono text-[11px] text-muted-foreground">
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

      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[0_12px_32px_-12px_var(--glow)] disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        Run
      </button>
    </div>
  );
}
