export type Finding = { label: string; value: string; note?: string };

export type ToolKey =
  | "profile"
  | "summary_stats"
  | "missing_values"
  | "outliers"
  | "correlation"
  | "trend"
  | "segment"
  | "regression"
  | "clustering"
  | "pca"
  | "insights";

export const TOOLS: { key: ToolKey; name: string; blurb: string }[] = [
  { key: "profile", name: "Dataset profile", blurb: "Shape, column types and a first look at every field." },
  { key: "summary_stats", name: "Summary statistics", blurb: "Mean, median, min, max, skew and spread for numeric columns." },
  { key: "missing_values", name: "Missing values", blurb: "Blank and null counts per column, ranked." },
  { key: "outliers", name: "Outlier scan", blurb: "Values beyond 3 standard deviations, per column." },
  { key: "correlation", name: "Correlation", blurb: "Strongest relationships between numeric columns." },
  { key: "trend", name: "Trend & change", blurb: "First-half vs second-half movement over the rows." },
  { key: "segment", name: "Segment breakdown", blurb: "Totals and averages grouped by the first text column." },
  { key: "regression", name: "Linear regression", blurb: "Predict a numeric target from one or more features." },
  { key: "clustering", name: "K-means clustering", blurb: "Group similar rows and summarise each cluster." },
  { key: "pca", name: "PCA reduction", blurb: "Project numeric columns onto two principal components." },
  { key: "insights", name: "Executive insights", blurb: "Plain-language findings you can act on." },
];

export type Table = { columns: string[]; rows: string[][] };
export type ColumnType = "numeric" | "text" | "date" | "boolean" | "unknown";
export type FillStrategy = "mean" | "median" | "mode" | "drop";

const NULLS = new Set([
  "",
  "null",
  "na",
  "n/a",
  "none",
  "nan",
  "#n/a",
  "#value!",
  "#ref!",
  "undefined",
  "missing",
  "?",
  "unknown",
  "—",
  "-",
  "--",
]);

export function tableToCsv(table: Table, maxRows = 5000): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = table.rows.slice(0, maxRows);
  return [table.columns.map(esc).join(","), ...rows.map((r) => table.columns.map((_, i) => esc(r[i] ?? "")).join(","))].join("\n");
}

export function parseDelimited(text: string): Table {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  const delimiter = (lines[0]!.match(/\t/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out.map((c) => c.replace(/^"|"$/g, ""));
  };
  const columns = split(lines[0]!);
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    while (cells.length < columns.length) cells.push("");
    return cells.slice(0, columns.length);
  });
  return { columns, rows };
}

export const parseNumber = (v: string | undefined) => {
  if (v === undefined) return NaN;
  let s = v.trim();
  if (!s || NULLS.has(s.toLowerCase())) return NaN;
  s = s.replace(/^[€$£₹¥₩]/, "").trim();
  s = s.replace(/\s*(USD|EUR|GBP|INR)$/i, "").trim();
  const paren = s.match(/^\(([0-9.,]+)\)$/);
  if (paren) s = `-${paren[1]}`;
  const pct = s.endsWith("%");
  if (pct) s = s.slice(0, -1);
  s = s.replace(/,(?=\d{3})/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const isBlank = (v: string | undefined) => {
  if (v === undefined) return true;
  const s = v.trim();
  return !s || NULLS.has(s.toLowerCase());
};

export function detectTypes(table: Table): Record<string, ColumnType> {
  const types: Record<string, ColumnType> = {};
  for (let i = 0; i < table.columns.length; i++) {
    const name = table.columns[i]!;
    const values = table.rows.map((r) => r[i] ?? "").filter((v) => !isBlank(v));
    if (!values.length) {
      types[name] = "unknown";
      continue;
    }
    const nums = values.filter((v) => Number.isFinite(parseNumber(v))).length;
    const bools = values.filter((v) => ["true", "false", "yes", "no", "y", "n"].includes(v.trim().toLowerCase())).length;
    const dates = values.filter((v) => !Number.isFinite(Number(v)) && !Number.isNaN(Date.parse(v)) && v.length > 4).length;
    if (nums / values.length >= 0.9) types[name] = "numeric";
    else if (dates / values.length >= 0.8) types[name] = "date";
    else if (bools / values.length >= 0.9) types[name] = "boolean";
    else types[name] = "text";
  }
  return types;
}

function numericColumns(table: Table) {
  return table.columns
    .map((name, i) => {
      const values = table.rows.map((r) => parseNumber(r[i])).filter((n) => Number.isFinite(n));
      return { name, index: i, values };
    })
    .filter((c) => c.values.length >= Math.max(3, table.rows.length * 0.5));
}

const fmt = (n: number) =>
  Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toFixed(2);

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const sd = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};
const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const mode = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "";
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
};
const skewness = (v: number[]) => {
  if (v.length < 3) return 0;
  const m = mean(v);
  const s = sd(v) || 1;
  return v.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / v.length;
};
const kurtosis = (v: number[]) => {
  if (v.length < 4) return 0;
  const m = mean(v);
  const s = sd(v) || 1;
  return v.reduce((a, x) => a + ((x - m) / s) ** 4, 0) / v.length - 3;
};

