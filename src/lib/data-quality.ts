import { detectTypes, parseNumber, type Table } from "./analysis";

export type IssueSeverity = "safe" | "review";

export type IssueKind =
  | "missing"
  | "whitespace"
  | "category_inconsistency"
  | "duplicate_rows"
  | "duplicate_id"
  | "type_mismatch"
  | "outlier"
  | "invalid_value"
  | "business_rule";

export type IssueSample = { rowIndex: number; column: string; before: string; after?: string };

export type QualityIssue = {
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  title: string;
  reason: string;
  column?: string;
  columns?: string[];
  affectedRowIndexes: number[];
  sample: IssueSample[];
  canApply: boolean;
  mapping?: Record<string, string>;
};

export type QualityScore = {
  overall: number;
  completeness: number;
  consistency: number;
  validity: number;
  uniqueness: number;
  typeCorrectness: number;
};

export type QualityReport = {
  issues: QualityIssue[];
  score: QualityScore;
  rowCount: number;
  columnCount: number;
};

const isBlank = (v: string | undefined) => v === undefined || v.trim() === "";

function sample(rows: IssueSample[], limit = 5): IssueSample[] {
  return rows.slice(0, limit);
}

function detectMissing(table: Table): QualityIssue[] {
  const issues: QualityIssue[] = [];
  table.columns.forEach((name, i) => {
    const rowIdx: number[] = [];
    table.rows.forEach((r, ri) => {
      if (isBlank(r[i])) rowIdx.push(ri);
    });
    if (!rowIdx.length) return;
    const pct = ((rowIdx.length / table.rows.length) * 100).toFixed(1);
    issues.push({
      id: `missing:${name}`,
      kind: "missing",
      severity: "review",
      title: `Missing values in "${name}"`,
      reason: `${rowIdx.length} of ${table.rows.length} rows (${pct}%) are blank in this column.`,
      column: name,
      affectedRowIndexes: rowIdx,
      sample: sample(rowIdx.map((ri) => ({ rowIndex: ri, column: name, before: "(blank)" }))),
      canApply: true,
    });
  });
  return issues;
}

function detectWhitespace(table: Table): QualityIssue[] {
  const issues: QualityIssue[] = [];
  table.columns.forEach((name, i) => {
    const hits: IssueSample[] = [];
    table.rows.forEach((r, ri) => {
      const v = r[i];
      if (v && !isBlank(v) && v !== v.trim()) {
        hits.push({ rowIndex: ri, column: name, before: JSON.stringify(v), after: JSON.stringify(v.trim()) });
      }
    });
    if (!hits.length) return;
    issues.push({
      id: `whitespace:${name}`,
      kind: "whitespace",
      severity: "safe",
      title: `Stray whitespace in "${name}"`,
      reason: `${hits.length} value${hits.length === 1 ? "" : "s"} have leading or trailing spaces.`,
      column: name,
      affectedRowIndexes: hits.map((h) => h.rowIndex),
      sample: sample(hits),
      canApply: true,
    });
  });
  return issues;
}

function detectCategoryInconsistencies(table: Table, types: Record<string, string>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  table.columns.forEach((name, i) => {
    if (types[name] !== "text") return;
    const groups = new Map<string, Map<string, number[]>>();
    table.rows.forEach((r, ri) => {
      const v = r[i];
      if (v === undefined || isBlank(v)) return;
      const norm = v.trim().toLowerCase();
      if (!groups.has(norm)) groups.set(norm, new Map());
      const variants = groups.get(norm)!;
      variants.set(v, [...(variants.get(v) ?? []), ri]);
    });
    if (groups.size > 60) return; // likely free text, not a category column
    for (const [norm, variants] of groups) {
      if (variants.size < 2) continue;
      let canonical = "";
      let best = 0;
      for (const [raw, idxs] of variants) {
        if (idxs.length > best) {
          best = idxs.length;
          canonical = raw;
        }
      }
      const affected: number[] = [];
      const mapping: Record<string, string> = {};
      const sampleRows: IssueSample[] = [];
      for (const [raw, idxs] of variants) {
        if (raw === canonical) continue;
        mapping[raw] = canonical;
        for (const ri of idxs) {
          affected.push(ri);
          sampleRows.push({ rowIndex: ri, column: name, before: raw, after: canonical });
        }
      }
      if (!affected.length) continue;
      issues.push({
        id: `category:${name}:${norm}`,
        kind: "category_inconsistency",
        severity: "safe",
        title: `Inconsistent casing/spacing in "${name}"`,
        reason: `${[...variants.keys()].map((v) => `"${v}"`).join(", ")} look like the same value — standardising to "${canonical}".`,
        column: name,
        affectedRowIndexes: affected,
        sample: sample(sampleRows),
        canApply: true,
        mapping,
      });
    }
  });
  return issues;
}

