// Times the current in-memory engine on synthetic ecommerce-shaped CSV.
// Usage: npx tsx scripts/bench-standard.ts 20000 50000 100000
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTable, describeNumeric, parseDelimited } from "../src/lib/analysis";
import { analyzeQuality } from "../src/lib/data-quality";

function csvFor(rows: number): string {
  const lines = ["InvoiceNo,StockCode,Description,Quantity,InvoiceDate,UnitPrice,CustomerID,Country"];
  for (let i = 0; i < rows; i++) {
    const inv = 536365 + (i % 20000);
    const code = i % 9 === 0 ? "85123A" : String(10000 + (i % 3000));
    const desc = i % 40 === 0 ? "" : "WHITE HANGING HEART T-LIGHT HOLDER";
    const qty = i % 80 === 0 ? -1 : (i % 12) + 1;
    const day = (i % 28) + 1;
    const date = `12/${day}/2010 8:${String(i % 60).padStart(2, "0")}`;
    const price = ((i % 40) + 1) / 2;
    const cust = i % 19 === 0 ? "" : 15000 + (i % 3500);
    const country = ["United Kingdom", "France", "Germany", "EIRE", "Australia"][i % 5];
    lines.push(`${inv},${code},${desc},${qty},${date},${price},${cust},${country}`);
  }
  return lines.join("\n");
}

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
// 8,000 rows finished in 552ms. 20,000 rows took 57s on this machine, so the
// default plan stops at the last usable size. Pass larger sizes explicitly.
const plan = sizes.length ? sizes : [1000, 2000, 4000, 8000];
const results: unknown[] = [];

for (const n of plan) {
  const csv = csvFor(n);
  const bytes = Buffer.byteLength(csv);
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  try {
    const parsed = parseDelimited(csv);
    const tParse = performance.now();
    const cleaned = cleanTable(parsed, { fill: "mean", removeDuplicates: true });
    const tClean = performance.now();
    const quality = analyzeQuality(parsed);
    const tQuality = performance.now();
    describeNumeric(cleaned.table);
    const tDescribe = performance.now();
    const heapAfter = process.memoryUsage().heapUsed;
    const row = {
      rows: n,
      bytes,
      parsedRows: parsed.rows.length,
      columns: parsed.columns.length,
      issues: quality.issues.length,
      duplicateIdRows: quality.issues.find((i) => i.kind === "duplicate_id")?.affectedRowIndexes.length ?? 0,
      parseMs: Math.round(tParse - t0),
      cleanMs: Math.round(tClean - tParse),
      qualityMs: Math.round(tQuality - tClean),
      describeMs: Math.round(tDescribe - tQuality),
      totalMs: Math.round(tDescribe - t0),
      heapDeltaMB: Math.round((heapAfter - heapBefore) / 1048576),
      heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    };
    results.push(row);
    console.log(JSON.stringify(row));
  } catch (e) {
    const row = {
      rows: n,
      bytes,
      error: e instanceof Error ? e.message : String(e),
      totalMs: Math.round(performance.now() - t0),
      heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), "bench-standard-results.json");
const previous = existsSync(out)
  ? (JSON.parse(readFileSync(out, "utf8")) as { results?: Array<{ rows?: number }>; notes?: string[] })
  : { results: [], notes: [] };
const byRows = new Map<number, unknown>();
for (const row of previous.results ?? []) {
  if (row && typeof row.rows === "number") byRows.set(row.rows, row);
}
for (const row of results) {
  const rows = (row as { rows?: number }).rows;
  if (typeof rows === "number") byRows.set(rows, row);
}
const merged = [...byRows.values()].sort((a, b) => ((a as { rows: number }).rows ?? 0) - ((b as { rows: number }).rows ?? 0));
writeFileSync(
  out,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      notes: previous.notes ?? [],
      results: merged,
    },
    null,
    2,
  ),
);
console.log("wrote", out);