export type CleanReport = {
  originalRows: number;
  cleanedRows: number;
  duplicatesRemoved: number;
  missingFilled: number;
  rowsDropped: number;
};

export function cleanTable(
  table: Table,
  options: { fill: FillStrategy; removeDuplicates: boolean },
): { table: Table; report: CleanReport } {
  const types = detectTypes(table);
  let rows = table.rows.map((r) => [...r]);
  let missingFilled = 0;
  let rowsDropped = 0;

  const fillValues = table.columns.map((name, i) => {
    if (types[name] === "numeric") {
      const nums = rows.map((r) => parseNumber(r[i])).filter((n) => Number.isFinite(n));
      if (options.fill === "median") return String(median(nums));
      if (options.fill === "mode") return mode(rows.map((r) => r[i] ?? "").filter((v) => !isBlank(v)));
      return String(mean(nums));
    }
    return mode(rows.map((r) => r[i] ?? "").filter((v) => !isBlank(v)));
  });

  if (options.fill === "drop") {
    const kept = rows.filter((r) => r.every((cell) => !isBlank(cell)));
    rowsDropped = rows.length - kept.length;
    rows = kept;
  } else {
    rows = rows.map((r) =>
      r.map((cell, i) => {
        if (!isBlank(cell)) return cell;
        missingFilled += 1;
        return fillValues[i] ?? "";
      }),
    );
  }

  let duplicatesRemoved = 0;
  if (options.removeDuplicates) {
    const seen = new Set<string>();
    const unique: string[][] = [];
    for (const r of rows) {
      const key = JSON.stringify(r);
      if (seen.has(key)) {
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(key);
      unique.push(r);
    }
    rows = unique;
  }

  return {
    table: { columns: table.columns, rows },
    report: {
      originalRows: table.rows.length,
      cleanedRows: rows.length,
      duplicatesRemoved,
      missingFilled,
      rowsDropped,
    },
  };
}

export function previewRows(table: Table, limit = 12) {
  return table.rows.slice(0, limit);
}

export function describeNumeric(table: Table) {
  return numericColumns(table).map((c) => {
    const sorted = [...c.values].sort((a, b) => a - b);
    return {
      name: c.name,
      n: c.values.length,
      mean: mean(c.values),
      median: median(c.values),
      std: sd(c.values),
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      skew: skewness(c.values),
      kurtosis: kurtosis(c.values),
    };
  });
}

export function correlationMatrix(table: Table) {
  const numeric = numericColumns(table);
  const names = numeric.map((c) => c.name);
  const matrix = names.map((_, i) => names.map(() => 0));
  for (let a = 0; a < numeric.length; a++) {
    for (let b = 0; b < numeric.length; b++) {
      if (a === b) {
        matrix[a]![b] = 1;
        continue;
      }
      const xs = numeric[a]!.values;
      const ys = numeric[b]!.values;
      const n = Math.min(xs.length, ys.length);
      const x = xs.slice(0, n);
      const y = ys.slice(0, n);
      const mx = mean(x);
      const my = mean(y);
      const cov = x.reduce((acc, v, i) => acc + (v - mx) * (y[i]! - my), 0);
      const den = Math.sqrt(x.reduce((acc, v) => acc + (v - mx) ** 2, 0) * y.reduce((acc, v) => acc + (v - my) ** 2, 0));
      matrix[a]![b] = den === 0 ? 0 : cov / den;
    }
  }
  return { names, matrix };
}

export type RegressionResult = {
  intercept: number;
  coefficients: { name: string; value: number }[];
  r2: number;
  n: number;
  equation: string;
  points?: { x: number; y: number; fitted: number }[];
};

function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row]![col]!) > Math.abs(M[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const div = M[col]![col]!;
    for (let j = col; j <= n; j++) M[col]![j]! /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row]![col]!;
      for (let j = col; j <= n; j++) M[row]![j]! -= f * M[col]![j]!;
    }
  }
  return M.map((row) => row[n]!);
}