function detectExactDuplicateRows(table: Table): QualityIssue[] {
  const seen = new Map<string, number>();
  const dupIdx: number[] = [];
  const sampleRows: IssueSample[] = [];
  table.rows.forEach((r, ri) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) {
      dupIdx.push(ri);
      sampleRows.push({ rowIndex: ri, column: "(entire row)", before: r.join(" | ") });
    } else {
      seen.set(key, ri);
    }
  });
  if (!dupIdx.length) return [];
  return [
    {
      id: "duplicate_rows",
      kind: "duplicate_rows",
      severity: "review",
      title: "Exact duplicate rows",
      reason: `${dupIdx.length} row${dupIdx.length === 1 ? "" : "s"} are identical to an earlier row.`,
      affectedRowIndexes: dupIdx,
      sample: sample(sampleRows),
      canApply: true,
    },
  ];
}

function detectDuplicateIds(table: Table): QualityIssue[] {
  const issues: QualityIssue[] = [];
  table.columns.forEach((name, i) => {
    if (!/(^|[_\s])id([_\s]|$)/i.test(name) && !/id$/i.test(name)) return;
    const seen = new Map<string, number[]>();
    table.rows.forEach((r, ri) => {
      const v = r[i];
      if (v === undefined || isBlank(v)) return;
      seen.set(v, [...(seen.get(v) ?? []), ri]);
    });
    const affected: number[] = [];
    const sampleRows: IssueSample[] = [];
    for (const [v, idxs] of seen) {
      if (idxs.length < 2) continue;
      affected.push(...idxs);
      for (const ri of idxs) sampleRows.push({ rowIndex: ri, column: name, before: v });
    }
    if (!affected.length) return;
    issues.push({
      id: `duplicate_id:${name}`,
      kind: "duplicate_id",
      severity: "review",
      title: `Repeated values in identifier column "${name}"`,
      reason: `${affected.length} rows share an identifier value that looks like it should be unique.`,
      column: name,
      affectedRowIndexes: affected,
      sample: sample(sampleRows),
      canApply: false,
    });
  });
  return issues;
}

function detectTypeMismatches(table: Table, types: Record<string, string>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  table.columns.forEach((name, i) => {
    if (types[name] !== "numeric") return;
    const hits: IssueSample[] = [];
    table.rows.forEach((r, ri) => {
      const v = r[i];
      if (isBlank(v)) return;
      if (!Number.isFinite(parseNumber(v))) hits.push({ rowIndex: ri, column: name, before: v! });
    });
    if (!hits.length) return;
    issues.push({
      id: `type_mismatch:${name}`,
      kind: "type_mismatch",
      severity: "review",
      title: `Non-numeric values in "${name}"`,
      reason: `${hits.length} value${hits.length === 1 ? "" : "s"} don't parse as numbers in an otherwise numeric column.`,
      column: name,
      affectedRowIndexes: hits.map((h) => h.rowIndex),
      sample: sample(hits),
      canApply: false,
    });
  });
  return issues;
}

function quartile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base]! + rest * (sorted[base + 1]! - sorted[base]!) : sorted[base]!;
}

