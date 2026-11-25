import type { QueryResult } from "../dataset-query";
import { chooseEstimatedMode, chooseProcessingMode, LARGE_DATA, workingCopyMessage } from "./config";
import { DatasetTooLargeError, unsupportedMessage, UseStandardPath } from "./decide";
import { FILE_READER, resetDb, withDb, type DuckContext } from "./duckdb-client";
import { splitNote, splitPlan } from "./split";
import { estimateDataRows, sniffTabularText } from "./sniff";
import {
  blankSql,
  bucketSql,
  cleanSelectList,
  dateExpr,
  dateProbeSql,
  dateSql,
  filterSql,
  metricSql,
  numericSql,
  quoteIdent,
  quoteLiteral,
  readCsvSql,
  resolveName,
  resolveRevenue,
  structuralDropSql,
  type DateKind,
} from "./sql";
import type {
  AnalysisRequest,
  CleanAction,
  ColumnKind,
  ColumnSummary,
  IssueSample,
  LargeIssue,
  LargeQuality,
  LargeSessionInfo,
  OpenOptions,
  PreviewPage,
  ProgressStep,
} from "./types";

type InternalCol = {
  name: string;
  type: ColumnKind;
  missing: number;
  distinct: number;
  filled: number;
  nums: number;
  dates: number;
  bools: number;
  whitespace: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  std: number | null;
  skew: number | null;
  q1: number | null;
  q3: number | null;
  dmin: string | null;
  dmax: string | null;
  samples: string[];
  topValues?: { value: string; count: number }[];
  dateKind: DateKind;
};

type Session = {
  id: string;
  key: string;
  table: string;
  fileName: string;
  bytes: number;
  rowCount: number;
  columns: InternalCol[];
  structuralNotes: string[];
  excludedRows: number;
  sampled: LargeSessionInfo["sampled"];
  filtered: LargeSessionInfo["filtered"];
  timings: { loadMs: number; profileMs: number; qualityMs?: number };
  quality: LargeQuality | null;
  sampleCsv: string | null;
  /** A view over the file. The full table is not stored. */
  virtual: boolean;
  fileToken: string | null;
  parts: LargeSessionInfo["parts"];
};

const sessions = new Map<string, Session>();
const keyIndex = new Map<string, string>();

type ArrowTable = {
  schema: { fields: Array<{ name: string }> };
  numRows: number;
  toArray: () => Array<{ toJSON?: () => Record<string, unknown> } & Record<string, unknown>>;
};

function scalar(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "toJSON" in value && typeof (value as { toJSON: () => unknown }).toJSON === "function") {
    const json = (value as { toJSON: () => unknown }).toJSON();
    if (json !== value) return scalar(json);
  }
  return value;
}

function num(value: unknown): number {
  const next = scalar(value);
  if (typeof next === "number" && Number.isFinite(next)) return next;
  if (typeof next === "string" && next.trim() !== "" && Number.isFinite(Number(next))) return Number(next);
  return NaN;
}

function text(value: unknown): string {
  if (value == null) return "";
  const next = scalar(value);
  return next == null ? "" : String(next);
}

function records(table: ArrowTable): Record<string, unknown>[] {
  const names = table.schema.fields.map((field) => field.name);
  const rows = table.toArray();
  return Array.from(rows).map((row) => {
    const source = typeof row.toJSON === "function" ? row.toJSON() : row;
    const record: Record<string, unknown> = {};
    for (const name of names) record[name] = scalar(source[name]);
    return record;
  });
}

async function sql(ctx: DuckContext, statement: string): Promise<Record<string, unknown>[]> {
  const table = (await ctx.conn.query(statement)) as unknown as ArrowTable;
  return records(table);
}

function firstNum(rows: Record<string, unknown>[], key: string): number {
  return num(rows[0]?.[key]);
}

async function paint(onProgress: OpenOptions["onProgress"], steps: ProgressStep[]) {
  onProgress?.(steps.map((step) => ({ ...step })));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^(Invalid Error|Catalog Error|Parser Error|Conversion Error):\s*/i, "").slice(0, 500);
}

function snapshot(session: Session): LargeSessionInfo {
  return {
    id: session.id,
    fileName: session.fileName,
    bytes: session.bytes,
    rowCount: session.rowCount,
    columnCount: session.columns.length,
    columns: session.columns.map(toSummary),
    structuralNotes: session.structuralNotes,
    excludedRows: session.excludedRows,
    sampled: session.sampled,
    filtered: session.filtered,
    timings: { ...session.timings },
    parts: session.parts
      ? {
          stem: session.parts.stem,
          partRows: session.parts.partRows,
          names: [...session.parts.names],
          rows: [...session.parts.rows],
          note: session.parts.note,
        }
      : null,
  };
}

function toSummary(column: InternalCol): ColumnSummary {
  const summary: ColumnSummary = {
    name: column.name,
    type: column.type,
    missing: column.missing,
    missingPct: column.filled + column.missing > 0 ? (column.missing / (column.filled + column.missing)) * 100 : 0,
    distinct: column.distinct,
    samples: column.samples,
  };
  if (column.type === "numeric" && column.mean != null && column.min != null && column.max != null) {
    summary.numeric = {
      n: column.nums,
      min: column.min,
      max: column.max,
      mean: column.mean,
      median: column.median ?? column.mean,
      std: column.std ?? 0,
      skew: column.skew ?? 0,
    };
  }
  if (column.type === "date" && column.dmin && column.dmax) summary.dateRange = { min: column.dmin, max: column.dmax };
  if (column.topValues) summary.topValues = column.topValues;
  return summary;
}

function blankColumns(names: string[]): InternalCol[] {
  return names.map((name) => ({
    name,
    type: "unknown" as ColumnKind,
    missing: 0,
    distinct: 0,
    filled: 0,
    nums: 0,
    dates: 0,
    bools: 0,
    whitespace: 0,
    min: null,
    max: null,
    mean: null,
    median: null,
    std: null,
    skew: null,
    q1: null,
    q3: null,
    dmin: null,
    dmax: null,
    samples: [],
    dateKind: "none" as DateKind,
  }));
}

function requireSession(id: string): Session {
  const session = sessions.get(id);
  if (!session) throw new Error("This dataset is no longer open. Reload it and try again.");
  return session;
}

export function getSessionInfo(id: string): LargeSessionInfo {
  return snapshot(requireSession(id));
}

function uniqueName(raw: string, used: Set<string>): string {
  const base = raw.replace(/^\uFEFF/, "").trim() || "column";
  let name = base;
  let n = 2;
  while (used.has(name)) {
    name = `${base}_${n}`;
    n += 1;
  }
  used.add(name);
  return name;
}

async function describedNames(ctx: DuckContext, relation: string): Promise<string[]> {
  const rows = await sql(ctx, `DESCRIBE ${relation}`);
  return rows
    .map((row) => text(row["column_name"] ?? row["name"]))
    .filter((name) => name.length > 0);
}

function columnList(names: string[]): string {
  return names.map((name) => quoteIdent(name)).join(", ");
}

