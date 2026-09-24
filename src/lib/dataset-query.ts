import { z } from "zod";
import { detectTypes, parseNumber, type Table } from "./analysis";
import { analyzeQuality } from "./data-quality";

// A deliberately small, closed set of operations. The model may only *choose*
// among these (and fill in column names); every number in an answer comes from
// running them against the real dataset, never from the model's memory.

const agg = z.enum(["sum", "avg", "min", "max", "median", "count"]);
const filter = z.object({
  column: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
});
const filters = z.array(filter).max(6).optional();

export const queryOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("describe") }),
  z.object({ op: z.literal("quality") }),
  z.object({ op: z.literal("aggregate"), metric: z.string().optional(), agg, filters }),
  z.object({
    op: z.literal("group"),
    groupBy: z.array(z.string()).min(1).max(2),
    metric: z.string().optional(),
    agg,
    sort: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    filters,
  }),
  z.object({
    op: z.literal("top_n"),
    by: z.string(),
    n: z.number().int().min(1).max(50),
    order: z.enum(["asc", "desc"]).optional(),
    columns: z.array(z.string()).max(8).optional(),
    filters,
  }),
  z.object({
    op: z.literal("time_trend"),
    dateColumn: z.string(),
    metric: z.string().optional(),
    agg,
    granularity: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
    filters,
  }),
  z.object({
    op: z.literal("compare"),
    column: z.string(),
    values: z.array(z.string()).min(2).max(4),
    metric: z.string().optional(),
    agg,
    filters,
  }),
  z.object({ op: z.literal("value_counts"), column: z.string(), limit: z.number().int().min(1).max(50).optional(), filters }),
  z.object({ op: z.literal("correlation"), columns: z.array(z.string()).max(8).optional() }),
]);

export type QueryOp = z.infer<typeof queryOpSchema>;
type Filter = z.infer<typeof filter>;
type Agg = z.infer<typeof agg>;