function detectOutliers(table: Table, types: Record<string, string>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  table.columns.forEach((name, i) => {
    if (types[name] !== "numeric") return;
    const values = table.rows
      .map((r, ri) => ({ ri, v: parseNumber(r[i]) }))
      .filter((p) => Number.isFinite(p.v));
    if (values.length < 5) return;
    const nums = values.map((p) => p.v);
    const m = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, nums.length - 1)) || 1;
    const sorted = [...nums].sort((a, b) => a - b);
    const q1 = quartile(sorted, 0.25);
    const q3 = quartile(sorted, 0.75);
    const iqr = q3 - q1 || 1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const hits: IssueSample[] = [];
    for (const { ri, v } of values) {
      const byStdDev = Math.abs(v - m) > 3 * sd;
      const byIqr = v < lower || v > upper;
      if (byStdDev || byIqr) {
        hits.push({
          rowIndex: ri,
          column: name,
          before: String(v),
          after: `${byStdDev ? "beyond 3σ" : ""}${byStdDev && byIqr ? " & " : ""}${byIqr ? "outside IQR range" : ""}`,
        });
      }
    }
    if (!hits.length) return;
    issues.push({
      id: `outlier:${name}`,
      kind: "outlier",
      severity: "review",
      title: `Potential outliers in "${name}"`,
      reason: `${hits.length} value${hits.length === 1 ? "" : "s"} sit beyond 3 standard deviations or outside the IQR range (avg ${m.toFixed(2)}). An outlier isn't automatically wrong — review before acting.`,
      column: name,
      affectedRowIndexes: hits.map((h) => h.rowIndex),
      sample: sample(hits),
      canApply: false,
    });
  });
  return issues;
}

const RULES: { pattern: RegExp; min?: number; max?: number; label: string }[] = [
  { pattern: /^age$/i, min: 0, max: 120, label: "age" },
  { pattern: /rating/i, min: 1, max: 5, label: "rating" },
  { pattern: /(price|revenue|amount|quantity|^qty$|units?|cost|spend)/i, min: 0, label: "non-negative value" },
];

function detectInvalidValues(table: Table, types: Record<string, string>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  table.columns.forEach((name, i) => {
    const rule = RULES.find((r) => r.pattern.test(name));
    if (rule && types[name] === "numeric") {
      const hits: IssueSample[] = [];
      table.rows.forEach((r, ri) => {
        const v = parseNumber(r[i]);
        if (!Number.isFinite(v)) return;
        if ((rule.min !== undefined && v < rule.min) || (rule.max !== undefined && v > rule.max)) {
          hits.push({ rowIndex: ri, column: name, before: String(v) });
        }
      });
      if (hits.length) {
        issues.push({
          id: `invalid:${name}`,
          kind: "invalid_value",
          severity: "review",
          title: `Out-of-range values in "${name}"`,
          reason: `${hits.length} value${hits.length === 1 ? "" : "s"} fall outside a plausible ${rule.label} range${
            rule.max !== undefined ? ` (${rule.min}–${rule.max})` : rule.min !== undefined ? ` (≥ ${rule.min})` : ""
          }.`,
          column: name,
          affectedRowIndexes: hits.map((h) => h.rowIndex),
          sample: sample(hits),
          canApply: false,
        });
      }
    }
    if (types[name] === "date") {
      const hits: IssueSample[] = [];
      table.rows.forEach((r, ri) => {
        const v = r[i];
        if (isBlank(v)) return;
        if (Number.isNaN(Date.parse(v!))) hits.push({ rowIndex: ri, column: name, before: v! });
      });
      if (hits.length) {
        issues.push({
          id: `invalid_date:${name}`,
          kind: "invalid_value",
          severity: "review",
          title: `Unparseable dates in "${name}"`,
          reason: `${hits.length} value${hits.length === 1 ? "" : "s"} don't parse as a date.`,
          column: name,
          affectedRowIndexes: hits.map((h) => h.rowIndex),
          sample: sample(hits),
          canApply: false,
        });
      }
    }
  });
  return issues;
}