export function linearRegression(table: Table, xName: string, yName: string): RegressionResult | null {
  const xi = table.columns.indexOf(xName);
  const yi = table.columns.indexOf(yName);
  if (xi < 0 || yi < 0) return null;
  const pairs: [number, number][] = [];
  for (const r of table.rows) {
    const x = parseNumber(r[xi]);
    const y = parseNumber(r[yi]);
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  if (pairs.length < 3) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < pairs.length; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    syy += (ys[i]! - my) ** 2;
  }
  if (sxx < 1e-12) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const ssRes = pairs.reduce((a, [x, y]) => a + (y - (slope * x + intercept)) ** 2, 0);
  const r2 = syy < 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / syy));
  return {
    intercept,
    coefficients: [{ name: xName, value: slope }],
    r2,
    n: pairs.length,
    equation: `${yName} = ${intercept.toFixed(3)} + ${slope.toFixed(3)} × ${xName}`,
    points: pairs.slice(0, 400).map(([x, y]) => ({ x, y, fitted: slope * x + intercept })),
  };
}

export function multipleRegression(table: Table, xNames: string[], yName: string): RegressionResult | null {
  const yi = table.columns.indexOf(yName);
  const xis = xNames.map((n) => table.columns.indexOf(n));
  if (yi < 0 || xis.some((i) => i < 0) || !xNames.length) return null;
  const rows: { x: number[]; y: number }[] = [];
  for (const r of table.rows) {
    const y = parseNumber(r[yi]);
    const x = xis.map((i) => parseNumber(r[i]!));
    if (Number.isFinite(y) && x.every((v) => Number.isFinite(v))) rows.push({ x, y });
  }
  if (rows.length < xNames.length + 2) return null;
  const X = rows.map((row) => [1, ...row.x]);
  const y = rows.map((row) => row.y);
  const p = X[0]!.length;
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty = Array(p).fill(0) as number[];
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < p; i++) {
      Xty[i]! += X[r]![i]! * y[r]!;
      for (let j = 0; j < p; j++) XtX[i]![j]! += X[r]![i]! * X[r]![j]!;
    }
  }
  const beta = solve(XtX, Xty);
  if (!beta) return null;
  const fitted = X.map((row) => row.reduce((s, v, i) => s + v * beta[i]!, 0));
  const my = mean(y);
  const ssTot = y.reduce((a, v) => a + (v - my) ** 2, 0);
  const ssRes = y.reduce((a, v, i) => a + (v - fitted[i]!) ** 2, 0);
  const r2 = ssTot < 1e-12 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  const coeffs = xNames.map((name, i) => ({ name, value: beta[i + 1]! }));
  const terms = coeffs.map((c) => `${c.value >= 0 ? "+" : "−"} ${Math.abs(c.value).toFixed(3)} × ${c.name}`).join(" ");
  return {
    intercept: beta[0]!,
    coefficients: coeffs,
    r2,
    n: rows.length,
    equation: `${yName} = ${beta[0]!.toFixed(3)} ${terms}`,
  };
}