export type QueryResult = {
  op: string;
  description: string;
  columns?: string[];
  rows?: (string | number)[][];
  value?: number | string;
  note?: string;
  error?: string;
  truncated?: boolean;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isBlank = (v: string | undefined) => v === undefined || v.trim() === "";

export function resolveColumn(table: Table, name: string): number {
  const exact = table.columns.indexOf(name);
  if (exact >= 0) return exact;
  const lower = table.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  if (lower >= 0) return lower;
  const n = norm(name);
  const normalized = table.columns.findIndex((c) => norm(c) === n);
  if (normalized >= 0) return normalized;
  const partial = table.columns.filter((c) => n && (norm(c).includes(n) || n.includes(norm(c))));
  return partial.length === 1 ? table.columns.indexOf(partial[0]!) : -1;
}

function fmt(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000;
}

function aggregate(values: number[], kind: Agg): number {
  if (kind === "count") return values.length;
  if (!values.length) return NaN;
  if (kind === "sum") return values.reduce((a, b) => a + b, 0);
  if (kind === "avg") return values.reduce((a, b) => a + b, 0) / values.length;
  if (kind === "min") return Math.min(...values);
  if (kind === "max") return Math.max(...values);
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function matches(cell: string | undefined, f: Filter): boolean {
  const c = (cell ?? "").trim();
  const values = Array.isArray(f.value) ? f.value : [f.value];
  const test = (v: string | number) => {
    const a = parseNumber(c);
    const b = typeof v === "number" ? v : parseNumber(String(v));
    const bothNum = Number.isFinite(a) && Number.isFinite(b);
    switch (f.op) {
      case "eq":
        return bothNum ? a === b : c.toLowerCase() === String(v).trim().toLowerCase();
      case "neq":
        return bothNum ? a !== b : c.toLowerCase() !== String(v).trim().toLowerCase();
      case "gt":
        return bothNum && a > b;
      case "gte":
        return bothNum && a >= b;
      case "lt":
        return bothNum && a < b;
      case "lte":
        return bothNum && a <= b;
      case "contains":
        return c.toLowerCase().includes(String(v).toLowerCase());
      case "in":
        return c.toLowerCase() === String(v).trim().toLowerCase();
    }
  };
  return f.op === "neq" ? values.every(test) : values.some(test);
}

type Scoped = { rows: string[][]; indexes: number[]; error?: string };

function scope(table: Table, fs: Filter[] | undefined): Scoped {
  if (!fs?.length) return { rows: table.rows, indexes: table.rows.map((_, i) => i) };
  const resolved: { idx: number; f: Filter }[] = [];
  for (const f of fs) {
    const idx = resolveColumn(table, f.column);
    if (idx < 0) return { rows: [], indexes: [], error: `Filter column "${f.column}" was not found.` };
    resolved.push({ idx, f });
  }
  const rows: string[][] = [];
  const indexes: number[] = [];
  table.rows.forEach((r, i) => {
    if (resolved.every(({ idx, f }) => matches(r[idx], f))) {
      rows.push(r);
      indexes.push(i);
    }
  });
  return { rows, indexes };
}

const describeFilters = (fs: Filter[] | undefined) =>
  fs?.length ? ` where ${fs.map((f) => `${f.column} ${f.op} ${JSON.stringify(f.value)}`).join(" and ")}` : "";

function metricName(table: Table, metric: string | undefined, kind: Agg): { idx: number; label: string } | { error: string } {
  if (kind === "count" && !metric) return { idx: -1, label: "rows" };
  if (!metric) return { error: `A metric column is required for ${kind}.` };
  const idx = resolveColumn(table, metric);
  if (idx < 0) return { error: `Column "${metric}" was not found.` };
  return { idx, label: `${kind}(${table.columns[idx]})` };
}

function numbersOf(rows: string[][], idx: number, kind: Agg): number[] {
  if (kind === "count") return idx < 0 ? rows.map(() => 1) : rows.filter((r) => !isBlank(r[idx])).map(() => 1);
  return rows.map((r) => parseNumber(r[idx])).filter(Number.isFinite);
}

function bucket(value: string, g: "day" | "week" | "month" | "quarter" | "year"): string | null {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (g === "year") return String(y);
  if (g === "quarter") return `${y}-Q${Math.ceil(m / 3)}`;
  if (g === "month") return `${y}-${String(m).padStart(2, "0")}`;
  if (g === "day") return d.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return `${start.toISOString().slice(0, 10)} (week)`;
}

export function runQueryOp(table: Table, op: QueryOp): QueryResult {
  try {
    return execute(table, op);
  } catch (e) {
    return { op: op.op, description: op.op, error: e instanceof Error ? e.message : "Operation failed." };
  }
}

function execute(table: Table, op: QueryOp): QueryResult {
  const types = detectTypes(table);

  if (op.op === "describe") {
    const columns = table.columns.map((name, i) => {
      const cells = table.rows.map((r) => r[i] ?? "");
      const filled = cells.filter((c) => !isBlank(c));
      const distinct = new Set(filled).size;
      const type = types[name] ?? "text";
      let detail = "";
      if (type === "numeric") {
        const nums = filled.map(parseNumber).filter(Number.isFinite);
        detail = nums.length ? `min ${fmt(Math.min(...nums))}, max ${fmt(Math.max(...nums))}, mean ${fmt(aggregate(nums, "avg"))}` : "";
      } else {
        const counts = new Map<string, number>();
        filled.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1));
        detail = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${v} (${n})`).join(", ");
      }
      return [name, type, table.rows.length - filled.length, distinct, detail] as (string | number)[];
    });
    return {
      op: "describe",
      description: `Profile of ${table.rows.length} rows × ${table.columns.length} columns`,
      columns: ["column", "type", "missing", "distinct", "summary"],
      rows: columns,
    };
  }

  if (op.op === "quality") {
    const report = analyzeQuality(table);
    return {
      op: "quality",
      description: `DataSimplr quality score ${report.score.overall}/100 (completeness ${report.score.completeness}, consistency ${report.score.consistency}, validity ${report.score.validity}, uniqueness ${report.score.uniqueness}, type correctness ${report.score.typeCorrectness}). Flagged items on this version:`,
      columns: ["issue", "kind", "severity", "rows affected"],
      rows: report.issues.slice(0, 20).map((i) => [i.title, i.kind, i.severity, i.affectedRowIndexes.length]),
      truncated: report.issues.length > 20,
    };
  }

  if (op.op === "correlation") {
    const wanted = op.columns?.map((c) => resolveColumn(table, c)).filter((i) => i >= 0) ?? [];
    const idxs = wanted.length >= 2 ? wanted : table.columns.map((c, i) => (types[c] === "numeric" ? i : -1)).filter((i) => i >= 0).slice(0, 8);
    if (idxs.length < 2) return { op: "correlation", description: "Correlation", error: "Need at least two numeric columns." };
    const pairs: (string | number)[][] = [];
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const r of table.rows) {
          const x = parseNumber(r[idxs[a]!]);
          const y = parseNumber(r[idxs[b]!]);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            xs.push(x);
            ys.push(y);
          }
        }
        if (xs.length < 3) continue;
        const mx = aggregate(xs, "avg");
        const my = aggregate(ys, "avg");
        const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
        const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
        pairs.push([table.columns[idxs[a]!]!, table.columns[idxs[b]!]!, den === 0 ? 0 : fmt(cov / den), xs.length]);
      }
    }
    pairs.sort((p, q) => Math.abs(Number(q[2])) - Math.abs(Number(p[2])));
    return {
      op: "correlation",
      description: "Pearson correlation between numeric columns (strongest first)",
      columns: ["column A", "column B", "r", "rows used"],
      rows: pairs.slice(0, 15),
      note: "Correlation does not imply causation.",
    };
  }

  const scoped = scope(table, op.filters);
  if (scoped.error) return { op: op.op, description: op.op, error: scoped.error };
  const where = describeFilters(op.filters);

  if (op.op === "aggregate") {
    const m = metricName(table, op.metric, op.agg);
    if ("error" in m) return { op: "aggregate", description: "aggregate", error: m.error };
    const value = aggregate(numbersOf(scoped.rows, m.idx, op.agg), op.agg);
    return {
      op: "aggregate",
      description: `${m.label}${where} over ${scoped.rows.length} rows`,
      value: Number.isFinite(value) ? fmt(value) : "no numeric values",
    };
  }

  if (op.op === "group") {
    const gIdx = op.groupBy.map((g) => resolveColumn(table, g));
    const missing = op.groupBy.filter((_, i) => gIdx[i]! < 0);
    if (missing.length) return { op: "group", description: "group", error: `Column(s) not found: ${missing.join(", ")}.` };
    const m = metricName(table, op.metric, op.agg);
    if ("error" in m) return { op: "group", description: "group", error: m.error };
    const groups = new Map<string, { key: string[]; rows: string[][] }>();
    for (const r of scoped.rows) {
      const key = gIdx.map((i) => (isBlank(r[i]) ? "(blank)" : r[i]!.trim()));
      const k = key.join("\u0000");
      const g = groups.get(k) ?? { key, rows: [] };
      g.rows.push(r);
      groups.set(k, g);
    }
    const out = [...groups.values()].map((g) => ({
      key: g.key,
      value: aggregate(numbersOf(g.rows, m.idx, op.agg), op.agg),
      n: g.rows.length,
    }));
    const dir = op.sort === "asc" ? 1 : -1;
    out.sort((a, b) => (Number.isFinite(a.value) ? (Number.isFinite(b.value) ? dir * (a.value - b.value) : -1) : 1));
    const limit = op.limit ?? 25;
    return {
      op: "group",
      description: `${m.label} by ${op.groupBy.map((g, i) => table.columns[gIdx[i]!]).join(" × ")}${where}`,
      columns: [...gIdx.map((i) => table.columns[i]!), m.label, "rows"],
      rows: out.slice(0, limit).map((g) => [...g.key, Number.isFinite(g.value) ? fmt(g.value) : "n/a", g.n]),
      truncated: out.length > limit,
      note: out.length > limit ? `Showing ${limit} of ${out.length} groups.` : `${out.length} group(s).`,
    };
  }

  if (op.op === "top_n") {
    const by = resolveColumn(table, op.by);
    if (by < 0) return { op: "top_n", description: "top_n", error: `Column "${op.by}" was not found.` };
    const cols = op.columns?.map((c) => resolveColumn(table, c)).filter((i) => i >= 0) ?? [];
    const show = cols.length ? cols : table.columns.map((_, i) => i).slice(0, 8);
    const ranked = scoped.rows
      .map((r, i) => ({ r, v: parseNumber(r[by]), row: scoped.indexes[i]! }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => (op.order === "asc" ? a.v - b.v : b.v - a.v))
      .slice(0, op.n);
    return {
      op: "top_n",
      description: `Top ${op.n} rows by ${table.columns[by]} (${op.order === "asc" ? "lowest" : "highest"} first)${where}`,
      columns: ["data row", ...show.map((i) => table.columns[i]!)],
      rows: ranked.map((x) => [x.row + 2, ...show.map((i) => x.r[i] ?? "")]),
      note: "'data row' is the row number as it appears in the spreadsheet (header = row 1).",
    };
  }

  if (op.op === "value_counts") {
    const idx = resolveColumn(table, op.column);
    if (idx < 0) return { op: "value_counts", description: "value_counts", error: `Column "${op.column}" was not found.` };
    const counts = new Map<string, number>();
    scoped.rows.forEach((r) => {
      const k = isBlank(r[idx]) ? "(blank)" : r[idx]!.trim();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const limit = op.limit ?? 20;
    return {
      op: "value_counts",
      description: `Value counts for ${table.columns[idx]}${where}`,
      columns: [table.columns[idx]!, "rows"],
      rows: sorted.slice(0, limit).map(([k, n]) => [k, n]),
      truncated: sorted.length > limit,
    };
  }

  if (op.op === "compare") {
    const cIdx = resolveColumn(table, op.column);
    if (cIdx < 0) return { op: "compare", description: "compare", error: `Column "${op.column}" was not found.` };
    const m = metricName(table, op.metric, op.agg);
    if ("error" in m) return { op: "compare", description: "compare", error: m.error };
    const rows = op.values.map((v) => {
      const subset = scoped.rows.filter((r) => (r[cIdx] ?? "").trim().toLowerCase() === v.trim().toLowerCase());
      const value = aggregate(numbersOf(subset, m.idx, op.agg), op.agg);
      return { v, n: subset.length, value };
    });
    const [a, b] = rows;
    const note =
      a && b && Number.isFinite(a.value) && Number.isFinite(b.value)
        ? `${a.v} vs ${b.v}: difference ${fmt(a.value - b.value)}${b.value !== 0 ? ` (${fmt(((a.value - b.value) / Math.abs(b.value)) * 100)}%)` : ""}`
        : undefined;
    return {
      op: "compare",
      description: `${m.label} for ${table.columns[cIdx]} = ${op.values.join(" vs ")}${where}`,
      columns: [table.columns[cIdx]!, m.label, "rows"],
      rows: rows.map((r) => [r.v, Number.isFinite(r.value) ? fmt(r.value) : "no rows", r.n]),
      ...(note ? { note } : {}),
    };
  }

  // time_trend
  const dIdx = resolveColumn(table, op.dateColumn);
  if (dIdx < 0) return { op: "time_trend", description: "time_trend", error: `Column "${op.dateColumn}" was not found.` };
  const m = metricName(table, op.metric, op.agg);
  if ("error" in m) return { op: "time_trend", description: "time_trend", error: m.error };
  const g = op.granularity ?? "month";
  const buckets = new Map<string, string[][]>();
  let parsed = 0;
  for (const r of scoped.rows) {
    const cell = (r[dIdx] ?? "").trim();
    if (!cell) continue;
    const b = bucket(cell, g);
    if (b !== null) parsed += 1;
    const key = b ?? cell;
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  if (!buckets.size) return { op: "time_trend", description: "time_trend", error: `No usable values in "${table.columns[dIdx]}".` };
  const keys = [...buckets.keys()];
  if (parsed > 0) keys.sort();
  const series = keys.map((k) => ({ k, value: aggregate(numbersOf(buckets.get(k)!, m.idx, op.agg), op.agg), n: buckets.get(k)!.length }));
  const changes = series.map((s, i) => {
    const prev = series[i - 1];
    return prev && Number.isFinite(prev.value) && prev.value !== 0 && Number.isFinite(s.value) ? ((s.value - prev.value) / Math.abs(prev.value)) * 100 : null;
  });
  const valid = changes.filter((c): c is number => c !== null);
  const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  const sd = valid.length > 1 ? Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / (valid.length - 1)) : 0;
  const unusual = series
    .map((s, i) => ({ s, c: changes[i] ?? null }))
    .filter((x): x is { s: (typeof series)[number]; c: number } => x.c !== null && sd > 0 && Math.abs(x.c - mean) > 1.5 * sd)
    .map((x) => `${x.s.k} (${fmt(x.c)}%)`);
  return {
    op: "time_trend",
    description: `${m.label} by ${g} of ${table.columns[dIdx]}${where}`,
    columns: ["period", m.label, "rows", "change vs previous %"],
    rows: series.slice(0, 60).map((s, i) => [s.k, Number.isFinite(s.value) ? fmt(s.value) : "n/a", s.n, changes[i] === null || changes[i] === undefined ? "" : fmt(changes[i]!)]),
    note: unusual.length
      ? `Unusually large period-over-period moves (beyond 1.5 standard deviations of the changes): ${unusual.join(", ")}.`
      : parsed === 0
        ? "Dates weren't parseable, so periods follow the raw text values in order of appearance."
        : "No period stands out as unusual by a 1.5-standard-deviation rule.",
  };
}

export function formatResultsForPrompt(results: QueryResult[], maxChars = 7000): string {
  const out: string[] = [];
  let used = 0;
  for (const r of results) {
    const lines = [`### ${r.description}`];
    if (r.error) lines.push(`ERROR: ${r.error}`);
    if (r.value !== undefined) lines.push(`Result: ${r.value}`);
    if (r.columns && r.rows) {
      lines.push(r.columns.join(" | "));
      for (const row of r.rows) lines.push(row.join(" | "));
    }
    if (r.note) lines.push(`Note: ${r.note}`);
    const block = lines.join("\n");
    if (used + block.length > maxChars) {
      out.push("(further results omitted for length)");
      break;
    }
    out.push(block);
    used += block.length;
  }
  return out.join("\n\n");
}
