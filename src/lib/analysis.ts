export type Finding = { label: string; value: string; note?: string };

export type ToolKey =
  | "profile"
  | "summary_stats"
  | "missing_values"
  | "outliers"
  | "correlation"
  | "trend"
  | "segment";

export const TOOLS: { key: ToolKey; name: string; blurb: string }[] = [
  { key: "profile", name: "Dataset profile", blurb: "Shape, column types and a first look at every field." },
  { key: "summary_stats", name: "Summary statistics", blurb: "Mean, median, min, max and spread for numeric columns." },
  { key: "missing_values", name: "Missing values", blurb: "Blank and null counts per column, ranked." },
  { key: "outliers", name: "Outlier scan", blurb: "Values beyond 3 standard deviations, per column." },
  { key: "correlation", name: "Correlation", blurb: "Strongest relationships between numeric columns." },
  { key: "trend", name: "Trend & change", blurb: "First-half vs second-half movement over the rows." },
  { key: "segment", name: "Segment breakdown", blurb: "Totals and averages grouped by the first text column." },
];

export type Table = { columns: string[]; rows: string[][] };

export function parseDelimited(text: string): Table {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  const delimiter = (lines[0]!.match(/\t/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const split = (line: string) => line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
  const columns = split(lines[0]!);
  const rows = lines.slice(1).map(split);
  return { columns, rows };
}

const num = (v: string | undefined) => {
  if (v === undefined) return NaN;
  const cleaned = v.replace(/[$,%\s]/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
};

function numericColumns(table: Table) {
  return table.columns
    .map((name, i) => {
      const values = table.rows.map((r) => num(r[i])).filter((n) => Number.isFinite(n));
      return { name, index: i, values };
    })
    .filter((c) => c.values.length >= Math.max(3, table.rows.length * 0.6));
}

const fmt = (n: number) =>
  Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2);

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1));
};

