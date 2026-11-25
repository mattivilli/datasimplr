import type { IssueKind, IssueSeverity, QualityScore } from "../data-quality";

export type ProgressStep = {
  id: string;
  label: string;
  state: "pending" | "active" | "done" | "error";
};

export type ColumnKind = "numeric" | "text" | "date" | "boolean" | "unknown";

export type ColumnSummary = {
  name: string;
  type: ColumnKind;
  missing: number;
  missingPct: number;
  distinct: number;
  samples: string[];
  numeric?: {
    n: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    std: number;
    skew: number;
  };
  dateRange?: { min: string; max: string };
  topValues?: { value: string; count: number }[];
};

export type LargeSessionInfo = {
  id: string;
  fileName: string;
  bytes: number;
  rowCount: number;
  columnCount: number;
  columns: ColumnSummary[];
  structuralNotes: string[];
  excludedRows: number;
  sampled: { rows: number; method: "random" | "first"; label: string } | null;
  filtered: { column: string; value: string } | null;
  timings: { loadMs: number; profileMs: number; qualityMs?: number };
  /** Set when the file was split so it is not loaded as one table. Figures include every part. */
  parts: {
    stem: string;
    partRows: number;
    names: string[];
    rows: number[];
    note: string;
  } | null;
};

export type IssueSample = { rowIndex: number; column: string; before: string; after?: string };

export type CleanAction =
  | { type: "trim"; column: string; affected: number }
  | { type: "categories"; column: string; mapping: Record<string, string>; affected: number }
  | { type: "fill_missing"; column: string; strategy: "mean" | "median" | "mode"; affected: number }
  | { type: "drop_duplicate_rows"; affected: number };

export type LargeIssue = {
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  title: string;
  reason: string;
  column?: string;
  affectedCount: number;
  sample: IssueSample[];
  canApply: boolean;
  action?: CleanAction;
};

export type LargeQuality = {
  issues: LargeIssue[];
  score: QualityScore;
  rowCount: number;
  columnCount: number;
};

export type PreviewPage = {
  columns: string[];
  rows: string[][];
  offset: number;
  limit: number;
  total: number;
};

export type DerivedMetric = {
  name: string;
  left: string;
  op: "mul" | "add" | "sub" | "div";
  right: string;
};

export type AnalysisFilter = {
  column: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: string | number | (string | number)[];
};

/** Structured request the future Ask Your Data planner can hand to either engine. */
export type AnalysisRequest = {
  operation:
    | "profile"
    | "quality"
    | "aggregate"
    | "group_by"
    | "top_n"
    | "bottom_n"
    | "filter"
    | "time_trend"
    | "correlation"
    | "value_counts"
    | "compare"
    | "missing"
    | "duplicates"
    | "outliers";
  groupBy?: string[];
  metric?: string;
  derived?: DerivedMetric;
  aggregation?: "sum" | "avg" | "min" | "max" | "count" | "median";
  filters?: AnalysisFilter[];
  sort?: "asc" | "desc";
  limit?: number;
  dateColumn?: string;
  granularity?: "day" | "week" | "month" | "quarter" | "year";
  columns?: string[];
  by?: string;
  order?: "asc" | "desc";
  values?: string[];
};

export type OpenOptions = {
  cacheKey?: string;
  onProgress?: (steps: ProgressStep[]) => void;
  /** Load a sample instead of the full file. Results must be labeled as a sample. */
  sampleRows?: number;
  filter?: { column: string; value: string };
  /** Load only these columns. Used when a file is too wide to load in full. */
  columns?: string[];
};