export type ClusterResult = {
  k: number;
  inertia: number;
  sizes: number[];
  means: Record<string, number>[];
  points: { x: number; y: number; cluster: number }[];
};

function kmeansFit(data: number[][], k: number, maxIter = 80) {
  const dims = data[0]!.length;
  const centroids = [data[Math.floor(Math.random() * data.length)]!.slice()];
  while (centroids.length < k) {
    const dist = data.map((p) => Math.min(...centroids.map((c) => p.reduce((s, v, i) => s + (v - c[i]!) ** 2, 0))));
    const total = dist.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * total;
    let chosen = data[0]!;
    for (let i = 0; i < data.length; i++) {
      r -= dist[i]!;
      if (r <= 0) {
        chosen = data[i]!;
        break;
      }
    }
    centroids.push(chosen.slice());
  }
  let labels = data.map(() => 0);
  for (let iter = 0; iter < maxIter; iter++) {
    labels = data.map((p) => {
      let best = 0;
      let bestD = Infinity;
      centroids.forEach((c, i) => {
        const d = p.reduce((s, v, j) => s + (v - c[j]!) ** 2, 0);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    });
    const sums = Array.from({ length: k }, () => Array(dims).fill(0));
    const counts = Array(k).fill(0);
    data.forEach((p, i) => {
      counts[labels[i]!]! += 1;
      p.forEach((v, j) => {
        sums[labels[i]!]![j]! += v;
      });
    });
    for (let i = 0; i < k; i++) {
      if (counts[i]) centroids[i] = sums[i]!.map((v) => v / counts[i]!);
    }
  }
  const inertia = data.reduce((s, p, i) => s + p.reduce((a, v, j) => a + (v - centroids[labels[i]!]![j]!) ** 2, 0), 0);
  return { labels, centroids, inertia };
}

export function kmeans(table: Table, k = 3): ClusterResult | null {
  const numeric = numericColumns(table);
  if (numeric.length < 2 || table.rows.length < k) return null;
  const cols = numeric.slice(0, 6);
  const data: number[][] = [];
  const keep: number[] = [];
  table.rows.forEach((row, idx) => {
    const point = cols.map((c) => parseNumber(row[c.index]));
    if (point.every((n) => Number.isFinite(n))) {
      data.push(point);
      keep.push(idx);
    }
  });
  if (data.length < k) return null;
  const { labels, centroids, inertia } = kmeansFit(data, Math.min(k, data.length));
  const sizes = Array(k).fill(0);
  labels.forEach((l) => {
    sizes[l]! += 1;
  });
  const means = centroids.map((c) => {
    const rec: Record<string, number> = {};
    cols.forEach((col, i) => {
      rec[col.name] = c[i]!;
    });
    return rec;
  });
  const x = 0;
  const y = 1;
  return {
    k,
    inertia,
    sizes,
    means,
    points: data.slice(0, 400).map((p, i) => ({ x: p[x]!, y: p[y]!, cluster: labels[i]! })),
  };
}

export type PcaResult = {
  explained: number[];
  loadings: { name: string; pc1: number; pc2: number }[];
  points: { x: number; y: number }[];
};

export function pca(table: Table): PcaResult | null {
  const numeric = numericColumns(table);
  if (numeric.length < 2) return null;
  const cols = numeric.slice(0, 8);
  const matrix: number[][] = [];
  table.rows.forEach((row) => {
    const point = cols.map((c) => parseNumber(row[c.index]));
    if (point.every((n) => Number.isFinite(n))) matrix.push(point);
  });
  if (matrix.length < 3) return null;
  const p = cols.length;
  const means = Array(p).fill(0);
  const stds = Array(p).fill(0);
  for (let j = 0; j < p; j++) means[j] = mean(matrix.map((r) => r[j]!));
  for (let j = 0; j < p; j++) {
    stds[j] = sd(matrix.map((r) => r[j]!)) || 1;
  }
  const Z = matrix.map((row) => row.map((v, j) => (v - means[j]!) / stds[j]!));
  const cov = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      cov[i]![j] = Z.reduce((s, row) => s + row[i]! * row[j]!, 0) / Math.max(1, Z.length - 1);
    }
  }
  const power = (M: number[][]) => {
    let v = Array.from({ length: p }, () => Math.random() - 0.5);
    for (let s = 0; s < 120; s++) {
      const mv = M.map((row) => row.reduce((a, val, j) => a + val * v[j]!, 0));
      const norm = Math.sqrt(mv.reduce((a, b) => a + b * b, 0)) || 1;
      v = mv.map((x) => x / norm);
    }
    const value = v.reduce((a, vi, i) => a + vi * M[i]!.reduce((s, mij, j) => s + mij * v[j]!, 0), 0);
    return { vector: v, value: Math.abs(value) };
  };
  const first = power(cov);
  const deflated = cov.map((row, i) => row.map((val, j) => val - first.value * first.vector[i]! * first.vector[j]!));
  const second = power(deflated);
  const total = first.value + second.value + 1e-9;
  return {
    explained: [(first.value / total) * 100, (second.value / total) * 100],
    loadings: cols.map((c, i) => ({ name: c.name, pc1: first.vector[i]!, pc2: second.vector[i]! })),
    points: Z.slice(0, 400).map((row) => ({
      x: row.reduce((s, v, i) => s + v * first.vector[i]!, 0),
      y: row.reduce((s, v, i) => s + v * second.vector[i]!, 0),
    })),
  };
}