export function runTool(tool: ToolKey, table: Table): { summary: string; findings: Finding[] } {
  const numeric = numericColumns(table);
  const rowCount = table.rows.length;

  if (rowCount === 0 || table.columns.length === 0) {
    return { summary: "No readable rows were found in this input.", findings: [] };
  }

  switch (tool) {
    case "profile": {
      const findings = table.columns.slice(0, 12).map((name, i) => {
        const isNumeric = numeric.some((c) => c.index === i);
        const unique = new Set(table.rows.map((r) => r[i])).size;
        return {
          label: name,
          value: isNumeric ? "numeric" : "text",
          note: `${unique} distinct value${unique === 1 ? "" : "s"}`,
        };
      });
      return {
        summary: `${rowCount.toLocaleString()} rows across ${table.columns.length} columns — ${numeric.length} numeric, ${table.columns.length - numeric.length} text.`,
        findings,
      };
    }
    case "summary_stats": {
      const findings = numeric.slice(0, 8).map((c) => {
        const sorted = [...c.values].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)]!;
        return {
          label: c.name,
          value: `avg ${fmt(mean(c.values))}`,
          note: `median ${fmt(median)} · min ${fmt(sorted[0]!)} · max ${fmt(sorted[sorted.length - 1]!)}`,
        };
      });
      return {
        summary: numeric.length
          ? `Summarised ${numeric.length} numeric column${numeric.length === 1 ? "" : "s"} over ${rowCount.toLocaleString()} rows.`
          : "No numeric columns were detected, so there are no statistics to report.",
        findings,
      };
    }
    case "missing_values": {
      const findings = table.columns
        .map((name, i) => {
          const blanks = table.rows.filter((r) => (r[i] ?? "").trim() === "").length;
          return {
            label: name,
            value: `${blanks} blank`,
            note: `${((blanks / rowCount) * 100).toFixed(1)}% of rows`,
            blanks,
          };
        })
        .sort((a, b) => b.blanks - a.blanks)
        .slice(0, 8)
        .map(({ label, value, note }) => ({ label, value, note }));
      const total = table.columns.reduce(
        (acc, _c, i) => acc + table.rows.filter((r) => (r[i] ?? "").trim() === "").length,
        0,
      );
      return {
        summary: total === 0 ? "No missing values — every cell is filled." : `${total} empty cells found across the dataset.`,
        findings,
      };
    }
    case "outliers": {
      const findings: Finding[] = [];
      for (const c of numeric) {
        const m = mean(c.values);
        const s = sd(c.values) || 1;
        const hits = c.values.filter((v) => Math.abs(v - m) > 3 * s);
        if (hits.length) {
          findings.push({
            label: c.name,
            value: `${hits.length} outlier${hits.length === 1 ? "" : "s"}`,
            note: `extreme value ${fmt(hits.reduce((a, b) => (Math.abs(b - m) > Math.abs(a - m) ? b : a), hits[0]!))} vs average ${fmt(m)}`,
          });
        }
      }
      return {
        summary: findings.length
          ? `${findings.length} column${findings.length === 1 ? "" : "s"} contain values beyond 3 standard deviations.`
          : "No values fall outside 3 standard deviations — the data looks clean.",
        findings,
      };
    }
    case "correlation": {
      const findings: Finding[] = [];
      for (let a = 0; a < numeric.length; a++) {
        for (let b = a + 1; b < numeric.length; b++) {
          const x = numeric[a]!;
          const y = numeric[b]!;
          const n = Math.min(x.values.length, y.values.length);
          const xs = x.values.slice(0, n);
          const ys = y.values.slice(0, n);
          const mx = mean(xs);
          const my = mean(ys);
          const cov = xs.reduce((acc, v, i) => acc + (v - mx) * (ys[i]! - my), 0);
          const den = Math.sqrt(
            xs.reduce((acc, v) => acc + (v - mx) ** 2, 0) * ys.reduce((acc, v) => acc + (v - my) ** 2, 0),
          );
          if (den === 0) continue;
          const r = cov / den;
          findings.push({
            label: `${x.name} ↔ ${y.name}`,
            value: r.toFixed(2),
            note: Math.abs(r) > 0.7 ? "strong relationship" : Math.abs(r) > 0.4 ? "moderate" : "weak",
          });
        }
      }
      findings.sort((p, q) => Math.abs(Number(q.value)) - Math.abs(Number(p.value)));
      return {
        summary: findings.length
          ? `Strongest pair: ${findings[0]!.label} at r = ${findings[0]!.value}.`
          : "At least two numeric columns are needed to measure correlation.",
        findings: findings.slice(0, 8),
      };
    }
    case "trend": {
      const findings = numeric.slice(0, 8).map((c) => {
        const half = Math.floor(c.values.length / 2) || 1;
        const first = mean(c.values.slice(0, half));
        const second = mean(c.values.slice(half));
        const change = first === 0 ? 0 : ((second - first) / Math.abs(first)) * 100;
        return {
          label: c.name,
          value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
          note: `${fmt(first)} → ${fmt(second)} (first half vs second half)`,
        };
      });
      return {
        summary: findings.length
          ? `Largest movement: ${findings.reduce((a, b) => (Math.abs(parseFloat(b.value)) > Math.abs(parseFloat(a.value)) ? b : a)).label}.`
          : "No numeric columns to trend.",
        findings,
      };
    }
    case "segment": {
      const textIndex = table.columns.findIndex((_c, i) => !numeric.some((n) => n.index === i));
      const valueCol = numeric[0];
      if (textIndex < 0 || !valueCol) {
        return {
          summary: "A text column and a numeric column are both needed for a segment breakdown.",
          findings: [],
        };
      }
      const groups = new Map<string, number[]>();
      for (const r of table.rows) {
        const key = (r[textIndex] ?? "—") || "—";
        const v = num(r[valueCol.index]);
        if (!Number.isFinite(v)) continue;
        groups.set(key, [...(groups.get(key) ?? []), v]);
      }
      const findings = [...groups.entries()]
        .map(([key, values]) => ({
          label: key,
          value: fmt(values.reduce((a, b) => a + b, 0)),
          note: `${values.length} rows · avg ${fmt(mean(values))}`,
          total: values.reduce((a, b) => a + b, 0),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map(({ label, value, note }) => ({ label, value, note }));
      return {
        summary: `${table.columns[valueCol.index]} totalled by ${table.columns[textIndex]} — top segment is ${findings[0]?.label ?? "—"}.`,
        findings,
      };
    }
  }
}
