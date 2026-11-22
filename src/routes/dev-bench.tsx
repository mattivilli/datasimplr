import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/dev-bench")({
  head: () => ({
    meta: [
      { title: "Processing bench — DataSimplr" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BenchPage,
});

function BenchPage() {
  const [file, setFile] = useState<File | null>(null);
  const [out, setOut] = useState("Choose a CSV and run.");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setOut("Processing dataset...\n\nFile received");
    const started = performance.now();
    try {
      const engine = await import("@/lib/large-data/engine");
      const opened = await engine.openLargeFile(file, {
        onProgress: (steps) => setOut(steps.map((step) => `${step.state === "done" ? "✓" : step.state === "active" ? "⟳" : "·"} ${step.label}`).join("\n")),
      });
      const quality = await engine.ensureQuality(opened.id);
      const info = engine.getSessionInfo(opened.id);
      const afterQuality = performance.now();
      const count = await engine.runAnalysis(opened.id, { operation: "aggregate", aggregation: "count" });
      const quantity = await engine.runAnalysis(opened.id, { operation: "aggregate", metric: "Quantity", aggregation: "sum" });
      const afterSimple = performance.now();
      const grouped = await engine.runAnalysis(opened.id, {
        operation: "group_by",
        groupBy: ["Country"],
        metric: "Revenue",
        aggregation: "sum",
        sort: "desc",
        limit: 10,
      });
      const afterGroup = performance.now();
      const monthly = await engine.runAnalysis(opened.id, {
        operation: "time_trend",
        dateColumn: "InvoiceDate",
        metric: "Revenue",
        aggregation: "sum",
        granularity: "month",
        limit: 60,
      });
      const afterDate = performance.now();
      const filtered = await engine.runAnalysis(opened.id, {
        operation: "filter",
        filters: [{ column: "Country", op: "eq", value: "France" }],
        limit: 5,
      });
      const france = await engine.runAnalysis(opened.id, {
        operation: "aggregate",
        aggregation: "count",
        filters: [{ column: "Country", op: "eq", value: "France" }],
      });
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const result = {
        file: file.name,
        bytes: file.size,
        rows: info.rowCount,
        columns: info.columnCount,
        columnNames: info.columns.map((column) => `${column.name}:${column.type}`),
        excludedRows: info.excludedRows,
        loadMs: info.timings.loadMs,
        profileMs: info.timings.profileMs,
        qualityMs: info.timings.qualityMs ?? Math.round(afterQuality - started - info.timings.loadMs),
        issues: quality.issues.map((issue) => ({ kind: issue.kind, column: issue.column ?? "", affected: issue.affectedCount })),
        simpleMs: Math.round(afterSimple - afterQuality),
        groupMs: Math.round(afterGroup - afterSimple),
        dateMs: Math.round(afterDate - afterGroup),
        totalMs: Math.round(performance.now() - started),
        heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
        rowCountValue: count.value ?? count.error ?? null,
        quantitySum: quantity.value ?? quantity.error ?? null,
        topCountries: grouped.rows ?? grouped.error ?? null,
        monthRows: monthly.rows?.length ?? 0,
        monthError: monthly.error ?? null,
        months: monthly.rows ?? null,
        filterNote: filtered.note ?? filtered.error ?? null,
        filterRows: filtered.rows?.length ?? 0,
        franceCount: france.value ?? france.error ?? null,
        structuralNotes: info.structuralNotes,
      };
      setOut(JSON.stringify(result, null, 2));
    } catch (error) {
      setOut(JSON.stringify({ error: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started) }, null, 2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Processing bench</h1>
      <p className="text-sm text-muted-foreground">Local check for large CSV files. Not linked from the product.</p>
      <input data-testid="bench-file" type="file" accept=".csv,.tsv,.txt" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <button data-testid="bench-run" type="button" className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={!file || busy} onClick={() => void run()}>
        {busy ? "Running" : "Run"}
      </button>
      <pre data-testid="bench-result" className="overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted p-4 text-xs">{out}</pre>
    </main>
  );
}
