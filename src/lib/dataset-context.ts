import { detectTypes, tableToCsv, type Table } from "./analysis";
import { analyzeQuality } from "./data-quality";
import {
  downloadVersionBlob,
  getCleaningLogForDataset,
  getDataset,
  listVersions,
  versionFilename,
  type CleaningLogRow,
  type DatasetRow,
  type DatasetVersionRow,
} from "./dataset-library";
import { getSheetNames, parseUploadedFile } from "./parse-file";

// The "active dataset" is just a pointer (dataset + version + sheet). The data
// itself always comes from the server-side persisted dataset; the pointer
// lives in the URL so a refresh restores it, and everything below is a
// per-session in-memory cache, never a source of truth.

export const PY_MAX_ROWS = 50000;

export type DatasetSelection = {
  datasetId: string;
  versionId?: string | undefined;
  sheetName?: string | undefined;
};

export type ResolvedDatasetContext = {
  dataset: DatasetRow;
  versions: DatasetVersionRow[];
  requestedVersion: DatasetVersionRow;
  version: DatasetVersionRow;
  versionLabel: string;
  sheetName: string | null;
  sheets: string[];
  cleanedSheet: string | null;
  displayName: string;
  note: string | null;
  table: Table;
};

const KIND_LABEL: Record<string, string> = { original: "Original", working: "Working", finalized: "Finalized" };
export const versionLabel = (v: DatasetVersionRow) => `${KIND_LABEL[v.kind] ?? v.kind} v${v.version_number}`;

const blobCache = new Map<string, Blob>();
const tableCache = new Map<string, Table>();

function remember<T>(cache: Map<string, T>, key: string, value: T, cap: number) {
  cache.set(key, value);
  if (cache.size > cap) cache.delete(cache.keys().next().value as string);
}

async function cachedBlob(version: DatasetVersionRow): Promise<Blob> {
  const hit = blobCache.get(version.id);
  if (hit) return hit;
  const blob = await downloadVersionBlob(version);
  remember(blobCache, version.id, blob, 6);
  return blob;
}

async function cachedTable(dataset: DatasetRow, version: DatasetVersionRow, sheet: string | null): Promise<Table> {
  const key = `${version.id}|${version.kind === "original" ? (sheet ?? "") : ""}`;
  const hit = tableCache.get(key);
  if (hit) return hit;
  const blob = await cachedBlob(version);
  const file = new File([blob], versionFilename(dataset, version), { type: blob.type });
  const parsed = await parseUploadedFile(file, version.kind === "original" ? (sheet ?? undefined) : undefined);
  remember(tableCache, key, parsed.table, 8);
  return parsed.table;
}

// Ownership is enforced by RLS on every read below (datasets, dataset_versions,
// storage.objects): a dataset, version or file that isn't the caller's simply
// comes back empty, so a foreign id can't be turned into data. The explicit
// checks here (version belongs to dataset, sheet exists in the workbook) make
// the failure messages precise rather than adding new authority.
export async function resolveDatasetContext(sel: DatasetSelection): Promise<ResolvedDatasetContext> {
  const dataset = await getDataset(sel.datasetId);
  if (!dataset) throw new Error("Dataset not found, or it doesn't belong to your account.");
  const versions = await listVersions(dataset.id);
  if (!versions.length) throw new Error("This dataset has no stored versions.");

  const original = versions.find((v) => v.kind === "original") ?? versions[0]!;
  let requested = sel.versionId ? versions.find((v) => v.id === sel.versionId) : undefined;
  if (sel.versionId && !requested) throw new Error("That version doesn't belong to this dataset.");
  requested ??= versions.find((v) => v.id === dataset.current_version_id) ?? versions[versions.length - 1]!;

  const isWorkbook = dataset.file_type === "xlsx" || dataset.file_type === "xls";
  let sheets: string[] = [];
  if (isWorkbook) {
    const blob = await cachedBlob(original);
    sheets = (await getSheetNames(new File([blob], versionFilename(dataset, original)))) ?? [];
  }
  const cleanedSheet = original.sheet_name;
  if (isWorkbook && sel.sheetName && sheets.length && !sheets.includes(sel.sheetName)) {
    throw new Error(`Sheet "${sel.sheetName}" doesn't exist in this workbook.`);
  }
  const sheetName = isWorkbook ? (sel.sheetName ?? requested.sheet_name ?? cleanedSheet ?? sheets[0] ?? null) : null;

  let version = requested;
  let note: string | null = null;
  if (requested.kind !== "original" && isWorkbook && sheetName && cleanedSheet && sheetName !== cleanedSheet) {
    version = original;
    note = `Cleaning covered the "${cleanedSheet}" sheet only, so the sheet "${sheetName}" is analysed from ${versionLabel(original)} (not cleaned).`;
  }

  const table = await cachedTable(dataset, version, sheetName);
  const base = dataset.original_filename ?? dataset.name;
  return {
    dataset,
    versions,
    requestedVersion: requested,
    version,
    versionLabel: versionLabel(version),
    sheetName,
    sheets,
    cleanedSheet,
    displayName: sheetName ? `${base} — ${sheetName}` : dataset.name,
    note,
    table,
  };
}