async function profileSession(ctx: DuckContext, session: Session) {
  const started = performance.now();
  const names = session.columns.map((column) => column.name);
  if (!names.length) return;
  const metrics = names
    .map((name, index) => {
      const ident = quoteIdent(name);
      return [
        `count(*) FILTER (WHERE ${blankSql(name)})::DOUBLE AS c${index}_missing`,
        `count(*) FILTER (WHERE NOT ${blankSql(name)} AND ${numericSql(name)} IS NOT NULL)::DOUBLE AS c${index}_nums`,
        `count(*) FILTER (WHERE NOT ${blankSql(name)} AND ${dateProbeSql(name)})::DOUBLE AS c${index}_dates`,
        `count(*) FILTER (WHERE lower(trim(coalesce(${ident}, ''))) IN ('true','false','yes','no','y','n'))::DOUBLE AS c${index}_bools`,
        `count(DISTINCT ${ident}) FILTER (WHERE NOT ${blankSql(name)})::DOUBLE AS c${index}_distinct`,
        `min(${numericSql(name)}) AS c${index}_min`,
        `max(${numericSql(name)}) AS c${index}_max`,
        `avg(${numericSql(name)}) AS c${index}_avg`,
        `stddev_samp(${numericSql(name)}) AS c${index}_std`,
        `count(*) FILTER (WHERE ${ident} IS NOT NULL AND trim(${ident}) <> '' AND ${ident} <> trim(${ident}))::DOUBLE AS c${index}_ws`,
      ].join(", ");
    })
    .join(", ");
  const rows = await sql(ctx, `SELECT count(*)::DOUBLE AS n, ${metrics} FROM ${session.table}`);
  const row = rows[0] ?? {};
  session.rowCount = Math.round(num(row["n"]) || session.rowCount);
  session.columns = names.map((name, index) => {
    const missing = Math.round(num(row[`c${index}_missing`]) || 0);
    const nums = Math.round(num(row[`c${index}_nums`]) || 0);
    const dates = Math.round(num(row[`c${index}_dates`]) || 0);
    const bools = Math.round(num(row[`c${index}_bools`]) || 0);
    const distinct = Math.round(num(row[`c${index}_distinct`]) || 0);
    const filled = Math.max(0, session.rowCount - missing);
    let type: ColumnKind = "text";
    if (!filled) type = "unknown";
    else if (nums / filled >= 0.9) type = "numeric";
    else if (dates / filled >= 0.8) type = "date";
    else if (bools / filled >= 0.9) type = "boolean";
    const finite = (key: string) => {
      const value = num(row[key]);
      return Number.isFinite(value) ? value : null;
    };
    return {
      name,
      type,
      missing,
      distinct,
      filled,
      nums,
      dates,
      bools,
      whitespace: Math.round(num(row[`c${index}_ws`]) || 0),
      min: finite(`c${index}_min`),
      max: finite(`c${index}_max`),
      mean: finite(`c${index}_avg`),
      std: finite(`c${index}_std`),
      median: null,
      skew: null,
      q1: null,
      q3: null,
      dmin: null,
      dmax: null,
      samples: [],
      dateKind: "none" as DateKind,
    };
  });
  const numeric = session.columns.filter((column) => column.type === "numeric");
  // Median and quartiles sort the column. Skip them on a split file so that pass stays a running total.
  if (numeric.length && !session.virtual) {
    const extra = numeric
      .map((column, index) => {
        const expr = numericSql(column.name);
        return `median(${expr}) AS med_${index}, skewness(${expr}) AS skew_${index}, quantile_cont(${expr}, 0.25) AS q1_${index}, quantile_cont(${expr}, 0.75) AS q3_${index}`;
      })
      .join(", ");
    const stats = (await sql(ctx, `SELECT ${extra} FROM ${session.table}`))[0] ?? {};
    numeric.forEach((column, index) => {
      const finite = (key: string) => {
        const value = num(stats[key]);
        return Number.isFinite(value) ? value : null;
      };
      column.median = finite(`med_${index}`);
      column.skew = finite(`skew_${index}`);
      column.q1 = finite(`q1_${index}`);
      column.q3 = finite(`q3_${index}`);
    });
  }
  await fillSamples(ctx, session);
  await chooseDateKinds(ctx, session);
  await fillTopValues(ctx, session);
  session.timings.profileMs = Math.round(performance.now() - started);
  session.quality = null;
  session.sampleCsv = null;
}

async function fillSamples(ctx: DuckContext, session: Session) {
  const order = session.virtual ? "" : ` ORDER BY "_ds_row"`;
  const preview = await sql(
    ctx,
    `SELECT ${columnList(session.columns.map((column) => column.name))} FROM ${session.table}${order} LIMIT 30`,
  );
  for (const column of session.columns) {
    const seen: string[] = [];
    for (const row of preview) {
      const value = text(row[column.name]).trim();
      if (!value || seen.includes(value)) continue;
      seen.push(value.slice(0, 40));
      if (seen.length >= 4) break;
    }
    column.samples = seen;
  }
}

const DATE_KINDS: DateKind[] = ["mdy_hm", "mdy_hms", "dmy_hm", "iso", "cast"];

async function chooseDateKinds(ctx: DuckContext, session: Session) {
  const dated = session.columns.filter((column) => column.type === "date" && column.samples[0]);
  if (!dated.length) return;
  const probes = dated
    .map((column, index) => {
      const sample = quoteLiteral(column.samples[0] ?? "");
      return DATE_KINDS.map((kind) => `${dateExpr(sample, kind)} IS NOT NULL AS d${index}_${kind}`).join(", ");
    })
    .join(", ");
  const rows = await sql(ctx, `SELECT ${probes}`);
  const row = rows[0] ?? {};
  for (let index = 0; index < dated.length; index++) {
    const column = dated[index];
    if (!column) continue;
    const kind =
      DATE_KINDS.find((candidate) => {
        const flag = row[`d${index}_${candidate}`];
        return flag === true || flag === 1 || num(flag) === 1;
      }) ?? "none";
    column.dateKind = kind;
  }
  const usable = session.columns.filter((column) => column.dateKind !== "none");
  if (!usable.length) return;
  const range = usable
    .map((column) => `min(${dateSql(column.name, column.dateKind)}) AS min_${safeAlias(column.name)}, max(${dateSql(column.name, column.dateKind)}) AS max_${safeAlias(column.name)}`)
    .join(", ");
  const ranges = await sql(ctx, `SELECT ${range} FROM ${session.table}`);
  const values = ranges[0] ?? {};
  for (const column of usable) {
    column.dmin = text(values[`min_${safeAlias(column.name)}`]) || null;
    column.dmax = text(values[`max_${safeAlias(column.name)}`]) || null;
  }
}

function safeAlias(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40) || "c";
}

async function fillTopValues(ctx: DuckContext, session: Session) {
  const cats = session.columns
    .filter((column) => column.type === "text" && column.distinct > 0 && column.distinct <= LARGE_DATA.categoryCardinalityCap)
    .slice(0, 8);
  if (!cats.length) return;
  const query = cats
    .map(
      (column) => `SELECT * FROM (SELECT ${quoteLiteral(column.name)} AS col, ${quoteIdent(column.name)} AS v, count(*)::DOUBLE AS n
        FROM ${session.table} WHERE NOT ${blankSql(column.name)}
        GROUP BY 2 ORDER BY n DESC LIMIT 8)`,
    )
    .join(" UNION ALL ");
  const rows = await sql(ctx, query);
  for (const column of cats) {
    column.topValues = rows
      .filter((row) => text(row["col"]) === column.name)
      .map((row) => ({ value: text(row["v"]), count: Math.round(num(row["n"]) || 0) }));
  }
}

async function dropTable(ctx: DuckContext, table: string) {
  await ctx.conn.query(`DROP TABLE IF EXISTS ${table}`);
}

export async function closeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (keyIndex.get(session.key) === id) keyIndex.delete(session.key);
  await withDb(async (ctx) => {
    if (session.virtual) {
      await ctx.conn.query(`DROP VIEW IF EXISTS ${session.table}`);
      if (session.fileToken) {
        try {
          await ctx.db.dropFile(session.fileToken);
        } catch {
          /* the handle may already be gone */
        }
      }
      return;
    }
    await dropTable(ctx, session.table);
  });
}