export function executiveInsights(table: Table): string[] {
  const numeric = numericColumns(table);
  const types = detectTypes(table);
  const missing = table.columns.map((name, i) => ({
    name,
    blanks: table.rows.filter((r) => isBlank(r[i])).length,
  }));
  const worst = [...missing].sort((a, b) => b.blanks - a.blanks)[0];
  const corr = correlationMatrix(table);
  let strongest = { a: "", b: "", r: 0 };
  for (let i = 0; i < corr.names.length; i++) {
    for (let j = i + 1; j < corr.names.length; j++) {
      const r = corr.matrix[i]![j]!;
      if (Math.abs(r) > Math.abs(strongest.r)) strongest = { a: corr.names[i]!, b: corr.names[j]!, r };
    }
  }
  const insights = [
    `The file has ${table.rows.length.toLocaleString()} rows and ${table.columns.length} columns (${numeric.length} numeric).`,
  ];
  if (worst && worst.blanks > 0) {
    insights.push(
      `${worst.name} has the most gaps (${worst.blanks} blank cells, ${((worst.blanks / table.rows.length) * 100).toFixed(1)}%). Fill or drop those before modelling.`,
    );
  } else {
    insights.push("No missing values showed up in this extract — you can move straight to modelling.");
  }
  if (strongest.a) {
    insights.push(
      `The strongest numeric relationship is ${strongest.a} ↔ ${strongest.b} (r = ${strongest.r.toFixed(2)}).`,
    );
  }
  const skewed = describeNumeric(table).filter((c) => Math.abs(c.skew) > 1);
  if (skewed.length) {
    insights.push(`${skewed[0]!.name} is skewed (${skewed[0]!.skew.toFixed(2)}). A log transform may help regression.`);
  }
  const textCols = Object.entries(types).filter(([, t]) => t === "text").map(([n]) => n);
  if (textCols.length) {
    insights.push(`Use ${textCols[0]} as a segment column to break down the numeric metrics.`);
  }
  insights.push("Next: clean duplicates, run correlation, then regression or clustering depending on the question.");
  return insights;
}

