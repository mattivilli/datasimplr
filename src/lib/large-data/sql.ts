import type { AnalysisFilter, CleanAction, DerivedMetric } from "./types";
import type { Sniff } from "./sniff";

const NULL_LITERALS = [
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
];

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function blankSql(column: string): string {
  const ident = quoteIdent(column);
  const list = NULL_LITERALS.map((value) => quoteLiteral(value)).join(", ");
  return `(${ident} IS NULL OR lower(trim(coalesce(${ident}, ''))) IN (${list}))`;
}

export function numericSql(column: string): string {
  const ident = quoteIdent(column);
  const trimmed = `trim(coalesce(${ident}, ''))`;
  const cleaned = `regexp_replace(replace(replace(${trimmed}, ',', ''), '%', ''), '^[€$£₹¥₩]', '')`;
  return `try_cast(${cleaned} AS DOUBLE)`;
}

export type DateKind = "mdy_hm" | "mdy_hms" | "dmy_hm" | "iso" | "cast" | "none";

/** Pad single-digit month, day and hour so %m/%d/%H match dates like 12/1/2010 8:26. */
function padDateTokens(valueSql: string): string {
  return `regexp_replace(regexp_replace(regexp_replace(${valueSql}, '^(\\d)/', '0\\1/'), '/(\\d)/', '/0\\1/'), ' (\\d):', ' 0\\1:')`;
}

export function dateExpr(valueSql: string, kind: DateKind): string {
  const padded = padDateTokens(valueSql);
  if (kind === "mdy_hm") {
    return `COALESCE(try_strptime(${valueSql}, '%m/%d/%Y %H:%M'), try_strptime(${padded}, '%m/%d/%Y %H:%M'))`;
  }
  if (kind === "mdy_hms") {
    return `COALESCE(try_strptime(${valueSql}, '%m/%d/%Y %H:%M:%S'), try_strptime(${padded}, '%m/%d/%Y %H:%M:%S'))`;
  }
  if (kind === "dmy_hm") {
    return `COALESCE(try_strptime(${valueSql}, '%d/%m/%Y %H:%M'), try_strptime(${padded}, '%d/%m/%Y %H:%M'))`;
  }
  if (kind === "iso") return `COALESCE(try_strptime(${valueSql}, '%Y-%m-%d %H:%M:%S'), try_strptime(${valueSql}, '%Y-%m-%d'))`;
  if (kind === "cast") return `try_cast(${valueSql} AS TIMESTAMP)`;
  return "NULL";
}

export function dateSql(column: string, kind: DateKind): string {
  return dateExpr(`trim(coalesce(${quoteIdent(column)}, ''))`, kind);
}

/** Broad detector used on the first profile scan, before a format is chosen. */
export function dateProbeSql(column: string): string {
  const trimmed = `trim(coalesce(${quoteIdent(column)}, ''))`;
  // One pattern match per cell. The exact format is chosen later from a sample.
  // Seven strptime calls here did not finish on the 541,909-row retail file.
  return `(
    length(${trimmed}) > 4
    AND try_cast(${trimmed} AS DOUBLE) IS NULL
    AND regexp_matches(${trimmed}, '^\\d{1,4}[/-]\\d{1,2}[/-]\\d{1,4}([ T]\\d{1,2}:\\d{2}(:\\d{2})?)?$')
  )`;
}

export function resolveName(columns: string[], name: string): string | null {
  const exact = columns.find((column) => column === name);
  if (exact) return exact;
  const lower = columns.find((column) => column.toLowerCase() === name.toLowerCase());
  if (lower) return lower;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(name);
  const normalized = columns.find((column) => norm(column) === target);
  if (normalized) return normalized;
  const partial = columns.filter((column) => target && (norm(column).includes(target) || target.includes(norm(column))));
  return partial.length === 1 ? (partial[0] ?? null) : null;
}

export function readCsvSql(fileName: string, sniff: Sniff, ignoreErrors = false, encoding?: string): string {
  const delim = sniff.delimiter === "\t" ? "E'\\t'" : quoteLiteral(sniff.delimiter);
  const encodingSql = encoding ? `\n    encoding = ${quoteLiteral(encoding)},` : "";
  return `read_csv(${quoteLiteral(fileName)},
    header = true,
    all_varchar = true,
    delim = ${delim},
    skip = ${Math.max(0, sniff.skipRows)},
    quote = '"',
    escape = '"',
    null_padding = true,
    strict_mode = false,
    ignore_errors = ${ignoreErrors ? "true" : "false"},${encodingSql}
    max_line_size = 10485760
  )`;
}

export function structuralDropSql(columns: string[]): string {
  if (!columns.length) return "FALSE";
  const blanks = columns.map((column) => blankSql(column));
  const allBlank = blanks.join(" AND ");
  const repeated = columns.map((column) => `trim(coalesce(${quoteIdent(column)}, '')) = ${quoteLiteral(column)}`).join(" AND ");
  const footerCell = columns
    .map((column) => `lower(trim(coalesce(${quoteIdent(column)}, ''))) IN ('total', 'subtotal', 'grand total', 'totals')`)
    .join(" OR ");
  const blankCount = blanks.map((expr) => `CASE WHEN ${expr} THEN 1 ELSE 0 END`).join(" + ");
  const mostlyBlank = `(${blankCount}) >= ${Math.max(1, columns.length - 2)}`;
  return `(${allBlank}) OR (${repeated}) OR ((${footerCell}) AND ${mostlyBlank})`;
}

