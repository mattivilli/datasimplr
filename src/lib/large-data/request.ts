import { z } from "zod";
import { parseNumber, type Table } from "../analysis";
import { analyzeQuality } from "../data-quality";
import { resolveColumn, runQueryOp, type QueryOp, type QueryResult } from "../dataset-query";
import { LARGE_DATA } from "./config";
import type { AnalysisFilter, AnalysisRequest } from "./types";

const agg = z.enum(["sum", "avg", "min", "max", "count", "median"]);
const filterSchema = z.object({
  column: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
});

/**
 * Accepts the public JSON shape (`operation`, `group_by`, `aggregation`) and
 * the planner's QueryOp shape (`op`, `groupBy`, `agg`).
 */
export const analysisRequestSchema = z
  .object({
    operation: z
      .enum([
        "profile",
        "quality",
        "aggregate",
        "group_by",
        "top_n",
        "bottom_n",
        "filter",
        "time_trend",
        "correlation",
        "value_counts",
        "compare",
        "missing",
        "duplicates",
        "outliers",
      ])
      .optional(),
    op: z.string().optional(),
    group_by: z.union([z.string(), z.array(z.string().max(120)).max(2)]).optional(),
    groupBy: z.array(z.string().max(120)).max(2).optional(),
    metric: z.string().max(120).optional(),
    aggregation: agg.optional(),
    agg: agg.optional(),
    filters: z.array(filterSchema).max(6).optional(),
    sort: z.enum(["asc", "desc"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    n: z.number().int().min(1).max(100).optional(),
    dateColumn: z.string().max(120).optional(),
    granularity: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
    columns: z.array(z.string().max(120)).max(8).optional(),
    by: z.string().max(120).optional(),
    column: z.string().max(120).optional(),
    values: z.array(z.string().max(120)).max(4).optional(),
    derived: z
      .object({
        name: z.string().max(120),
        left: z.string().max(120),
        op: z.enum(["mul", "add", "sub", "div"]),
        right: z.string().max(120),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.operation || value.op), { message: "An operation is required." });

type RawRequest = z.infer<typeof analysisRequestSchema>;

const OP_MAP: Record<string, AnalysisRequest["operation"]> = {
  describe: "profile",
  profile: "profile",
  quality: "quality",
  aggregate: "aggregate",
  group: "group_by",
  group_by: "group_by",
  top_n: "top_n",
  bottom_n: "bottom_n",
  filter: "filter",
  time_trend: "time_trend",
  correlation: "correlation",
  value_counts: "value_counts",
  compare: "compare",
  missing: "missing",
  duplicates: "duplicates",
  outliers: "outliers",
};

export function parseAnalysisRequest(input: unknown): AnalysisRequest {
  return normalizeRequest(analysisRequestSchema.parse(input));
}

function normalizeRequest(raw: RawRequest): AnalysisRequest {
  const operation = OP_MAP[raw.operation ?? raw.op ?? ""];
  if (!operation) throw new Error("That analysis operation is not supported.");
  const groupBy = raw.groupBy ?? (raw.group_by == null ? undefined : Array.isArray(raw.group_by) ? raw.group_by : [raw.group_by]);
  const request: AnalysisRequest = { operation };
  if (groupBy?.length) request.groupBy = groupBy;
  if (raw.metric) request.metric = raw.metric;
  const aggregation = raw.aggregation ?? raw.agg;
  if (aggregation) request.aggregation = aggregation;
  if (raw.filters?.length) request.filters = raw.filters;
  const sort = raw.sort ?? raw.order;
  if (sort) request.sort = sort;
  if (raw.order) request.order = raw.order;
  const limit = raw.limit ?? raw.n;
  if (limit) request.limit = Math.min(LARGE_DATA.queryResultRows, limit);
  if (raw.dateColumn) request.dateColumn = raw.dateColumn;
  if (raw.granularity) request.granularity = raw.granularity;
  if (raw.columns?.length) request.columns = raw.columns;
  const by = raw.by ?? raw.column;
  if (by) request.by = by;
  if (raw.values?.length) request.values = raw.values;
  if (raw.derived) request.derived = raw.derived;
  return request;
}

export function queryOpToRequest(op: QueryOp): AnalysisRequest {
  if (op.op === "describe") return { operation: "profile" };
  if (op.op === "quality") return { operation: "quality" };
  if (op.op === "aggregate") {
    return {
      operation: "aggregate",
      aggregation: op.agg,
      ...(op.metric ? { metric: op.metric } : {}),
      ...(op.filters ? { filters: op.filters } : {}),
    };
  }
  if (op.op === "group") {
    return {
      operation: "group_by",
      groupBy: [...op.groupBy],
      aggregation: op.agg,
      ...(op.metric ? { metric: op.metric } : {}),
      ...(op.sort ? { sort: op.sort } : {}),
      ...(op.limit ? { limit: op.limit } : {}),
      ...(op.filters ? { filters: op.filters } : {}),
    };
  }
  if (op.op === "top_n") {
    return {
      operation: "top_n",
      by: op.by,
      limit: op.n,
      ...(op.order ? { order: op.order, sort: op.order } : {}),
      ...(op.columns ? { columns: [...op.columns] } : {}),
      ...(op.filters ? { filters: op.filters } : {}),
    };
  }
  if (op.op === "time_trend") {
    return {
      operation: "time_trend",
      dateColumn: op.dateColumn,
      aggregation: op.agg,
      ...(op.metric ? { metric: op.metric } : {}),
      ...(op.granularity ? { granularity: op.granularity } : {}),
      ...(op.filters ? { filters: op.filters } : {}),
    };
  }
  if (op.op === "compare") {
    return {
      operation: "compare",
      by: op.column,
      values: [...op.values],
      aggregation: op.agg,
      ...(op.metric ? { metric: op.metric } : {}),
      ...(op.filters ? { filters: op.filters } : {}),
    };
  }
  if (op.op === "value_counts") {
    return {
      operation: "value_counts",
      by: op.column,
      ...(op.limit ? { limit: op.limit } : {}),
      ...(op.filters ? { filters: op.filters } : {}),
    };
  }
  return { operation: "correlation", ...(op.columns ? { columns: [...op.columns] } : {}) };
}

export async function runLargeQueryOp(sessionId: string, op: QueryOp): Promise<QueryResult> {
  const { runAnalysis } = await import("./engine");
  return runAnalysis(sessionId, queryOpToRequest(op));
}

export async function executeAnalysisRequest(args: {
  mode: "standard" | "large";
  request: AnalysisRequest;
  table?: Table;
  sessionId?: string;
}): Promise<QueryResult> {
  if (args.mode === "large") {
    if (!args.sessionId) return { op: args.request.operation, description: args.request.operation, error: "The dataset is not open." };
    const { runAnalysis } = await import("./engine");
    return runAnalysis(args.sessionId, args.request);
  }
  if (!args.table) return { op: args.request.operation, description: args.request.operation, error: "No dataset is loaded." };
  return runStandard(args.table, args.request);
}

function runStandard(source: Table, request: AnalysisRequest): QueryResult {
  const projected = projectDerived(source, request);
  const table = projected.table;
  const note = projected.note;
  const withNote = (result: QueryResult): QueryResult => (note ? { ...result, note: [result.note, note].filter(Boolean).join(" ") } : result);
  const filters = request.filters;

  if (request.operation === "profile" || request.operation === "missing") {
    return withNote(runQueryOp(table, { op: "describe" }));
  }
  if (request.operation === "quality" || request.operation === "duplicates" || request.operation === "outliers") {
    const report = analyzeQuality(table);
    const wanted =
      request.operation === "duplicates"
        ? report.issues.filter((issue) => issue.kind === "duplicate_rows" || issue.kind === "duplicate_id")
        : request.operation === "outliers"
          ? report.issues.filter((issue) => issue.kind === "outlier")
          : report.issues;
    return withNote({
      op: request.operation,
      description: request.operation === "outliers" ? "Outlier scan. An outlier is not automatically incorrect, and none were deleted." : `Data quality score ${report.score.overall}/100`,
      columns: ["issue", "kind", "severity", "rows affected"],
      rows: wanted.slice(0, 30).map((issue) => [issue.title, issue.kind, issue.severity, issue.affectedRowIndexes.length]),
    });
  }
  if (request.operation === "filter" || request.operation === "bottom_n" || request.operation === "top_n") {
    return withNote(standardRows(table, request));
  }
  if (request.operation === "aggregate") {
    return withNote(
      runQueryOp(table, {
        op: "aggregate",
        agg: request.aggregation ?? "sum",
        ...(request.metric ? { metric: request.metric } : {}),
        ...(filters ? { filters } : {}),
      }),
    );
  }
  if (request.operation === "group_by") {
    if (!request.groupBy?.length) return { op: "group_by", description: "group_by", error: "A group column is required." };
    return withNote(
      runQueryOp(table, {
        op: "group",
        groupBy: request.groupBy.slice(0, 2) as [string] | [string, string],
        agg: request.aggregation ?? "sum",
        ...(request.metric ? { metric: request.metric } : {}),
        ...(request.sort ? { sort: request.sort } : {}),
        ...(request.limit ? { limit: request.limit } : {}),
        ...(filters ? { filters } : {}),
      }),
    );
  }
  if (request.operation === "time_trend") {
    if (!request.dateColumn) return { op: "time_trend", description: "time_trend", error: "A date column is required." };
    return withNote(
      runQueryOp(table, {
        op: "time_trend",
        dateColumn: request.dateColumn,
        agg: request.aggregation ?? "sum",
        ...(request.metric ? { metric: request.metric } : {}),
        ...(request.granularity ? { granularity: request.granularity } : {}),
        ...(filters ? { filters } : {}),
      }),
    );
  }
  if (request.operation === "value_counts") {
    const column = request.by ?? request.metric ?? request.groupBy?.[0];
    if (!column) return { op: "value_counts", description: "value_counts", error: "Column was not found." };
    return withNote(runQueryOp(table, { op: "value_counts", column, ...(request.limit ? { limit: request.limit } : {}), ...(filters ? { filters } : {}) }));
  }
  if (request.operation === "compare") {
    const column = request.by ?? request.groupBy?.[0];
    if (!column || !request.values || request.values.length < 2) {
      return { op: "compare", description: "compare", error: "A column and at least two values are required." };
    }
    return withNote(
      runQueryOp(table, {
        op: "compare",
        column,
        values: request.values.slice(0, 4) as [string, string, ...string[]],
        agg: request.aggregation ?? "sum",
        ...(request.metric ? { metric: request.metric } : {}),
        ...(filters ? { filters } : {}),
      }),
    );
  }
  return withNote(runQueryOp(table, { op: "correlation", ...(request.columns ? { columns: request.columns } : {}) }));
}

function projectDerived(table: Table, request: AnalysisRequest): { table: Table; note?: string } {
  if (request.derived) {
    const left = resolveColumn(table, request.derived.left);
    const right = resolveColumn(table, request.derived.right);
    if (left < 0 || right < 0) return { table };
    const op = request.derived.op;
    const rows = table.rows.map((row) => {
      const a = parseNumber(row[left] ?? "");
      const b = parseNumber(row[right] ?? "");
      const value = op === "mul" ? a * b : op === "add" ? a + b : op === "sub" ? a - b : b === 0 ? NaN : a / b;
      return [...row, Number.isFinite(value) ? String(value) : ""];
    });
    return {
      table: { columns: [...table.columns, request.derived.name], rows },
      note: `${request.derived.name} was calculated on every loaded row.`,
    };
  }
  if (request.metric && /revenue|sales|turnover/i.test(request.metric) && resolveColumn(table, request.metric) < 0) {
    const qty = table.columns.findIndex((name) => /(quantity|^qty$)/i.test(name));
    const price = table.columns.findIndex((name) => /(unit.?price|^price$)/i.test(name));
    if (qty >= 0 && price >= 0) {
      const rows = table.rows.map((row) => {
        const value = parseNumber(row[qty] ?? "") * parseNumber(row[price] ?? "");
        return [...row, Number.isFinite(value) ? String(value) : ""];
      });
      return {
        table: { columns: [...table.columns, "Revenue"], rows },
        note: "Revenue = Quantity × UnitPrice, calculated on every loaded row.",
      };
    }
  }
  return { table };
}

function standardRows(table: Table, request: AnalysisRequest): QueryResult {
  const limit = Math.min(LARGE_DATA.queryResultRows, Math.max(1, request.limit ?? (request.operation === "filter" ? LARGE_DATA.previewPageSize : 10)));
  let indexes = table.rows.map((_, index) => index);
  if (request.filters?.length) {
    indexes = indexes.filter((index) => request.filters!.every((filter) => matches(table, index, filter)));
  }
  if (request.operation === "top_n" || request.operation === "bottom_n") {
    const by = resolveColumn(table, request.by ?? request.metric ?? "");
    if (by < 0) return { op: request.operation, description: request.operation, error: "A numeric column is required." };
    const direction = request.operation === "bottom_n" || request.order === "asc" || request.sort === "asc" ? 1 : -1;
    indexes = indexes
      .filter((index) => Number.isFinite(parseNumber(table.rows[index]?.[by] ?? "")))
      .sort((a, b) => (parseNumber(table.rows[a]?.[by] ?? "") - parseNumber(table.rows[b]?.[by] ?? "")) * direction);
  }
  const page = indexes.slice(0, limit);
  return {
    op: request.operation,
    description: request.operation === "filter" ? "Filtered rows" : `${request.operation === "bottom_n" ? "Bottom" : "Top"} ${page.length} rows`,
    columns: table.columns,
    rows: page.map((index) => table.rows[index] ?? []),
    truncated: indexes.length > page.length,
    note: `Showing ${page.length.toLocaleString()} of ${indexes.length.toLocaleString()} matching rows.`,
  };
}

function matches(table: Table, index: number, filter: AnalysisFilter): boolean {
  const column = resolveColumn(table, filter.column);
  if (column < 0) return false;
  const cell = (table.rows[index]?.[column] ?? "").trim();
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  const numeric = parseNumber(cell);
  if (filter.op === "contains") return cell.toLowerCase().includes(String(values[0] ?? "").toLowerCase());
  if (filter.op === "in" || filter.op === "eq" || filter.op === "neq") {
    const hit = values.some((value) => {
      const asNumber = typeof value === "number" ? value : parseNumber(String(value));
      if (Number.isFinite(numeric) && Number.isFinite(asNumber)) return numeric === asNumber;
      return cell.toLowerCase() === String(value).trim().toLowerCase();
    });
    return filter.op === "neq" ? !hit : hit;
  }
  const bound = typeof values[0] === "number" ? values[0] : parseNumber(String(values[0] ?? ""));
  if (!Number.isFinite(numeric) || !Number.isFinite(bound)) return false;
  if (filter.op === "gt") return numeric > bound;
  if (filter.op === "gte") return numeric >= bound;
  if (filter.op === "lt") return numeric < bound;
  return numeric <= bound;
}