// A single 0xA3 pound sign is valid Latin-1 and invalid UTF-8. Scan the bytes
// so a Windows CSV is not rejected on the first currency character.
async function fileHasInvalidUtf8(file: File): Promise<boolean> {
  if (typeof file.stream !== "function") return false;
  const reader = file.stream().getReader();
  let need = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done || !step.value) return need !== 0;
      const bytes = step.value;
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i] ?? 0;
        if (need > 0) {
          if ((b & 0xc0) !== 0x80) return true;
          need -= 1;
          continue;
        }
        if (b < 0x80) continue;
        if ((b & 0xe0) === 0xc0) {
          if (b < 0xc2) return true;
          need = 1;
        } else if ((b & 0xf0) === 0xe0) {
          need = 2;
        } else if ((b & 0xf8) === 0xf0) {
          if (b > 0xf4) return true;
          need = 3;
        } else {
          return true;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function openLargeFile(file: File, options: OpenOptions = {}): Promise<LargeSessionInfo> {
  if (file.size > LARGE_DATA.sampleMaxBytes) {
    throw new DatasetTooLargeError(unsupportedMessage(null), null, file.size);
  }
  const key = options.cacheKey ?? `${file.name}|${file.size}|${file.lastModified}|${options.sampleRows ?? ""}|${options.filter?.column ?? ""}=${options.filter?.value ?? ""}|${options.columns?.join("\u0001") ?? ""}`;
  const cached = keyIndex.get(key);
  if (cached && sessions.has(cached)) return snapshot(sessions.get(cached)!);

  const sniff = await sniffTabularText(file);
  const latin1 = await fileHasInvalidUtf8(file);
  const report = options.onProgress;
  const state = {
    rows: options.sampleRows ? `Sample of ${options.sampleRows.toLocaleString()} rows` : "Counting rows",
    columns: sniff.header.length ? `${sniff.header.length} columns detected` : "Detecting columns",
    received: "done" as ProgressStep["state"],
    rowState: "active" as ProgressStep["state"],
    colState: "pending" as ProgressStep["state"],
    schema: "pending" as ProgressStep["state"],
    build: "pending" as ProgressStep["state"],
    buildLabel: "Building analysis structures...",
  };
  const view = (): ProgressStep[] => [
    { id: "received", label: "File received", state: state.received },
    { id: "rows", label: state.rows, state: state.rowState },
    { id: "columns", label: state.columns, state: state.colState },
    { id: "schema", label: "Schema identified", state: state.schema },
    { id: "structures", label: state.buildLabel, state: state.build },
  ];
  await paint(report, view());

  let likelySplit = false;
  if (!options.sampleRows && !options.filter) {
    const estimate = await estimateDataRows(file, sniff);
    const columnCount = options.columns?.length ? options.columns.length : sniff.header.length;
    const decision = chooseEstimatedMode({ rows: estimate, bytes: file.size, columns: columnCount });
    if (decision === "standard" && !options.columns) throw new UseStandardPath();
    const canSplit = file.size <= LARGE_DATA.sampleMaxBytes && (estimate <= 0 || estimate > LARGE_DATA.splitAtRows);
    if (decision === "unsupported" && !canSplit) throw new DatasetTooLargeError(unsupportedMessage(estimate, columnCount), estimate, file.size);
    likelySplit = decision === "unsupported" || estimate > LARGE_DATA.splitAtRows * 0.85;
    state.rows = estimate ? `About ${estimate.toLocaleString()} rows` : "Counting rows";
  }
  state.rowState = "done";
  state.colState = "done";
  state.schema = "active";
  await paint(report, view());

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const table = `t_${id}`;
  const fileToken = `f_${id}.csv`;
  const started = performance.now();
  const notes = [...sniff.notes];
  if (latin1) {
    notes.push("This file is not UTF-8. It was read as Latin-1 so currency signs stay in the text. The original file was not modified.");
  }

  let session: Session;
  try {
    session = await withDb(async (ctx) => {
    await ctx.db.registerFileHandle(fileToken, file, FILE_READER, true);
    let source = latin1 ? readCsvSql(fileToken, sniff, false, "latin-1") : readCsvSql(fileToken, sniff, false);
    let rawNames: string[] = [];
    try {
      rawNames = await describedNames(ctx, `SELECT * FROM ${source}`);
    } catch {
      source = latin1 ? readCsvSql(fileToken, sniff, true, "latin-1") : readCsvSql(fileToken, sniff, true);
      notes.push("Some malformed rows could not be read and were skipped. The original file is unchanged.");
      rawNames = await describedNames(ctx, `SELECT * FROM ${source}`);
    }
    rawNames = rawNames.filter((name) => name !== "_ds_row");
    if (!rawNames.length) throw new Error("That file has no columns.");
    const used = new Set<string>(["_ds_row"]);
    const allCleanNames = rawNames.map((name) => uniqueName(name, used));
    const wanted = options.columns?.length
      ? new Set(options.columns.map((name) => resolveName(rawNames, name)).filter((name): name is string => name != null))
      : null;
    const keep = rawNames.map((_, index) => index).filter((index) => !wanted || wanted.has(rawNames[index] ?? ""));
    if (!keep.length) throw new Error("None of the selected columns were found in that file.");
    const cleanNames = keep.map((index) => allCleanNames[index] ?? rawNames[index] ?? "");
    const projected = keep
      .map((index) => `${quoteIdent(rawNames[index] ?? "")} AS ${quoteIdent(allCleanNames[index] ?? rawNames[index] ?? "")}`)
      .join(", ");
    if (wanted && keep.length < rawNames.length) {
      notes.push(`Using ${keep.length.toLocaleString()} of ${rawNames.length.toLocaleString()} columns you selected. The original file is not changed.`);
    }
    const drop = structuralDropSql(rawNames);
    let excludedRows = 0;
    let precounted: number | null = null;
    if (!options.sampleRows && likelySplit) {
      const rawCount = await sql(
        ctx,
        `SELECT count(*) FILTER (WHERE NOT (${drop}))::DOUBLE AS kept, count(*) FILTER (WHERE ${drop})::DOUBLE AS dropped FROM ${source}`,
      );
      excludedRows = Math.round(firstNum(rawCount, "dropped") || 0);
      precounted = Math.round(firstNum(rawCount, "kept") || 0);
    } else if (!options.sampleRows) {
      const rawCount = await sql(ctx, `SELECT count(*) FILTER (WHERE ${drop})::DOUBLE AS dropped FROM ${source}`);
      excludedRows = Math.round(firstNum(rawCount, "dropped") || 0);
    }
    if (excludedRows > 0) {
      notes.push(
        `${excludedRows.toLocaleString()} blank, repeated-header, or total rows were left out of analysis. The original file was not modified.`,
      );
    }
    const where = [`NOT (${drop})`];
    if (options.filter) {
      const column = resolveName(rawNames, options.filter.column);
      if (!column) throw new Error(`Column "${options.filter.column}" was not found.`);
      where.push(`lower(trim(coalesce(${quoteIdent(column)}, ''))) = lower(${quoteLiteral(options.filter.value)})`);
    }
    const whereSql = where.join(" AND ");
    const releaseFile = async () => {
      try {
        await ctx.db.dropFile(fileToken);
      } catch {
        /* the handle may already be gone */
      }
    };
    if (precounted != null) {
      if (!options.filter && !options.columns && chooseProcessingMode({ rows: precounted, bytes: file.size, columns: cleanNames.length }) === "standard") {
        await releaseFile();
        throw new UseStandardPath();
      }
      if (precounted > LARGE_DATA.splitAtRows) {
        const plan = splitPlan(file.name, precounted, LARGE_DATA.splitAtRows);
        const note = splitNote(plan.names);
        notes.push(note);
        state.rows = `${precounted.toLocaleString()} rows detected`;
        state.columns = `${cleanNames.length} columns detected`;
        state.schema = "done";
        state.build = "active";
        state.buildLabel =
          plan.names.length <= 1
            ? `Preparing ${plan.names[0] ?? plan.stem}`
            : `Combining ${plan.names[0]} through ${plan.names[plan.names.length - 1]}`;
        await paint(report, view());
        try {
          await ctx.conn.query(`CREATE VIEW ${table} AS SELECT ${projected} FROM ${source} WHERE ${whereSql}`);
          const created: Session = {
            id,
            key,
            table,
            fileName: file.name,
            bytes: file.size,
            rowCount: precounted,
            columns: blankColumns(cleanNames),
            structuralNotes: notes,
            excludedRows,
            sampled: null,
            filtered: null,
            timings: { loadMs: 0, profileMs: 0 },
            quality: null,
            sampleCsv: null,
            virtual: true,
            fileToken,
            parts: { stem: plan.stem, partRows: LARGE_DATA.splitAtRows, names: plan.names, rows: plan.rows, note },
          };
          state.buildLabel =
            plan.names.length <= 1
              ? `Profiling ${plan.names[0] ?? plan.stem}`
              : `Profiling ${plan.names[0]} through ${plan.names[plan.names.length - 1]}`;
          await paint(report, view());
          await profileSession(ctx, created);
          const finalPlan = splitPlan(file.name, created.rowCount, LARGE_DATA.splitAtRows);
          const finalNote = splitNote(finalPlan.names);
          created.parts = {
            stem: finalPlan.stem,
            partRows: LARGE_DATA.splitAtRows,
            names: finalPlan.names,
            rows: finalPlan.rows,
            note: finalNote,
          };
          created.structuralNotes = created.structuralNotes.map((item) => (item === note ? finalNote : item));
          created.timings.loadMs = Math.round(performance.now() - started);
          return created;
        } catch (error) {
          try {
            await ctx.conn.query(`DROP VIEW IF EXISTS ${table}`);
          } catch {
            /* the view was not created */
          }
          await releaseFile();
          throw error;
        }
      }
      if (precounted > LARGE_DATA.supportedMaxRows) {
        await releaseFile();
        throw new DatasetTooLargeError(unsupportedMessage(precounted, cleanNames.length), precounted, file.size);
      }
    }
    state.schema = "done";
    state.build = "active";
    state.buildLabel = "Building analysis structures...";
    state.columns = `${cleanNames.length} columns detected`;
    await paint(report, view());

    const createFull = `CREATE TABLE ${table} AS
      SELECT row_number() OVER () AS "_ds_row", ${projected}
      FROM ${source}
      WHERE ${whereSql}`;
    const createSample = (method: "sample" | "limit") =>
      method === "sample"
        ? `CREATE TABLE ${table} AS
            SELECT row_number() OVER () AS "_ds_row", ${projected}
            FROM (SELECT * FROM ${source} WHERE ${whereSql}) USING SAMPLE ${Math.max(1, options.sampleRows ?? 0)} ROWS`
        : `CREATE TABLE ${table} AS
            SELECT row_number() OVER () AS "_ds_row", ${projected}
            FROM ${source}
            WHERE ${whereSql}
            LIMIT ${Math.max(1, options.sampleRows ?? 0)}`;

    let sampled: Session["sampled"] = null;
    if (options.sampleRows) {
      try {
        await ctx.conn.query(createSample("sample"));
        sampled = {
          rows: options.sampleRows,
          method: "random",
          label: `Random sample of ${options.sampleRows.toLocaleString()} rows. These figures are sample-based, not full-dataset results.`,
        };
      } catch {
        await dropTable(ctx, table);
        await ctx.conn.query(createSample("limit"));
        sampled = {
          rows: options.sampleRows,
          method: "first",
          label: `First ${options.sampleRows.toLocaleString()} rows of the file. These figures are not a full-dataset result and are not a random sample.`,
        };
      }
    } else {
      await ctx.conn.query(createFull);
    }

    const countRows = await sql(ctx, `SELECT count(*)::DOUBLE AS n FROM ${table}`);
    const rowCount = Math.round(firstNum(countRows, "n") || 0);
    state.rows = `${rowCount.toLocaleString()} rows detected`;
    await paint(report, view());
    if (!options.sampleRows && rowCount > LARGE_DATA.supportedMaxRows) {
      await dropTable(ctx, table);
      try {
        await ctx.db.dropFile(fileToken);
      } catch {
        /* the handle may already be gone */
      }
      throw new DatasetTooLargeError(unsupportedMessage(rowCount, cleanNames.length), rowCount, file.size);
    }
    if (!options.sampleRows && !options.filter && !options.columns && chooseProcessingMode({ rows: rowCount, bytes: file.size, columns: cleanNames.length }) === "standard") {
      await dropTable(ctx, table);
      try {
        await ctx.db.dropFile(fileToken);
      } catch {
        /* the handle may already be gone */
      }
      throw new UseStandardPath();
    }
    try {
      await ctx.db.dropFile(fileToken);
    } catch {
      /* the table already holds the rows */
    }
    const created: Session = {
      id,
      key,
      table,
      fileName: file.name,
      bytes: file.size,
      rowCount,
      columns: blankColumns(cleanNames),
      structuralNotes: notes,
      excludedRows,
      sampled,
      filtered: options.filter ?? null,
      timings: { loadMs: 0, profileMs: 0 },
      quality: null,
      sampleCsv: null,
      virtual: false,
      fileToken: null,
      parts: null,
    };
    state.buildLabel = "Profiling columns...";
    await paint(report, view());
    await profileSession(ctx, created);
    created.timings.loadMs = Math.round(performance.now() - started);
    return created;
    });
  } catch (error) {
    if (error instanceof DatasetTooLargeError || error instanceof UseStandardPath) throw error;
    const text = error instanceof Error ? error.message : String(error);
    if (/out of memory|failed to allocate|memory limit/i.test(text)) {
      await resetDb();
      throw new DatasetTooLargeError(workingCopyMessage(), null, file.size);
    }
    throw error;
  }

  sessions.set(session.id, session);
  keyIndex.set(key, session.id);
  await evict(session.id);
  state.build = "done";
  await paint(report, view());
  return snapshot(session);
}

async function evict(keep: string) {
  const ids = [...sessions.keys()].filter((id) => id !== keep);
  while (sessions.size > 3 && ids.length) {
    const id = ids.shift();
    if (id) await closeSession(id);
  }
}

export async function previewPage(
  sessionId: string,
  offset: number,
  options?: { limit?: number; filters?: AnalysisRequest["filters"]; sortColumn?: string; sort?: "asc" | "desc" },
): Promise<PreviewPage> {
  const session = requireSession(sessionId);
  const limit = Math.min(LARGE_DATA.previewPageSize, Math.max(1, options?.limit ?? LARGE_DATA.previewPageSize));
  const start = Math.max(0, offset);
  const names = session.columns.map((column) => column.name);
  const where = filterSql(names, options?.filters);
  if (where.error) throw new Error(where.error);
  const sortColumn = options?.sortColumn ? resolveName(names, options.sortColumn) : null;
  const order = orderSql(session, sortColumn, options?.sort);
  return withDb(async (ctx) => {
    const total = where.sql === "TRUE"
      ? session.rowCount
      : Math.round(firstNum(await sql(ctx, `SELECT count(*)::DOUBLE AS n FROM ${session.table} WHERE ${where.sql}`), "n") || 0);
    const rows = await sql(
      ctx,
      `SELECT ${columnList(names)} FROM ${session.table} WHERE ${where.sql}${order} LIMIT ${limit} OFFSET ${start}`,
    );
    return {
      columns: names,
      rows: rows.map((row) => names.map((name) => text(row[name]))),
      offset: start,
      limit,
      total,
    };
  });
}

const RULES: { pattern: RegExp; min?: number; max?: number; label: string }[] = [
  { pattern: /^age$/i, min: 0, max: 120, label: "age" },
  { pattern: /rating/i, min: 1, max: 5, label: "rating" },
  { pattern: /(price|revenue|amount|quantity|^qty$|units?|cost|spend)/i, min: 0, label: "non-negative value" },
];

function isIdColumn(name: string): boolean {
  return /(^|[_\s])id([_\s]|$)/i.test(name) || /id$/i.test(name);
}

function pct(part: number, whole: number): number {
  if (!whole) return 100;
  return Math.round(Math.max(0, 1 - part / whole) * 100);
}

export async function ensureQuality(sessionId: string): Promise<LargeQuality> {
  const session = requireSession(sessionId);
  if (session.quality) return session.quality;
  return withDb((ctx) => buildQuality(ctx, session));
}

async function buildQuality(ctx: DuckContext, session: Session): Promise<LargeQuality> {
  if (session.quality) return session.quality;
  const started = performance.now();
  const issues: LargeIssue[] = [];
  const names = session.columns.map((column) => column.name);
    for (const column of session.columns) {
      if (column.missing > 0) {
        const sample = await sampleRows(
          ctx,
          session,
          column.name,
          blankSql(column.name),
          column.missing,
        );
        const percent = ((column.missing / Math.max(1, session.rowCount)) * 100).toFixed(1);
        issues.push({
          id: `missing:${column.name}`,
          kind: "missing",
          severity: "review",
          title: `Missing values in "${column.name}"`,
          reason: `${column.missing.toLocaleString()} of ${session.rowCount.toLocaleString()} rows (${percent}%) are blank in this column.`,
          column: column.name,
          affectedCount: column.missing,
          sample,
          canApply: true,
          action: {
            type: "fill_missing",
            column: column.name,
            strategy: column.type === "numeric" ? "mean" : "mode",
            affected: column.missing,
          },
        });
      }
      if (column.whitespace > 0) {
        const ident = quoteIdent(column.name);
        const sample = await sampleRows(ctx, session, column.name, `${ident} IS NOT NULL AND trim(${ident}) <> '' AND ${ident} <> trim(${ident})`, column.whitespace);
        issues.push({
          id: `whitespace:${column.name}`,
          kind: "whitespace",
          severity: "safe",
          title: `Stray whitespace in "${column.name}"`,
          reason: `${column.whitespace.toLocaleString()} value${column.whitespace === 1 ? "" : "s"} have leading or trailing spaces.`,
          column: column.name,
          affectedCount: column.whitespace,
          sample: sample.map((item) => ({ ...item, after: item.before.trim() })),
          canApply: true,
          action: { type: "trim", column: column.name, affected: column.whitespace },
        });
      }
    }

    for (const column of session.columns.filter((item) => item.type === "text" && item.distinct > 1 && item.distinct <= LARGE_DATA.categoryCardinalityCap)) {
      const grouped = await sql(
        ctx,
        `SELECT ${quoteIdent(column.name)} AS raw, lower(trim(${quoteIdent(column.name)})) AS norm, count(*)::DOUBLE AS n
         FROM ${session.table} WHERE NOT ${blankSql(column.name)} GROUP BY 1, 2`,
      );
      const byNorm = new Map<string, Map<string, number>>();
      for (const row of grouped) {
        const norm = text(row["norm"]);
        const raw = text(row["raw"]);
        if (!byNorm.has(norm)) byNorm.set(norm, new Map());
        byNorm.get(norm)!.set(raw, Math.round(num(row["n"]) || 0));
      }
      for (const [norm, variants] of byNorm) {
        if (variants.size < 2) continue;
        let canonical = "";
        let best = -1;
        for (const [raw, count] of variants) {
          if (count > best) {
            best = count;
            canonical = raw;
          }
        }
        const mapping: Record<string, string> = {};
        let affected = 0;
        const sample: IssueSample[] = [];
        for (const [raw, count] of variants) {
          if (raw === canonical) continue;
          mapping[raw] = canonical;
          affected += count;
          if (sample.length < 5) sample.push({ rowIndex: 0, column: column.name, before: raw, after: canonical });
        }
        if (!affected) continue;
        issues.push({
          id: `category:${column.name}:${norm}`,
          kind: "category_inconsistency",
          severity: "safe",
          title: `Inconsistent casing/spacing in "${column.name}"`,
          reason: `${[...variants.keys()].map((value) => `"${value}"`).join(", ")} look like the same value — standardising to "${canonical}".`,
          column: column.name,
          affectedCount: affected,
          sample,
          canApply: true,
          action: { type: "categories", column: column.name, mapping, affected },
        });
      }
    }

    const dup = await sql(
      ctx,
      `SELECT coalesce(sum(c - 1), 0)::DOUBLE AS extra, count(*)::DOUBLE AS groups FROM (
         SELECT count(*) AS c FROM ${session.table} GROUP BY ${columnList(names)} HAVING count(*) > 1
       )`,
    );
    const extra = Math.round(firstNum(dup, "extra") || 0);
    if (extra > 0) {
      issues.push({
        id: "duplicate_rows",
        kind: "duplicate_rows",
        severity: "review",
        title: "Exact duplicate rows",
        reason: `${extra.toLocaleString()} row${extra === 1 ? "" : "s"} are identical to an earlier row. Counts are returned instead of every duplicate.`,
        affectedCount: extra,
        sample: [],
        canApply: true,
        action: { type: "drop_duplicate_rows", affected: extra },
      });
    }

    for (const column of session.columns.filter((item) => isIdColumn(item.name))) {
      const stats = await sql(
        ctx,
        `SELECT coalesce(sum(c) FILTER (WHERE c > 1), 0)::DOUBLE AS involved, count(*) FILTER (WHERE c > 1)::DOUBLE AS values FROM (
           SELECT count(*) AS c FROM ${session.table} WHERE NOT ${blankSql(column.name)} GROUP BY ${quoteIdent(column.name)}
         )`,
      );
      const involved = Math.round(firstNum(stats, "involved") || 0);
      if (!involved) continue;
      const examples = await sql(
        ctx,
        `SELECT ${quoteIdent(column.name)} AS v, count(*)::DOUBLE AS n, ${session.virtual ? "0" : `min("_ds_row")`} AS rn
         FROM ${session.table} WHERE NOT ${blankSql(column.name)}
         GROUP BY 1 HAVING count(*) > 1 ORDER BY n DESC LIMIT 5`,
      );
      issues.push({
        id: `duplicate_id:${column.name}`,
        kind: "duplicate_id",
        severity: "review",
        title: `Repeated values in identifier column "${column.name}"`,
        reason: `${involved.toLocaleString()} rows share a value in "${column.name}". In line-item data this is often expected. Nothing is removed automatically.`,
        column: column.name,
        affectedCount: involved,
        sample: examples.map((row) => ({
          rowIndex: Math.round(num(row["rn"]) || 0),
          column: column.name,
          before: `${text(row["v"])} (${Math.round(num(row["n"]) || 0)} rows)`,
        })),
        canApply: false,
      });
    }

    for (const column of session.columns.filter((item) => item.type === "numeric")) {
      const bad = Math.max(0, column.filled - column.nums);
      if (bad > 0) {
        const sample = await sampleRows(ctx, session, column.name, `NOT ${blankSql(column.name)} AND ${numericSql(column.name)} IS NULL`, bad);
        issues.push({
          id: `type_mismatch:${column.name}`,
          kind: "type_mismatch",
          severity: "review",
          title: `Non-numeric values in "${column.name}"`,
          reason: `${bad.toLocaleString()} value${bad === 1 ? "" : "s"} don't parse as numbers in an otherwise numeric column.`,
          column: column.name,
          affectedCount: bad,
          sample,
          canApply: false,
        });
      }
      if (column.nums >= 5 && column.mean != null && column.std != null && column.q1 != null && column.q3 != null) {
        const iqr = column.q3 - column.q1;
        const sdExpr =
          column.std > 0 ? `${numericSql(column.name)} IS NOT NULL AND abs(${numericSql(column.name)} - ${column.mean}) > ${3 * column.std}` : "FALSE";
        const iqrExpr =
          iqr > 0
            ? `${numericSql(column.name)} IS NOT NULL AND (${numericSql(column.name)} < ${column.q1 - 1.5 * iqr} OR ${numericSql(column.name)} > ${column.q3 + 1.5 * iqr})`
            : "FALSE";
        const counts = await sql(
          ctx,
          `SELECT count(*) FILTER (WHERE ${sdExpr})::DOUBLE AS sd, count(*) FILTER (WHERE ${iqrExpr})::DOUBLE AS iqr FROM ${session.table}`,
        );
        const beyondSd = Math.round(firstNum(counts, "sd") || 0);
        const beyondIqr = Math.round(firstNum(counts, "iqr") || 0);
        const affected = Math.max(beyondSd, beyondIqr);
        if (affected > 0) {
          const sample = await sampleRows(ctx, session, column.name, `(${sdExpr}) OR (${iqrExpr})`, affected);
          issues.push({
            id: `outlier:${column.name}`,
            kind: "outlier",
            severity: "review",
            title: `Potential outliers in "${column.name}"`,
            reason: `${beyondSd.toLocaleString()} value${beyondSd === 1 ? "" : "s"} sit beyond 3 standard deviations and ${beyondIqr.toLocaleString()} sit outside the IQR fence (average ${column.mean.toFixed(2)}). An outlier isn't automatically wrong — nothing is deleted.`,
            column: column.name,
            affectedCount: affected,
            sample,
            canApply: false,
          });
        }
      }
      const rule = RULES.find((item) => item.pattern.test(column.name));
      if (rule) {
        const checks = [
          rule.min != null ? `${numericSql(column.name)} < ${rule.min}` : "",
          rule.max != null ? `${numericSql(column.name)} > ${rule.max}` : "",
        ].filter(Boolean);
        if (checks.length) {
          const counts = await sql(
            ctx,
            `SELECT count(*) FILTER (WHERE ${checks.join(" OR ")})::DOUBLE AS n FROM ${session.table}`,
          );
          const hits = Math.round(firstNum(counts, "n") || 0);
          if (hits > 0) {
            const sample = await sampleRows(ctx, session, column.name, checks.join(" OR "), hits);
            issues.push({
              id: `invalid:${column.name}`,
              kind: "invalid_value",
              severity: "review",
              title: `Out-of-range values in "${column.name}"`,
              reason: `${hits.toLocaleString()} value${hits === 1 ? "" : "s"} fall outside a plausible ${rule.label} range. They are flagged for review, not removed.`,
              column: column.name,
              affectedCount: hits,
              sample,
              canApply: false,
            });
          }
        }
      }
    }

    for (const column of session.columns.filter((item) => item.type === "date" && item.dateKind !== "none")) {
      const badExpr = `NOT ${blankSql(column.name)} AND ${dateSql(column.name, column.dateKind)} IS NULL`;
      const counts = await sql(ctx, `SELECT count(*) FILTER (WHERE ${badExpr})::DOUBLE AS n FROM ${session.table}`);
      const hits = Math.round(firstNum(counts, "n") || 0);
      if (!hits) continue;
      issues.push({
        id: `invalid_date:${column.name}`,
        kind: "invalid_value",
        severity: "review",
        title: `Unparseable dates in "${column.name}"`,
        reason: `${hits.toLocaleString()} value${hits === 1 ? "" : "s"} don't parse as a date.`,
        column: column.name,
        affectedCount: hits,
        sample: await sampleRows(ctx, session, column.name, badExpr, hits),
        canApply: false,
      });
    }

  if (session.virtual) {
    for (const issue of issues) {
      issue.canApply = false;
      delete issue.action;
    }
  }

  const cells = Math.max(1, session.rowCount * Math.max(1, session.columns.length));
  const missingCells = issues.filter((issue) => issue.kind === "missing").reduce((sum, issue) => sum + issue.affectedCount, 0);
  const inconsistent = issues
    .filter((issue) => issue.kind === "category_inconsistency" || issue.kind === "whitespace")
    .reduce((sum, issue) => sum + issue.affectedCount, 0);
  const invalid = issues.filter((issue) => issue.kind === "invalid_value" || issue.kind === "business_rule").reduce((sum, issue) => sum + issue.affectedCount, 0);
  const dupRows =
    (issues.find((issue) => issue.kind === "duplicate_rows")?.affectedCount ?? 0) +
    issues.filter((issue) => issue.kind === "duplicate_id").reduce((sum, issue) => sum + issue.affectedCount, 0);
  const typeMismatch = issues.filter((issue) => issue.kind === "type_mismatch").reduce((sum, issue) => sum + issue.affectedCount, 0);
  const score = {
    completeness: pct(missingCells, cells),
    consistency: pct(inconsistent, cells),
    validity: pct(invalid, cells),
    uniqueness: pct(dupRows, Math.max(1, session.rowCount)),
    typeCorrectness: pct(typeMismatch, cells),
    overall: 0,
  };
  score.overall = Math.round((score.completeness + score.consistency + score.validity + score.uniqueness + score.typeCorrectness) / 5);
  session.quality = { issues, score, rowCount: session.rowCount, columnCount: session.columns.length };
  session.timings = { ...session.timings, qualityMs: Math.round(performance.now() - started) };
  return session.quality;
}

async function sampleRows(ctx: DuckContext, session: Session, column: string, where: string, _affected: number): Promise<IssueSample[]> {
  const rowExpr = session.virtual ? "0" : `"_ds_row"`;
  const order = session.virtual ? "" : ` ORDER BY "_ds_row"`;
  const rows = await sql(
    ctx,
    `SELECT ${rowExpr} AS rn, ${quoteIdent(column)} AS v FROM ${session.table} WHERE ${where}${order} LIMIT 5`,
  );
  return rows.map((row) => ({ rowIndex: Math.round(num(row["rn"]) || 0), column, before: text(row["v"]) || "(blank)" }));
}

export async function sampleCsv(sessionId: string, rows = LARGE_DATA.pythonSampleRows): Promise<{ csv: string; sampled: boolean; rows: number; note: string }> {
  const session = requireSession(sessionId);
  if (session.sampleCsv && rows === LARGE_DATA.pythonSampleRows) {
    return {
      csv: session.sampleCsv,
      sampled: session.rowCount > rows,
      rows: Math.min(session.rowCount, rows),
      note: sampleNote(session, Math.min(session.rowCount, rows)),
    };
  }
  const names = session.columns.map((column) => column.name);
  const take = Math.max(1, Math.min(rows, session.rowCount));
  let method: "random" | "first" = session.rowCount > take ? "random" : "first";
  const csv = await withDb(async (ctx) => {
    const token = `sample_${session.id}.csv`;
    const copyOut = async (using: string) => {
      await ctx.conn.query(`COPY (SELECT ${columnList(names)} FROM ${session.table} ${using}) TO ${quoteLiteral(token)} (HEADER, DELIMITER ',')`);
    };
    try {
      await copyOut(session.rowCount > take ? `USING SAMPLE ${take} ROWS` : "");
    } catch {
      try {
        await ctx.db.dropFile(token);
      } catch {
        /* the sample file was not written */
      }
      await copyOut(`LIMIT ${take}`);
      method = "first";
    }
    const bytes = await ctx.db.copyFileToBuffer(token);
    try {
      await ctx.db.dropFile(token);
    } catch {
      /* already copied */
    }
    return new TextDecoder().decode(bytes);
  });
  if (rows === LARGE_DATA.pythonSampleRows) session.sampleCsv = csv;
  const note =
    method === "first" && session.rowCount > take
      ? `PythonLab is using the first ${take.toLocaleString()} rows from ${session.rowCount.toLocaleString()}. Results from Python are sample-based, not full-dataset results.`
      : sampleNote(session, take);
  return { csv, sampled: session.rowCount > take, rows: take, note };
}

function sampleNote(session: Session, take: number): string {
  if (session.sampled) return session.sampled.label;
  if (session.rowCount <= take) return "";
  return `PythonLab is using a random sample of ${take.toLocaleString()} rows from ${session.rowCount.toLocaleString()}. Results from Python are sample-based, not full-dataset results.`;
}

export async function applyCleaning(
  sessionId: string,
  action: CleanAction,
  options?: { exportFile?: boolean },
): Promise<{ info: LargeSessionInfo; file: File | null; summary: string }> {
  const session = requireSession(sessionId);
  if (session.virtual) {
    throw new Error("This file is split into parts. Save the parts, then open one part to clean it. The original file was not changed.");
  }
  const names = session.columns.map((column) => column.name);
  const exportFile = options?.exportFile !== false;
  const summary =
    action.type === "trim"
      ? `Trimmed whitespace in ${action.column} (${action.affected.toLocaleString()} values).`
      : action.type === "categories"
        ? `Standardised ${action.affected.toLocaleString()} values in ${action.column}.`
        : action.type === "fill_missing"
          ? `Filled ${action.affected.toLocaleString()} missing values in ${action.column} with the ${action.strategy}.`
          : `Removed ${action.affected.toLocaleString()} exact duplicate rows.`;
  const file = await withDb(async (ctx) => {
    const next = `${session.table}_next`;
    const projection =
      action.type === "drop_duplicate_rows"
        ? `SELECT row_number() OVER () AS "_ds_row", ${columnList(names)} FROM (
             SELECT *, row_number() OVER (PARTITION BY ${columnList(names)} ORDER BY "_ds_row") AS _rn FROM ${session.table}
           ) WHERE _rn = 1`
        : `SELECT row_number() OVER () AS "_ds_row", ${cleanSelectList(names, action, session.table)} FROM ${session.table}`;
    await ctx.conn.query(`CREATE TABLE ${next} AS ${projection}`);
    await dropTable(ctx, session.table);
    await ctx.conn.query(`ALTER TABLE ${next} RENAME TO ${session.table}`);
    const counts = await sql(ctx, `SELECT count(*)::DOUBLE AS n FROM ${session.table}`);
    session.rowCount = Math.round(firstNum(counts, "n") || 0);
    if (keyIndex.get(session.key) === session.id) keyIndex.delete(session.key);
    session.key = `${session.key}|edited`;
    await profileSession(ctx, session);
    if (!exportFile) return null;
    return exportTable(ctx, session);
  });
  return { info: snapshot(session), file, summary };
}

async function exportTable(ctx: DuckContext, session: Session): Promise<File> {
  const token = `out_${session.id}.csv`;
  const names = session.columns.map((column) => column.name);
  await ctx.conn.query(
    `COPY (SELECT ${columnList(names)} FROM ${session.table} ORDER BY "_ds_row") TO ${quoteLiteral(token)} (HEADER, DELIMITER ',')`,
  );
  const bytes = await ctx.db.copyFileToBuffer(token);
  try {
    await ctx.db.dropFile(token);
  } catch {
    /* already copied */
  }
  const stem = session.fileName.replace(/\.[^.]+$/, "") || "dataset";
  return new File([copyBytes(bytes)], `${stem}.csv`, { type: "text/csv" });
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function namesOf(session: Session): string[] {
  return session.columns.map((column) => column.name);
}

function dateKindMap(session: Session): Map<string, DateKind> {
  return new Map(session.columns.filter((column) => column.dateKind !== "none").map((column) => [column.name, column.dateKind]));
}

function scopeNote(session: Session): string {
  if (session.sampled) return session.sampled.label;
  if (session.filtered) return `Filtered to ${session.filtered.column} = ${session.filtered.value}. This is not the unfiltered file.`;
  if (session.parts) return session.parts.note;
  return "";
}

function orderSql(session: Session, sortColumn: string | null, sort: "asc" | "desc" | undefined): string {
  if (!sortColumn) return session.virtual ? "" : ` ORDER BY "_ds_row"`;
  const direction = sort === "asc" ? "ASC" : "DESC";
  const expr =
    session.columns.find((column) => column.name === sortColumn)?.type === "numeric"
      ? numericSql(sortColumn)
      : quoteIdent(sortColumn);
  const tie = session.virtual ? "" : `, "_ds_row"`;
  return ` ORDER BY ${expr} ${direction} NULLS LAST${tie}`;
}

export async function runAnalysis(sessionId: string, request: AnalysisRequest): Promise<QueryResult> {
  const session = requireSession(sessionId);
  try {
    return await withDb((ctx) => execute(ctx, session, request));
  } catch (error) {
    return { op: request.operation, description: request.operation, error: explain(error) };
  }
}

async function execute(ctx: DuckContext, session: Session, request: AnalysisRequest): Promise<QueryResult> {
  const names = namesOf(session);
  const where = filterSql(names, request.filters);
  if (where.error) return { op: request.operation, description: request.operation, error: where.error };
  const limit = Math.min(LARGE_DATA.queryResultRows, Math.max(1, request.limit ?? LARGE_DATA.queryResultRows));
  const scope = scopeNote(session);
  const withScope = (note?: string) => [note, scope].filter(Boolean).join(" ");

  if (request.operation === "profile" || request.operation === "missing") {
    const rows = session.columns.map((column) => {
      const summary = toSummary(column);
      const detail = summary.numeric
        ? `min ${fmt(summary.numeric.min)}, max ${fmt(summary.numeric.max)}, mean ${fmt(summary.numeric.mean)}`
        : summary.dateRange
          ? `${summary.dateRange.min} → ${summary.dateRange.max}`
          : (summary.topValues ?? []).slice(0, 3).map((item) => `${item.value} (${item.count})`).join(", ");
      return [summary.name, summary.type, summary.missing, `${summary.missingPct.toFixed(1)}%`, summary.distinct, detail];
    });
    return {
      op: request.operation,
      description:
        request.operation === "missing"
          ? `Missing values across ${session.rowCount.toLocaleString()} rows`
          : `Profile of ${session.rowCount.toLocaleString()} rows × ${session.columns.length} columns`,
      columns: ["column", "type", "missing", "missing %", "distinct", "summary"],
      rows,
      ...(scope ? { note: scope } : {}),
    };
  }

  if (request.operation === "quality" || request.operation === "duplicates" || request.operation === "outliers") {
    const quality = session.quality ?? (await buildQuality(ctx, session));
    const wanted =
      request.operation === "duplicates"
        ? quality.issues.filter((issue) => issue.kind === "duplicate_rows" || issue.kind === "duplicate_id")
        : request.operation === "outliers"
          ? quality.issues.filter((issue) => issue.kind === "outlier")
          : quality.issues;
    return {
      op: request.operation,
      description:
        request.operation === "outliers"
          ? "Outlier scan. An outlier is not automatically incorrect, and none were deleted."
          : `Data quality score ${quality.score.overall}/100`,
      columns: ["issue", "kind", "severity", "rows affected"],
      rows: wanted.slice(0, 30).map((issue) => [issue.title, issue.kind, issue.severity, issue.affectedCount]),
      ...(withScope(quality.issues.length > wanted.length ? "" : "") ? { note: withScope() } : scope ? { note: scope } : {}),
    };
  }

  if (request.operation === "correlation") {
    const numeric = session.columns.filter((column) => column.type === "numeric").map((column) => column.name);
    const picked = (request.columns ?? []).map((column) => resolveName(names, column)).filter((column): column is string => !!column);
    const cols = (picked.length >= 2 ? picked : numeric).slice(0, 8);
    if (cols.length < 2) return { op: "correlation", description: "Correlation", error: "Need at least two numeric columns." };
    const pairs: (string | number)[][] = [];
    for (let a = 0; a < cols.length; a++) {
      for (let b = a + 1; b < cols.length; b++) {
        const left = cols[a]!;
        const right = cols[b]!;
        const rows = await sql(
          ctx,
          `SELECT corr(${numericSql(left)}, ${numericSql(right)}) AS r, count(*) FILTER (WHERE ${numericSql(left)} IS NOT NULL AND ${numericSql(right)} IS NOT NULL)::DOUBLE AS n
           FROM ${session.table} WHERE ${where.sql}`,
        );
        const value = num(rows[0]?.["r"]);
        if (!Number.isFinite(value)) continue;
        pairs.push([left, right, fmt(value), Math.round(num(rows[0]?.["n"]) || 0)]);
      }
    }
    pairs.sort((a, b) => Math.abs(Number(b[2])) - Math.abs(Number(a[2])));
    return {
      op: "correlation",
      description: "Pearson correlation between numeric columns on the loaded dataset",
      columns: ["column A", "column B", "r", "rows used"],
      rows: pairs.slice(0, 15),
      note: withScope("Correlation does not imply causation."),
    };
  }

  if (request.operation === "filter") {
    const page = await previewInside(ctx, session, 0, limit, where.sql, request.by, request.sort ?? request.order);
    return {
      op: "filter",
      description: `Filtered rows${describeFilters(request)}`,
      columns: page.columns,
      rows: page.rows,
      truncated: page.total > page.rows.length,
      note: withScope(`Showing ${page.rows.length.toLocaleString()} of ${page.total.toLocaleString()} matching rows.`),
    };
  }

  if (request.operation === "top_n" || request.operation === "bottom_n") {
    const by = resolveName(names, request.by ?? request.metric ?? "");
    if (!by) return { op: request.operation, description: request.operation, error: "A numeric column is required." };
    const show = (request.columns ?? names).map((column) => resolveName(names, column)).filter((column): column is string => !!column).slice(0, 8);
    const display = show.length ? show : names.slice(0, 8);
    const direction = request.operation === "bottom_n" || request.order === "asc" ? "ASC" : "DESC";
    const rowExpr = session.virtual ? "0" : `"_ds_row"`;
    const rows = await sql(
      ctx,
      `SELECT ${rowExpr} AS data_row, ${columnList(display)} FROM ${session.table}
       WHERE ${where.sql} AND ${numericSql(by)} IS NOT NULL
       ORDER BY ${numericSql(by)} ${direction} NULLS LAST
       LIMIT ${Math.min(limit, request.limit ?? 10)}`,
    );
    return {
      op: request.operation,
      description: `${request.operation === "bottom_n" ? "Bottom" : "Top"} ${Math.min(limit, request.limit ?? 10)} rows by ${by}${describeFilters(request)}`,
      columns: ["data row", ...display],
      rows: rows.map((row) => [Math.round(num(row["data_row"]) || 0), ...display.map((column) => text(row[column]))]),
      ...(scope ? { note: scope } : {}),
    };
  }

  if (request.operation === "value_counts") {
    const column = resolveName(names, request.by ?? request.metric ?? request.groupBy?.[0] ?? "");
    if (!column) return { op: "value_counts", description: "value_counts", error: "Column was not found." };
    const rows = await sql(
      ctx,
      `SELECT coalesce(nullif(trim(${quoteIdent(column)}), ''), '(blank)') AS v, count(*)::DOUBLE AS n
       FROM ${session.table} WHERE ${where.sql} GROUP BY 1 ORDER BY n DESC LIMIT ${limit}`,
    );
    return {
      op: "value_counts",
      description: `Value counts for ${column}${describeFilters(request)}`,
      columns: [column, "rows"],
      rows: rows.map((row) => [text(row["v"]), Math.round(num(row["n"]) || 0)]),
      ...(scope ? { note: scope } : {}),
    };
  }

  if (request.operation === "compare") {
    const column = resolveName(names, request.by ?? request.groupBy?.[0] ?? "");
    if (!column) return { op: "compare", description: "compare", error: "Column was not found." };
    const metric = resolveMetric(session, request, false);
    if ("error" in metric) return { op: "compare", description: "compare", error: metric.error };
    const values = request.values ?? [];
    const rows = [];
    for (const value of values.slice(0, 4)) {
      const stats = await sql(
        ctx,
        `SELECT ${aggSql(request.aggregation ?? "sum", metric.sql)} AS v, count(*)::DOUBLE AS n
         FROM ${session.table}
         WHERE ${where.sql} AND lower(trim(coalesce(${quoteIdent(column)}, ''))) = lower(${quoteLiteral(value)})`,
      );
      rows.push([value, Number.isFinite(num(stats[0]?.["v"])) ? fmt(num(stats[0]?.["v"])) : "no rows", Math.round(num(stats[0]?.["n"]) || 0)] as (string | number)[]);
    }
    return {
      op: "compare",
      description: `${metric.label} for ${column}${describeFilters(request)}`,
      columns: [column, metric.label, "rows"],
      rows,
      ...(metric.note || scope ? { note: withScope(metric.note) } : {}),
    };
  }

  if (request.operation === "time_trend") {
    const dateColumn = resolveName(names, request.dateColumn ?? "");
    if (!dateColumn) return { op: "time_trend", description: "time_trend", error: "A date column is required." };
    const kind = dateKindMap(session).get(dateColumn) ?? "cast";
    const metric = resolveMetric(session, request, true);
    if ("error" in metric) return { op: "time_trend", description: "time_trend", error: metric.error };
    const granularity = request.granularity ?? "month";
    const bucket = bucketSql(dateColumn, kind, granularity);
    const rows = await sql(
      ctx,
      `SELECT ${bucket} AS period, ${aggSql(request.aggregation ?? "sum", metric.sql)} AS v, count(*)::DOUBLE AS n
       FROM ${session.table}
       WHERE ${where.sql} AND ${dateSql(dateColumn, kind)} IS NOT NULL
       GROUP BY 1 ORDER BY 1 LIMIT 60`,
    );
    const series = rows.map((row) => ({ period: text(row["period"]), value: num(row["v"]), n: Math.round(num(row["n"]) || 0) }));
    const body = series.map((item, index) => {
      const prev = series[index - 1];
      const change = prev && Number.isFinite(prev.value) && prev.value !== 0 && Number.isFinite(item.value) ? ((item.value - prev.value) / Math.abs(prev.value)) * 100 : null;
      return [item.period, Number.isFinite(item.value) ? fmt(item.value) : "n/a", item.n, change == null ? "" : fmt(change)] as (string | number)[];
    });
    return {
      op: "time_trend",
      description: `${metric.label} by ${granularity} of ${dateColumn}${describeFilters(request)}`,
      columns: ["period", metric.label, "rows", "change vs previous %"],
      rows: body,
      note: withScope(metric.note ?? "Calculated on every loaded row in each period."),
    };
  }

  if (request.operation === "aggregate") {
    const metric = resolveMetric(session, request, true);
    if ("error" in metric && (request.aggregation ?? "sum") !== "count") {
      return { op: "aggregate", description: "aggregate", error: metric.error };
    }
    const expr = "error" in metric ? "1" : metric.sql;
    const label = "error" in metric ? "rows" : metric.label;
    const rows = await sql(
      ctx,
      `SELECT ${aggSql(request.aggregation ?? "count", expr)} AS v, count(*)::DOUBLE AS n FROM ${session.table} WHERE ${where.sql}`,
    );
    const value = num(rows[0]?.["v"]);
    return {
      op: "aggregate",
      description: `${label}${describeFilters(request)} over ${Math.round(num(rows[0]?.["n"]) || 0).toLocaleString()} rows`,
      value: Number.isFinite(value) ? fmt(value) : "no numeric values",
      ...(metric && "note" in metric && (metric.note || scope) ? { note: withScope(metric.note) } : scope ? { note: scope } : {}),
    };
  }

  const groups = request.groupBy ?? [];
  if (!groups.length) return { op: "group_by", description: "group_by", error: "A group column is required." };
  const resolved = groups.map((group) => resolveName(names, group));
  if (resolved.some((group) => !group)) return { op: "group_by", description: "group_by", error: "A group column was not found." };
  const metric = resolveMetric(session, request, true);
  if ("error" in metric) return { op: "group_by", description: "group_by", error: metric.error };
  const groupExprs = resolved.map((group) => `coalesce(nullif(trim(${quoteIdent(group!)}), ''), '(blank)')`);
  const direction = request.sort === "asc" ? "ASC" : "DESC";
  const rows = await sql(
    ctx,
    `WITH grouped AS (
       SELECT ${groupExprs.map((expr, index) => `${expr} AS g${index}`).join(", ")},
              ${aggSql(request.aggregation ?? "sum", metric.sql)} AS metric,
              count(*)::DOUBLE AS n
       FROM ${session.table} WHERE ${where.sql}
       GROUP BY ${groupExprs.map((_, index) => index + 1).join(", ")}
     )
     SELECT *, metric / nullif(sum(metric) OVER (), 0) * 100 AS share
     FROM grouped
     ORDER BY metric ${direction} NULLS LAST
     LIMIT ${limit}`,
  );
  return {
    op: "group_by",
    description: `${metric.label} by ${resolved.join(" × ")}${describeFilters(request)}`,
    columns: [...resolved.map((group) => group!), metric.label, "rows", "share %"],
    rows: rows.map((row) => [
      ...resolved.map((_, index) => text(row[`g${index}`])),
      Number.isFinite(num(row["metric"])) ? fmt(num(row["metric"])) : "n/a",
      Math.round(num(row["n"]) || 0),
      Number.isFinite(num(row["share"])) ? fmt(num(row["share"])) : "",
    ]),
    truncated: rows.length >= limit,
    note: withScope(metric.note ?? `Showing up to ${limit} groups. The metric is calculated on every loaded row.`),
  };
}

function resolveMetric(session: Session, request: AnalysisRequest, allowCount: boolean): { sql: string; label: string; note?: string } | { error: string } {
  if ((request.aggregation ?? "sum") === "count" && !request.metric && !request.derived && allowCount) {
    return { sql: "1", label: "rows" };
  }
  return metricSql(namesOf(session), request.metric, request.derived, dateKindMap(session));
}

function aggSql(kind: NonNullable<AnalysisRequest["aggregation"]> | "count", expr: string): string {
  if (kind === "count") return expr === "1" ? "count(*)::DOUBLE" : `count(${expr})::DOUBLE`;
  if (kind === "avg") return `avg(${expr})`;
  if (kind === "min") return `min(${expr})`;
  if (kind === "max") return `max(${expr})`;
  if (kind === "median") return `median(${expr})`;
  return `sum(${expr})`;
}

function describeFilters(request: AnalysisRequest): string {
  if (!request.filters?.length) return "";
  return ` where ${request.filters.map((filter) => `${filter.column} ${filter.op} ${JSON.stringify(filter.value)}`).join(" and ")}`;
}

function fmt(value: number): number {
  return Math.abs(value) >= 100 ? Math.round(value * 100) / 100 : Math.round(value * 10000) / 10000;
}

async function previewInside(
  ctx: DuckContext,
  session: Session,
  offset: number,
  limit: number,
  where: string,
  sortColumn: string | undefined,
  sort: "asc" | "desc" | undefined,
): Promise<PreviewPage> {
  const names = namesOf(session);
  const column = sortColumn ? resolveName(names, sortColumn) : null;
  const order = orderSql(session, column, sort);
  const total = where === "TRUE"
    ? session.rowCount
    : Math.round(firstNum(await sql(ctx, `SELECT count(*)::DOUBLE AS n FROM ${session.table} WHERE ${where}`), "n") || 0);
  const rows = await sql(
    ctx,
    `SELECT ${columnList(names)} FROM ${session.table} WHERE ${where}${order} LIMIT ${limit} OFFSET ${offset}`,
  );
  return {
    columns: names,
    rows: rows.map((row) => names.map((name) => text(row[name]))),
    offset,
    limit,
    total,
  };
}

export async function querySession(sessionId: string, statement: string): Promise<Record<string, unknown>[]> {
  const session = requireSession(sessionId);
  const bound = statement.replaceAll("{{table}}", session.table);
  return withDb((ctx) => sql(ctx, bound));
}

export async function exportSplitParts(
  sessionId: string,
): Promise<{ name: string; file: File; rowCount: number }[]> {
  const session = requireSession(sessionId);
  const parts = session.parts;
  if (!parts) return [];
  const names = session.columns.map((column) => column.name);
  return withDb(async (ctx) => {
    const files: { name: string; file: File; rowCount: number }[] = [];
    for (let index = 0; index < parts.names.length; index++) {
      const name = parts.names[index] ?? `${parts.stem}_${index + 1}`;
      const rowCount = parts.rows[index] ?? 0;
      const token = `part_${session.id}_${index}.csv`;
      const offset = index * parts.partRows;
      await ctx.conn.query(
        `COPY (SELECT ${columnList(names)} FROM ${session.table} LIMIT ${parts.partRows} OFFSET ${offset}) TO ${quoteLiteral(token)} (HEADER, DELIMITER ',')`,
      );
      const bytes = await ctx.db.copyFileToBuffer(token);
      try {
        await ctx.db.dropFile(token);
      } catch {
        /* already copied */
      }
      files.push({
        name,
        file: new File([copyBytes(bytes)], `${name}.csv`, { type: "text/csv" }),
        rowCount,
      });
    }
    return files;
  });
}

export async function exportSession(sessionId: string): Promise<File> {
  const session = requireSession(sessionId);
  if (session.parts) {
    throw new Error(`This file is split into ${session.parts.names.length} parts. Save the parts from the analysis page.`);
  }
  return withDb((ctx) => exportTable(ctx, session));
}

export function revenueRequest(countryLimit = 10): AnalysisRequest {
  return {
    operation: "group_by",
    groupBy: ["Country"],
    metric: "Revenue",
    aggregation: "sum",
    sort: "desc",
    limit: countryLimit,
  };
}

export { resolveRevenue };