function detectBusinessRules(table: Table): QualityIssue[] {
  const revenueIdx = table.columns.findIndex((c) => /revenue/i.test(c));
  const priceIdx = table.columns.findIndex((c) => /^(unit.?price|price)$/i.test(c));
  const qtyIdx = table.columns.findIndex((c) => /(quantity|^qty$)/i.test(c));
  if (revenueIdx < 0 || priceIdx < 0 || qtyIdx < 0) return [];
  const hits: IssueSample[] = [];
  table.rows.forEach((r, ri) => {
    const revenue = parseNumber(r[revenueIdx]);
    const price = parseNumber(r[priceIdx]);
    const qty = parseNumber(r[qtyIdx]);
    if (![revenue, price, qty].every(Number.isFinite)) return;
    const expected = price * qty;
    const tolerance = Math.max(1, Math.abs(expected) * 0.01);
    if (Math.abs(expected - revenue) > tolerance) {
      hits.push({
        rowIndex: ri,
        column: table.columns[revenueIdx]!,
        before: String(revenue),
        after: `expected ${expected.toFixed(2)}`,
      });
    }
  });
  if (!hits.length) return [];
  return [
    {
      id: "business_rule:revenue",
      kind: "business_rule",
      severity: "review",
      title: `"${table.columns[revenueIdx]}" doesn't match ${table.columns[priceIdx]} × ${table.columns[qtyIdx]}`,
      reason: `${hits.length} row${hits.length === 1 ? "" : "s"} have a revenue value that doesn't match price × quantity.`,
      columns: [table.columns[revenueIdx]!, table.columns[priceIdx]!, table.columns[qtyIdx]!],
      affectedRowIndexes: hits.map((h) => h.rowIndex),
      sample: sample(hits),
      canApply: false,
    },
  ];
}

function computeScore(table: Table, issues: QualityIssue[]): QualityScore {
  const cells = Math.max(1, table.rows.length * table.columns.length);
  const missingCells = issues.filter((i) => i.kind === "missing").reduce((a, i) => a + i.affectedRowIndexes.length, 0);
  const completeness = Math.max(0, 1 - missingCells / cells);

  const inconsistentCells = issues
    .filter((i) => i.kind === "category_inconsistency" || i.kind === "whitespace")
    .reduce((a, i) => a + i.affectedRowIndexes.length, 0);
  const consistency = Math.max(0, 1 - inconsistentCells / cells);

  const invalidCells = issues
    .filter((i) => i.kind === "invalid_value" || i.kind === "business_rule")
    .reduce((a, i) => a + i.affectedRowIndexes.length, 0);
  const validity = Math.max(0, 1 - invalidCells / cells);

  const dupRows =
    (issues.find((i) => i.kind === "duplicate_rows")?.affectedRowIndexes.length ?? 0) +
    issues.filter((i) => i.kind === "duplicate_id").reduce((a, i) => a + i.affectedRowIndexes.length, 0);
  const uniqueness = Math.max(0, 1 - dupRows / Math.max(1, table.rows.length));

  const typeMismatchCells = issues.filter((i) => i.kind === "type_mismatch").reduce((a, i) => a + i.affectedRowIndexes.length, 0);
  const typeCorrectness = Math.max(0, 1 - typeMismatchCells / cells);

  const overall = (completeness + consistency + validity + uniqueness + typeCorrectness) / 5;
  const pct = (n: number) => Math.round(n * 100);
  return {
    overall: pct(overall),
    completeness: pct(completeness),
    consistency: pct(consistency),
    validity: pct(validity),
    uniqueness: pct(uniqueness),
    typeCorrectness: pct(typeCorrectness),
  };
}