export function pythonInputs(ctx: ResolvedDatasetContext) {
  return {
    csv: tableToCsv(ctx.table, PY_MAX_ROWS),
    fileName: ctx.displayName,
    columns: ctx.table.columns,
    truncated: ctx.table.rows.length > PY_MAX_ROWS,
  };
}

export function plannerSchema(ctx: ResolvedDatasetContext) {
  const types = detectTypes(ctx.table);
  return {
    name: ctx.displayName,
    rows: ctx.table.rows.length,
    columns: ctx.table.columns.slice(0, 60).map((name, i) => {
      const seen = new Set<string>();
      for (const r of ctx.table.rows) {
        const v = (r[i] ?? "").trim();
        if (v) seen.add(v.slice(0, 40));
        if (seen.size >= 4) break;
      }
      return { name, type: types[name] ?? "text", sample: [...seen] };
    }),
  };
}

// Structured, model-readable facts about the dataset and its cleaning history.
// Row numbers in the log are 0-based data-row indexes, so they're translated to
// spreadsheet row numbers (header = row 1) to keep answers unambiguous.
export function buildDatasetMeta(ctx: ResolvedDatasetContext, log: CleaningLogRow[]): string {
  const types = detectTypes(ctx.table);
  const report = analyzeQuality(ctx.table);
  const lines: string[] = [];
  lines.push(`Active dataset: "${ctx.displayName}"`);
  lines.push(
    `Analysing: ${ctx.versionLabel}${ctx.sheetName ? ` · sheet "${ctx.sheetName}"` : ""} · ${ctx.table.rows.length.toLocaleString()} rows × ${ctx.table.columns.length} columns`,
  );
  if (ctx.sheets.length > 1) lines.push(`Workbook sheets: ${ctx.sheets.join(", ")} (active: ${ctx.sheetName ?? "—"})`);
  if (ctx.note) lines.push(`NOTE: ${ctx.note}`);
  lines.push(
    "Versions: " +
      ctx.versions
        .map((v) => `${versionLabel(v)} (${v.row_count ?? "?"} rows${v.quality_score !== null ? `, quality ${v.quality_score}/100` : ", not scored"})`)
        .join("; "),
  );
  lines.push(
    "Columns: " +
      ctx.table.columns
        .slice(0, 40)
        .map((c) => `${c} (${types[c] ?? "text"})`)
        .join(", "),
  );

  if (log.length) {
    const byOp = new Map<string, number>();
    for (const e of log) {
      const k = `${e.operation}${e.column_name ? ` on ${e.column_name}` : ""}`;
      byOp.set(k, (byOp.get(k) ?? 0) + 1);
    }
    lines.push(`Cleaning history: ${log.length} recorded change(s) — ${[...byOp.entries()].map(([k, n]) => `${k} ×${n}`).join("; ")}.`);
    lines.push("Recorded changes (most recent first, max 15):");
    for (const e of log.slice(0, 15)) {
      const row = Number(e.row_reference) + 2;
      lines.push(
        e.operation === "remove_row"
          ? `- spreadsheet row ${row}: row removed (${e.reason ?? e.operation})`
          : `- spreadsheet row ${row}, ${e.column_name}: "${e.original_value}" → "${e.new_value}" (${e.reason ?? e.operation})`,
      );
    }
  } else {
    lines.push("Cleaning history: no changes have been recorded for this dataset.");
  }

  lines.push(
    `Data quality of the analysed version: ${report.score.overall}/100. ` +
      (report.issues.length
        ? `Items still flagged (unresolved or deliberately ignored — ignored items aren't stored): ${report.issues
            .slice(0, 12)
            .map((i) => `${i.title} [${i.severity}, ${i.affectedRowIndexes.length} rows]`)
            .join("; ")}.`
        : "Nothing is flagged."),
  );
  return lines.join("\n");
}

// --- cross-page handoffs (sessionStorage; one-shot, cleared when read) ---

export type LabHandoff = { request: string; code: string };
export type ExplainPayload = { code: string; stdout: string; error: string | null; imageCount: number };

function stash(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the handoff just won't carry over */
  }
}

function take<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const stashLabHandoff = (h: LabHandoff) => stash("ds_lab_handoff", h);
export const takeLabHandoff = () => take<LabHandoff>("ds_lab_handoff");
export const stashExplain = (p: ExplainPayload) => stash("ds_explain_payload", p);
export const takeExplain = () => take<ExplainPayload>("ds_explain_payload");

export function explainPrompt(ctx: { displayName: string; versionLabel: string; sheetName: string | null }, p: ExplainPayload): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s);
  return [
    `Explain this PythonLab result for "${ctx.displayName}" (${ctx.versionLabel}${ctx.sheetName ? `, sheet "${ctx.sheetName}"` : ""}).`,
    "",
    "Code that ran:",
    "```python",
    clip(p.code, 2500),
    "```",
    p.error ? `It stopped with this error:\n\`\`\`\n${clip(p.error, 1200)}\n\`\`\`` : `Printed output:\n\`\`\`\n${clip(p.stdout || "(no printed output)", 2500)}\n\`\`\``,
    p.imageCount ? `It also produced ${p.imageCount} chart figure${p.imageCount === 1 ? "" : "s"} (you cannot see the image. Describe a chart only by what the code specifies - chart type, columns, title - and never state how many points, periods or bars it contains unless a printed number says so).` : "",
    "",
    "What do these results show, and what should I look at next?",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