export function metricSql(
  columns: string[],
  metric: string | undefined,
  derived: DerivedMetric | undefined,
  dateKinds: Map<string, DateKind>,
): { sql: string; label: string; note?: string } | { error: string } {
  if (derived) {
    const left = resolveName(columns, derived.left);
    const right = resolveName(columns, derived.right);
    if (!left || !right) return { error: `Column "${!left ? derived.left : derived.right}" was not found.` };
    const op = { mul: "*", add: "+", sub: "-", div: "/" }[derived.op];
    return {
      sql: `(${numericSql(left)} ${op} ${numericSql(right)})`,
      label: derived.name || `${left} ${op} ${right}`,
      note: `${derived.name || "Derived"} = ${left} ${op === "*" ? "×" : op} ${right}, calculated on every loaded row.`,
    };
  }
  if (metric) {
    const column = resolveName(columns, metric);
    if (column) {
      const kind = dateKinds.get(column);
      if (kind && kind !== "none") return { sql: `epoch(${dateSql(column, kind)})`, label: column };
      return { sql: numericSql(column), label: column };
    }
    const revenue = resolveRevenue(columns, metric);
    if (revenue) return revenue;
    return { error: `Column "${metric}" was not found.` };
  }
  return { error: "A metric column is required." };
}

export function resolveRevenue(columns: string[], metric: string): { sql: string; label: string; note: string } | null {
  if (!/revenue|sales|turnover/i.test(metric)) return null;
  const qty = columns.find((column) => /(quantity|^qty$)/i.test(column));
  const price = columns.find((column) => /(unit.?price|^price$)/i.test(column));
  if (!qty || !price) return null;
  return {
    sql: `(${numericSql(qty)} * ${numericSql(price)})`,
    label: "Revenue",
    note: `Revenue = ${qty} × ${price}, calculated on every loaded row.`,
  };
}

export function filterSql(columns: string[], filters: AnalysisFilter[] | undefined): { sql: string; error?: string } {
  if (!filters?.length) return { sql: "TRUE" };
  const parts: string[] = [];
  for (const filter of filters) {
    const column = resolveName(columns, filter.column);
    if (!column) return { sql: "FALSE", error: `Filter column "${filter.column}" was not found.` };
    const ident = quoteIdent(column);
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const textOf = (value: string | number) => `lower(trim(coalesce(${ident}, ''))) = lower(${quoteLiteral(String(value).trim())})`;
    const numOf = (value: string | number, op: string) => `${numericSql(column)} ${op} ${Number(value)}`;
    if (filter.op === "contains") {
      const raw = String(values[0] ?? "");
      const escaped = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      parts.push(`lower(coalesce(${ident}, '')) LIKE ${quoteLiteral(`%${escaped.toLowerCase()}%`)} ESCAPE '\\'`);
    } else if (filter.op === "in") {
      parts.push(`(${values.map((value) => textOf(value)).join(" OR ")})`);
    } else if (filter.op === "eq") {
      const value = values[0];
      const numeric = typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
      parts.push(numeric && typeof value !== "undefined" ? `(${numOf(value, "=")} OR ${textOf(value)})` : textOf(value ?? ""));
    } else if (filter.op === "neq") {
      parts.push(values.map((value) => `NOT (${textOf(value)})`).join(" AND "));
    } else {
      const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.op];
      const value = values[0];
      if (!op || value == null || !Number.isFinite(Number(value))) {
        return { sql: "FALSE", error: `Filter on "${filter.column}" needs a number.` };
      }
      parts.push(numOf(value, op));
    }
  }
  return { sql: parts.join(" AND ") };
}

export function cleanSelectList(columns: string[], action: CleanAction, table: string): string {
  return columns
    .map((column) => {
      const ident = quoteIdent(column);
      if (action.type === "trim" && action.column === column) {
        return `CASE WHEN ${ident} IS NOT NULL AND ${ident} <> trim(${ident}) THEN trim(${ident}) ELSE ${ident} END AS ${ident}`;
      }
      if (action.type === "categories" && action.column === column) {
        const arms = Object.entries(action.mapping)
          .slice(0, 50)
          .map(([from, to]) => `WHEN ${quoteLiteral(from)} THEN ${quoteLiteral(to)}`)
          .join(" ");
        return arms ? `CASE ${ident} ${arms} ELSE ${ident} END AS ${ident}` : `${ident}`;
      }
      if (action.type === "fill_missing" && action.column === column) {
        const fill =
          action.strategy === "median"
            ? `(SELECT cast(median(${numericSql(column)}) AS VARCHAR) FROM ${table})`
            : action.strategy === "mean"
              ? `(SELECT cast(avg(${numericSql(column)}) AS VARCHAR) FROM ${table})`
              : `(SELECT ${ident} FROM ${table} WHERE NOT ${blankSql(column)} GROUP BY 1 ORDER BY count(*) DESC LIMIT 1)`;
        return `CASE WHEN ${blankSql(column)} THEN ${fill} ELSE ${ident} END AS ${ident}`;
      }
      return ident;
    })
    .join(", ");
}

export function bucketSql(column: string, kind: DateKind, granularity: "day" | "week" | "month" | "quarter" | "year"): string {
  const stamp = dateSql(column, kind);
  if (granularity === "year") return `strftime(${stamp}, '%Y')`;
  if (granularity === "quarter") return `strftime(${stamp}, '%Y') || '-Q' || cast(quarter(${stamp}) AS VARCHAR)`;
  if (granularity === "month") return `strftime(${stamp}, '%Y-%m')`;
  if (granularity === "day") return `strftime(${stamp}, '%Y-%m-%d')`;
  return `strftime(date_trunc('week', ${stamp}), '%Y-%m-%d')`;
}