// A DataSimplr-generated indicator, not an industry-standard metric — the
// five weighted signals above are the whole calculation, nothing hidden.
export function analyzeQuality(table: Table): QualityReport {
  if (!table.rows.length || !table.columns.length) {
    return {
      issues: [],
      score: { overall: 0, completeness: 0, consistency: 0, validity: 0, uniqueness: 0, typeCorrectness: 0 },
      rowCount: 0,
      columnCount: table.columns.length,
    };
  }
  const types = detectTypes(table);
  const issues = [
    ...detectMissing(table),
    ...detectWhitespace(table),
    ...detectCategoryInconsistencies(table, types),
    ...detectExactDuplicateRows(table),
    ...detectDuplicateIds(table),
    ...detectTypeMismatches(table, types),
    ...detectOutliers(table, types),
    ...detectInvalidValues(table, types),
    ...detectBusinessRules(table),
  ];
  return {
    issues,
    score: computeScore(table, issues),
    rowCount: table.rows.length,
    columnCount: table.columns.length,
  };
}

export type CellChange = { rowIndex: number; column: string; before: string; after: string };
export type RowRemoval = { rowIndex: number; row: string[] };
export type ApplyOutcome = { table: Table; cellChanges: CellChange[]; removedRows: RowRemoval[] };

export function applyIssue(table: Table, issue: QualityIssue): ApplyOutcome {
  if (issue.kind === "whitespace" && issue.column) {
    const ci = table.columns.indexOf(issue.column);
    const cellChanges: CellChange[] = [];
    const rows = table.rows.map((r, ri) => {
      const v = r[ci];
      if (v && v !== v.trim() && issue.affectedRowIndexes.includes(ri)) {
        cellChanges.push({ rowIndex: ri, column: issue.column!, before: v, after: v.trim() });
        const next = [...r];
        next[ci] = v.trim();
        return next;
      }
      return r;
    });
    return { table: { columns: table.columns, rows }, cellChanges, removedRows: [] };
  }

  if (issue.kind === "category_inconsistency" && issue.column && issue.mapping) {
    const ci = table.columns.indexOf(issue.column);
    const cellChanges: CellChange[] = [];
    const rows = table.rows.map((r, ri) => {
      const v = r[ci];
      const mapped = v !== undefined ? issue.mapping![v] : undefined;
      if (mapped && issue.affectedRowIndexes.includes(ri)) {
        cellChanges.push({ rowIndex: ri, column: issue.column!, before: v!, after: mapped });
        const next = [...r];
        next[ci] = mapped;
        return next;
      }
      return r;
    });
    return { table: { columns: table.columns, rows }, cellChanges, removedRows: [] };
  }

  if (issue.kind === "missing" && issue.column) {
    const ci = table.columns.indexOf(issue.column);
    const values = table.rows.map((r) => parseNumber(r[ci])).filter(Number.isFinite);
    const isNumeric = values.length >= Math.max(1, table.rows.length * 0.5);
    let fillValue = "";
    if (isNumeric) {
      fillValue = String(values.reduce((a, b) => a + b, 0) / (values.length || 1));
    } else {
      const counts = new Map<string, number>();
      table.rows.forEach((r) => {
        const v = r[ci];
        if (v && v.trim()) counts.set(v, (counts.get(v) ?? 0) + 1);
      });
      let best = "";
      let n = 0;
      for (const [k, c] of counts) {
        if (c > n) {
          best = k;
          n = c;
        }
      }
      fillValue = best;
    }
    const cellChanges: CellChange[] = [];
    const rows = table.rows.map((r, ri) => {
      if (issue.affectedRowIndexes.includes(ri)) {
        cellChanges.push({ rowIndex: ri, column: issue.column!, before: r[ci] ?? "", after: fillValue });
        const next = [...r];
        next[ci] = fillValue;
        return next;
      }
      return r;
    });
    return { table: { columns: table.columns, rows }, cellChanges, removedRows: [] };
  }

  if (issue.kind === "duplicate_rows") {
    const removeSet = new Set(issue.affectedRowIndexes);
    const removedRows: RowRemoval[] = [];
    const rows = table.rows.filter((r, ri) => {
      if (removeSet.has(ri)) {
        removedRows.push({ rowIndex: ri, row: r });
        return false;
      }
      return true;
    });
    return { table: { columns: table.columns, rows }, cellChanges: [], removedRows };
  }

  return { table, cellChanges: [], removedRows: [] };
}
