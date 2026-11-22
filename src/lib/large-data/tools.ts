import { kmeans, parseDelimited, pca, type Finding, type ToolKey } from "../analysis";
import { LARGE_DATA } from "./config";
import { ensureQuality, getSessionInfo, querySession, runAnalysis, sampleCsv } from "./engine";
import { numericSql, quoteIdent } from "./sql";

export async function runLargeTool(
  sessionId: string,
  tool: ToolKey,
): Promise<{ summary: string; findings: Finding[]; note?: string }> {
  const info = getSessionInfo(sessionId);
  const numeric = info.columns.filter((column) => column.type === "numeric");
  const text = info.columns.filter((column) => column.type === "text");

  if (tool === "profile") {
    return {
      summary: `${info.rowCount.toLocaleString()} rows across ${info.columnCount} columns — ${numeric.length} numeric, ${info.columnCount - numeric.length} other.`,
      findings: info.columns.slice(0, 12).map((column) => ({
        label: column.name,
        value: column.type,
        note: `${column.distinct.toLocaleString()} distinct`,
      })),
    };
  }

  if (tool === "summary_stats") {
    const findings = numeric.slice(0, 8).map((column) => ({
      label: column.name,
      value: column.numeric ? `avg ${fmt(column.numeric.mean)}` : "n/a",
      note: column.numeric
        ? info.parts
          ? `min ${fmt(column.numeric.min)} · max ${fmt(column.numeric.max)} · combined across ${info.parts.names.length} parts`
          : `median ${fmt(column.numeric.median)} · min ${fmt(column.numeric.min)} · max ${fmt(column.numeric.max)} · skew ${column.numeric.skew.toFixed(2)}`
        : "No numeric summary",
    }));
    return {
      summary: numeric.length
        ? `Summarised ${numeric.length} numeric column${numeric.length === 1 ? "" : "s"} over ${info.rowCount.toLocaleString()} rows.`
        : "No numeric columns were detected, so there are no statistics to report.",
      findings,
    };
  }

  if (tool === "missing_values") {
    const ranked = [...info.columns].sort((a, b) => b.missing - a.missing);
    const total = info.columns.reduce((sum, column) => sum + column.missing, 0);
    return {
      summary: total === 0 ? "No missing values — every cell is filled." : `${total.toLocaleString()} empty cells found across the dataset.`,
      findings: ranked.slice(0, 8).map((column) => ({
        label: column.name,
        value: `${column.missing.toLocaleString()} blank`,
        note: `${column.missingPct.toFixed(1)}% of rows`,
      })),
    };
  }

  if (tool === "outliers") {
    const quality = await ensureQuality(sessionId);
    const issues = quality.issues.filter((issue) => issue.kind === "outlier");
    return {
      summary: issues.length
        ? `${issues.length} column${issues.length === 1 ? "" : "s"} contain values beyond 3 standard deviations or the IQR fence. Nothing was deleted.`
        : "No values fall outside 3 standard deviations or the IQR fence.",
      findings: issues.slice(0, 8).map((issue) => ({
        label: issue.column ?? issue.title,
        value: `${issue.affectedCount.toLocaleString()} rows`,
        note: issue.reason,
      })),
    };
  }

  if (tool === "correlation") {
    const result = await runAnalysis(sessionId, { operation: "correlation" });
    if (result.error) return { summary: result.error, findings: [] };
    const top = result.rows?.[0];
    return {
      summary: top ? `Strongest pair: ${top[0]} ↔ ${top[1]} at r = ${top[2]}.` : "At least two numeric columns are needed to measure correlation.",
      findings: (result.rows ?? []).slice(0, 8).map((row) => ({
        label: `${row[0]} ↔ ${row[1]}`,
        value: String(row[2]),
        note: `${row[3]} rows`,
      })),
      ...(result.note ? { note: result.note } : {}),
    };
  }

  if (tool === "trend") {
    if (info.parts) {
      return {
        summary: `This file is split into ${info.parts.names.length} parts. First-half and second-half change is available on a single part. Grouped totals include every part.`,
        findings: info.parts.names.slice(0, 8).map((name, index) => ({
          label: name,
          value: `${(info.parts?.rows[index] ?? 0).toLocaleString()} rows`,
          note: "Included in the combined totals",
        })),
        note: info.parts.note,
      };
    }
    const findings: Finding[] = [];
    for (const column of numeric.slice(0, 8)) {
      const rows = await querySession(
        sessionId,
        `WITH ranked AS (
           SELECT ${numericSql(column.name)} AS v, ntile(2) OVER (ORDER BY "_ds_row") AS half
           FROM {{table}} WHERE ${numericSql(column.name)} IS NOT NULL
         )
         SELECT half, avg(v) AS mean FROM ranked GROUP BY 1 ORDER BY 1`,
      );
      const first = num(rows.find((row) => num(row["half"]) === 1)?.["mean"]);
      const second = num(rows.find((row) => num(row["half"]) === 2)?.["mean"]);
      const change = !Number.isFinite(first) || first === 0 || !Number.isFinite(second) ? 0 : ((second - first) / Math.abs(first)) * 100;
      findings.push({
        label: column.name,
        value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
        note: `${fmt(first)} → ${fmt(second)} (first half vs second half of loaded rows)`,
      });
    }
    const largest = findings.reduce<Finding | null>((best, item) => {
      if (!best) return item;
      return Math.abs(parseFloat(item.value)) > Math.abs(parseFloat(best.value)) ? item : best;
    }, null);
    return {
      summary: largest ? `Largest movement: ${largest.label}.` : "No numeric columns to trend.",
      findings,
    };
  }

  if (tool === "segment") {
    const textColumn = text[0];
    const valueColumn = numeric[0];
    if (!textColumn || !valueColumn) {
      return { summary: "A text column and a numeric column are both needed for a segment breakdown.", findings: [] };
    }
    const rows = await querySession(
      sessionId,
      `SELECT coalesce(nullif(trim(${quoteIdent(textColumn.name)}), ''), '(blank)') AS k,
              sum(${numericSql(valueColumn.name)}) AS total,
              avg(${numericSql(valueColumn.name)}) AS mean,
              count(*)::DOUBLE AS n
       FROM {{table}}
       WHERE ${numericSql(valueColumn.name)} IS NOT NULL
       GROUP BY 1
       ORDER BY total DESC NULLS LAST
       LIMIT 10`,
    );
    return {
      summary: `${valueColumn.name} totalled by ${textColumn.name} — top segment is ${cellText(rows[0]?.["k"]) || "—"}.`,
      findings: rows.map((row) => ({
        label: cellText(row["k"]) || "(blank)",
        value: fmt(num(row["total"])),
        note: `${Math.round(num(row["n"]) || 0).toLocaleString()} rows · avg ${fmt(num(row["mean"]))}`,
      })),
    };
  }

  if (tool === "regression") {
    const x = numeric[0];
    const y = numeric[1];
    if (!x || !y) return { summary: "Need at least two numeric columns to run regression.", findings: [] };
    const rows = await querySession(
      sessionId,
      `SELECT regr_slope(${numericSql(y.name)}, ${numericSql(x.name)}) AS slope,
              regr_intercept(${numericSql(y.name)}, ${numericSql(x.name)}) AS intercept,
              regr_r2(${numericSql(y.name)}, ${numericSql(x.name)}) AS r2,
              count(*)::DOUBLE AS n
       FROM {{table}}
       WHERE ${numericSql(x.name)} IS NOT NULL AND ${numericSql(y.name)} IS NOT NULL`,
    );
    const slope = num(rows[0]?.["slope"]);
    const intercept = num(rows[0]?.["intercept"]);
    const r2 = num(rows[0]?.["r2"]);
    const n = Math.round(num(rows[0]?.["n"]) || 0);
    if (!Number.isFinite(slope) || !Number.isFinite(intercept)) {
      return { summary: "Regression could not be fit on this dataset.", findings: [] };
    }
    return {
      summary: `${y.name} = ${intercept.toFixed(3)} + ${slope.toFixed(3)} × ${x.name}  (R² = ${r2.toFixed(3)}, n = ${n.toLocaleString()})`,
      findings: [
        { label: "Intercept", value: intercept.toFixed(3) },
        { label: x.name, value: slope.toFixed(3) },
        { label: "R²", value: Number.isFinite(r2) ? r2.toFixed(3) : "n/a", note: Number.isFinite(r2) ? `${(r2 * 100).toFixed(1)}% of variance explained` : "R² was not available" },
      ],
      note: `Fit on all ${n.toLocaleString()} rows where both columns are numeric.`,
    };
  }

  if (tool === "clustering" || tool === "pca") {
    const sample = await sampleCsv(sessionId, LARGE_DATA.modelSampleRows);
    const table = parseDelimited(sample.csv);
    if (tool === "clustering") {
      const result = kmeans(table, 3);
      if (!result) return { summary: "Need at least two numeric columns and enough rows to cluster.", findings: [], ...(sample.note ? { note: sample.note } : {}) };
      return {
        summary: `K-means with k=${result.k} — inertia ${result.inertia.toFixed(1)}.`,
        findings: result.sizes.map((size, index) => ({
          label: `Cluster ${index + 1}`,
          value: `${size} rows`,
          note: Object.entries(result.means[index] ?? {})
            .slice(0, 3)
            .map(([name, value]) => `${name} ${fmt(value)}`)
            .join(" · "),
        })),
        ...(sample.sampled ? { note: sample.note } : {}),
      };
    }
    const result = pca(table);
    if (!result) return { summary: "Need at least two numeric columns for PCA.", findings: [], ...(sample.note ? { note: sample.note } : {}) };
    return {
      summary: `PC1 explains ${(result.explained[0] ?? 0).toFixed(1)}% of variance; PC2 explains ${(result.explained[1] ?? 0).toFixed(1)}%.`,
      findings: result.loadings.slice(0, 8).map((loading) => ({
        label: loading.name,
        value: `PC1 ${loading.pc1.toFixed(2)}`,
        note: `PC2 ${loading.pc2.toFixed(2)}`,
      })),
      ...(sample.sampled ? { note: sample.note } : {}),
    };
  }

  const worst = [...info.columns].sort((a, b) => b.missing - a.missing)[0];
  const correlation = await runAnalysis(sessionId, { operation: "correlation" });
  const strongest = correlation.rows?.[0];
  const lines = [
    `The file has ${info.rowCount.toLocaleString()} rows and ${info.columnCount} columns (${numeric.length} numeric).`,
    worst && worst.missing > 0
      ? `${worst.name} has the most gaps (${worst.missing.toLocaleString()} blank cells, ${worst.missingPct.toFixed(1)}%).`
      : "No missing values showed up in this file.",
    strongest ? `The strongest numeric relationship is ${strongest[0]} ↔ ${strongest[1]} (r = ${strongest[2]}).` : "There are not two numeric columns to compare.",
    "Outliers are flagged for review. They are not removed automatically.",
    text[0] ? `Use ${text[0].name} as a segment column to break down the numeric metrics.` : "Add a category column if you want a segment breakdown.",
    "Next: review data quality, then group or trend the metric you care about.",
  ];
  return {
    summary: lines[0] ?? "Insights ready.",
    findings: lines.slice(1).map((line, index) => ({ label: `Finding ${index + 1}`, value: line })),
  };
}

function num(value: unknown): number {
  const next = typeof value === "bigint" ? Number(value) : value;
  const parsed = typeof next === "number" ? next : Number(next);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function cellText(value: unknown): string {
  return value == null ? "" : String(value);
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return Math.abs(value) >= 100 ? String(Math.round(value * 100) / 100) : String(Math.round(value * 10000) / 10000);
}