export function runTool(tool: ToolKey, table: Table): { summary: string; findings: Finding[] } {
  const numeric = numericColumns(table);
  const rowCount = table.rows.length;

  if (rowCount === 0 || table.columns.length === 0) {
    return { summary: "No readable rows were found in this input.", findings: [] };
  }

  switch (tool) {
    case "profile": {
      const types = detectTypes(table);
      const findings = table.columns.slice(0, 12).map((name, i) => {
        const unique = new Set(table.rows.map((r) => r[i])).size;
        return {
          label: name,
          value: types[name] ?? "text",
          note: `${unique} distinct value${unique === 1 ? "" : "s"}`,
        };
      });
      return {
        summary: `${rowCount.toLocaleString()} rows across ${table.columns.length} columns — ${numeric.length} numeric, ${table.columns.length - numeric.length} other.`,
        findings,
      };
    }
    case "summary_stats": {
      const findings = describeNumeric(table)
        .slice(0, 8)
        .map((c) => ({
          label: c.name,
          value: `avg ${fmt(c.mean)}`,
          note: `median ${fmt(c.median)} · min ${fmt(c.min)} · max ${fmt(c.max)} · skew ${c.skew.toFixed(2)}`,
        }));
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
          const blanks = table.rows.filter((r) => isBlank(r[i])).length;
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
      const total = table.columns.reduce((acc, _c, i) => acc + table.rows.filter((r) => isBlank(r[i])).length, 0);
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
      const { names, matrix } = correlationMatrix(table);
      const findings: Finding[] = [];
      for (let a = 0; a < names.length; a++) {
        for (let b = a + 1; b < names.length; b++) {
          const r = matrix[a]![b]!;
          findings.push({
            label: `${names[a]} ↔ ${names[b]}`,
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
      const types = detectTypes(table);
      const textIndex = table.columns.findIndex((name) => types[name] === "text");
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
        const v = parseNumber(r[valueCol.index]);
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
    case "regression": {
      if (numeric.length < 2) {
        return { summary: "Need at least two numeric columns to run regression.", findings: [] };
      }
      const result = linearRegression(table, numeric[0]!.name, numeric[1]!.name);
      if (!result) return { summary: "Regression could not be fit on this extract.", findings: [] };
      return {
        summary: result.equation + `  (R² = ${result.r2.toFixed(3)}, n = ${result.n})`,
        findings: [
          { label: "Intercept", value: result.intercept.toFixed(3) },
          ...result.coefficients.map((c) => ({ label: c.name, value: c.value.toFixed(3) })),
          { label: "R²", value: result.r2.toFixed(3), note: `${(result.r2 * 100).toFixed(1)}% of variance explained` },
        ],
      };
    }
    case "clustering": {
      const result = kmeans(table, 3);
      if (!result) return { summary: "Need at least two numeric columns and enough rows to cluster.", findings: [] };
      return {
        summary: `K-means with k=${result.k} — inertia ${result.inertia.toFixed(1)}.`,
        findings: result.sizes.map((size, i) => ({
          label: `Cluster ${i + 1}`,
          value: `${size} rows`,
          note: Object.entries(result.means[i] ?? {})
            .slice(0, 3)
            .map(([k, v]) => `${k} ${fmt(v)}`)
            .join(" · "),
        })),
      };
    }
    case "pca": {
      const result = pca(table);
      if (!result) return { summary: "Need at least two numeric columns for PCA.", findings: [] };
      return {
        summary: `PC1 explains ${result.explained[0]!.toFixed(1)}% of variance; PC2 explains ${result.explained[1]!.toFixed(1)}%.`,
        findings: result.loadings.slice(0, 8).map((l) => ({
          label: l.name,
          value: `PC1 ${l.pc1.toFixed(2)}`,
          note: `PC2 ${l.pc2.toFixed(2)}`,
        })),
      };
    }
    case "insights": {
      const lines = executiveInsights(table);
      return {
        summary: lines[0] ?? "Insights ready.",
        findings: lines.slice(1).map((line, i) => ({ label: `Finding ${i + 1}`, value: line })),
      };
    }
  }
}
