import {
  cleanTable,
  correlationMatrix,
  describeNumeric,
  detectTypes,
  executiveInsights,
  parseDelimited,
  tableToCsv,
  type Table,
} from "./analysis";
import { getSheetNames, parseUploadedFile } from "./parse-file";
import { classifyFile, unsupportedMessage } from "./large-data/decide";
import { LARGE_DATA } from "./large-data/config";

const TABULAR = new Set(["xlsx", "xls", "csv", "tsv", "json"]);
const TEXT = new Set(["txt", "md", "csv", "tsv", "json"]);

export type ChatAttachment = {
  name: string;
  kind: "dataset" | "document";
  sizeLabel: string;
  context: string;
  localSummary: string;
  csv?: string;
  columns?: string[];
  sampleNote?: string;
  largeSessionId?: string;
  plannerSchema?: {
    name: string;
    rows: number;
    columns: { name: string; type: string; sample: string[] }[];
  };
};

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

// Server schema caps `context` at 16000 chars — leave headroom for the
// "Document file: <name>" prefix instead of truncating the body alone.
const MAX_CONTEXT = 15800;

function documentContext(name: string, body: string): string {
  return `Document file: ${name}\n\n${body}`.slice(0, MAX_CONTEXT);
}

function sampleTable(table: Table, limit = 5) {
  const cols = table.columns.slice(0, 8);
  const header = cols.join(" | ");
  const rows = table.rows.slice(0, limit).map((r) => cols.map((_, i) => (r[i] ?? "").slice(0, 40)).join(" | "));
  return [header, ...rows].join("\n");
}

export function datasetContext(table: Table, name: string): ChatAttachment {
  const cleaned = cleanTable(table, { fill: "mean", removeDuplicates: true }).table;
  const types = detectTypes(cleaned);
  const numeric = cleaned.columns.filter((c) => types[c] === "numeric");
  const other = cleaned.columns.filter((c) => types[c] !== "numeric");
  const stats = describeNumeric(cleaned)
    .slice(0, 10)
    .map(
      (c) =>
        `${c.name}: n=${c.n}, mean=${c.mean.toFixed(2)}, median=${c.median.toFixed(2)}, std=${c.std.toFixed(2)}, min=${c.min.toFixed(2)}, max=${c.max.toFixed(2)}, skew=${c.skew.toFixed(2)}`,
    )
    .join("\n");
  const corr = correlationMatrix(cleaned);
  const pairs: string[] = [];
  for (let i = 0; i < corr.names.length; i++) {
    for (let j = i + 1; j < corr.names.length; j++) {
      pairs.push(`${corr.names[i]} ↔ ${corr.names[j]}: r=${corr.matrix[i]![j]!.toFixed(2)}`);
    }
  }
  pairs.sort((a, b) => Math.abs(Number(b.split("r=")[1])) - Math.abs(Number(a.split("r=")[1])));
  const insights = executiveInsights(cleaned).join("\n- ");

  const context = [
    `Dataset file: ${name}`,
    `Rows: ${cleaned.rows.length.toLocaleString()}  Columns: ${cleaned.columns.length}`,
    `Numeric: ${numeric.join(", ") || "none"}`,
    `Other: ${other.join(", ") || "none"}`,
    "",
    "Descriptive statistics:",
    stats || "No numeric columns.",
    "",
    "Strongest correlations:",
    pairs.slice(0, 8).join("\n") || "Need at least two numeric columns.",
    "",
    "Executive insights:",
    `- ${insights}`,
    "",
    "Sample rows:",
    sampleTable(cleaned),
  ].join("\n");

  const localSummary = [
    `Loaded **${name}**: ${cleaned.rows.length.toLocaleString()} rows × ${cleaned.columns.length} columns (${numeric.length} numeric).`,
    insights.split("\n")[0] ?? "",
    numeric.length
      ? `Key numeric fields: ${numeric.slice(0, 6).join(", ")}.`
      : "No numeric fields detected — I can still summarise categories and text.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    name,
    kind: "dataset",
    sizeLabel: `${cleaned.rows.length.toLocaleString()} rows`,
    context: context.slice(0, 14000),
    localSummary,
    csv: tableToCsv(cleaned),
    columns: cleaned.columns,
  };
}

// Sheet names for a multi-sheet Excel attachment, or null if the file isn't
// a spreadsheet \u2014 lets the caller offer a picker before parsing it.
export async function chatFileSheetNames(file: File): Promise<string[] | null> {
  return getSheetNames(file);
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  return value.trim();
}

const PDFJS_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/";

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({
    data: buffer,
    cMapUrl: `${PDFJS_CDN}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_CDN}standard_fonts/`,
  }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages.join("\n\n").trim();
}

export async function prepareChatFile(file: File, sheetName?: string): Promise<ChatAttachment> {
  const ext = extOf(file.name);
  const sizeLabel = file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;

  if (ext === "docx" || ext === "pdf") {
    let text = "";
    try {
      text = ext === "docx" ? await extractDocx(file) : await extractPdf(file);
    } catch (e) {
      console.error(`Failed to extract text from .${ext}`, e);
    }
    if (text.length < 20) {
      throw new Error(
        ext === "docx"
          ? "That .docx has no extractable text (it may be scanned images). Export it as PDF, TXT or CSV instead."
          : "That PDF has no extractable text (it's likely scanned images). Export it as TXT, DOCX or CSV instead.",
      );
    }
    return {
      name: file.name,
      kind: "document",
      sizeLabel,
      context: documentContext(file.name, text),
      localSummary: `Loaded document **${file.name}** (${sizeLabel}). Ask me to summarise, extract metrics, or turn it into actions.`,
    };
  }

  if (ext === "doc") {
    throw new Error("The old .doc format isn't supported. Save it as .docx (or export as PDF/CSV/TXT) and attach that.");
  }

  if ((ext === "csv" || ext === "tsv" || ext === "txt") && file.size > LARGE_DATA.sniffSkipBytes) {
    const decision = await classifyFile(file);
    if (decision.mode === "unsupported") {
      throw new Error(
        `${unsupportedMessage(decision.rows, decision.columns)} ${
          decision.reason === "rows" || decision.rows == null
            ? "Open Upload & Analyze to take a labeled sample or filter it first."
            : "Open Upload & Analyze to choose columns or take a labeled sample."
        }`,
      );
    }
    if (decision.mode === "large") {
      if (typeof window === "undefined") throw new Error("Large files are analysed in the browser.");
      const engine = await import("./large-data/engine");
      const info = await engine.openLargeFile(file, { cacheKey: `chat|${file.name}|${file.size}|${file.lastModified}` });
      const quality = await engine.ensureQuality(info.id);
      const preview = await engine.previewPage(info.id, 0, { limit: 5 });
      const columns = info.columns.slice(0, 59).map((column) => ({
        name: column.name,
        type: column.type,
        sample: column.samples.slice(0, 4).map((value) => value.slice(0, 40)),
      }));
      const hasQty = info.columns.some((column) => /quantity|^qty$/i.test(column.name));
      const hasPrice = info.columns.some((column) => /unit.?price|^price$/i.test(column.name));
      if (hasQty && hasPrice && columns.length < 60) {
        columns.push({ name: "Revenue", type: "numeric", sample: ["Quantity × UnitPrice on every row"] });
      }
      const sample = await engine.sampleCsv(info.id);
      const summary = [
        `Large dataset: ${info.rowCount.toLocaleString()} rows × ${info.columnCount} columns.`,
        "DataSimplr is using optimized processing. Do not invent row-level figures.",
        `Quality score ${quality.score.overall}/100.`,
        ...quality.issues.slice(0, 8).map((issue) => `${issue.title}: ${issue.affectedCount.toLocaleString()} rows.`),
        sample.note,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        name: file.name,
        kind: "dataset",
        sizeLabel,
        context: `Dataset file: ${file.name}\n\n${summary}`.slice(0, MAX_CONTEXT),
        localSummary: `Large dataset **${file.name}** — ${info.rowCount.toLocaleString()} rows × ${info.columnCount} columns. Optimized processing is on. Ask a question and DataSimplr will calculate it on the full loaded file.`,
        csv: sample.csv,
        columns: preview.columns,
        ...(sample.note ? { sampleNote: sample.note } : {}),
        largeSessionId: info.id,
        plannerSchema: { name: file.name, rows: info.rowCount, columns },
      };
    }
  }

  if (TABULAR.has(ext) || TEXT.has(ext)) {
    try {
      const parsed = await parseUploadedFile(file, sheetName);
      if (parsed.table.columns.length >= 2 && parsed.table.rows.length >= 2) {
        const label = parsed.sheetName ? `${parsed.sourceName} \u2014 ${parsed.sheetName}` : parsed.sourceName;
        return datasetContext(parsed.table, label);
      }
    } catch {
      // fall through to raw text
    }
  }

  const raw = await file.text();
  if (!raw.trim()) throw new Error("That file looks empty.");
  return {
    name: file.name,
    kind: "document",
    sizeLabel,
    context: documentContext(file.name, raw),
    localSummary: `Loaded **${file.name}** (${sizeLabel}). I can summarise it and pull out the findings that matter.`,
  };
}

// Recognise a table pasted directly into the chat box (CSV/TSV-shaped text)
// so it gets the same stats/correlations treatment as an uploaded file.
export function detectPastedTable(text: string): Table | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 3 || !/[,\t]/.test(lines[0]!)) return null;
  const table = parseDelimited(trimmed);
  if (table.columns.length < 2 || table.rows.length < 2) return null;
  const consistent = table.rows.slice(0, 20).every((r) => r.length === table.columns.length);
  return consistent ? table : null;
}

export const ANALYZE_PROMPT =
  "Analyse this uploaded file. Write a Snapshot, Key findings, Evidence table, Data quality, and a single Next action in DataSimplr. Use only numbers from the file context.";
